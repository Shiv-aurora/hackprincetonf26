"""FHIR R4-shaped REST surface over any WorldProvider.

Routes (all under /fhir):
    GET  /metadata                      CapabilityStatement
    GET  /Patient                       search: _count, _offset, hospital, name  -> Bundle
    GET  /Patient/{mrn}
    GET  /Observation?patient=          lab results (valueQuantity, referenceRange, issued, performer)
    POST /Observation                   create  -> integrity path (tamper.attempt)
    PUT  /Observation/{id}              update  -> integrity path (tamper.attempt)
    GET  /DiagnosticReport?patient=
    GET  /MedicationRequest?patient=
    GET  /AllergyIntolerance?patient=
    GET  /Condition?patient=
    GET  /DocumentReference?patient=    the clinical note (Patient.notes) as base64 attachment
    GET  /DocumentReference/{id}
    GET  /Organization, /Organization/{id}
"""

from __future__ import annotations

import base64
import hashlib
import inspect
import json
import re
import uuid
import weakref
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Union
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from starlette.responses import Response

from mayajaal.contracts import TamperAttempt, make_event
from mayajaal.world_api import EventSink, Observation, Patient, ResolveWorld, SessionContext, WorldProvider

from ._common import Call, hospital_ids, hospital_name, hospitals, public_base, safe_emit, stable_hex, stable_int

FHIR_MEDIA = "application/fhir+json;charset=utf-8"
FHIR_VERSION = "4.0.1"
SOFTWARE_NAME = "MHN Clinical Data Repository"
SOFTWARE_VERSION = "5.2.7"
SIG_EXT_URL = "https://fhir.meridianhealth.org/StructureDefinition/result-signature"
MRN_SYSTEM = "https://fhir.meridianhealth.org/sid/mrn"

DEFAULT_COUNT = 20
MAX_COUNT = 500
SCAN_PAGE = 250
SCAN_CAP = 5000

IntegrityResult = tuple[list[str], list[str]]
IntegrityCheck = Callable[[Observation, WorldProvider, SessionContext], Union[IntegrityResult, Awaitable[IntegrityResult]]]


# =========================================================================== responses


class FhirError(Exception):
    def __init__(self, status: int, code: str, diagnostics: str):
        self.status, self.code, self.diagnostics = status, code, diagnostics


def operation_outcome(code: str, diagnostics: str, severity: str = "error") -> dict[str, Any]:
    return {
        "resourceType": "OperationOutcome",
        "issue": [{"severity": severity, "code": code, "diagnostics": diagnostics}],
    }


def fhir_response(body: dict[str, Any], status: int = 200, headers: dict[str, str] | None = None) -> Response:
    content = json.dumps(body, ensure_ascii=False, indent=2)
    hdrs = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if headers:
        hdrs.update(headers)
    return Response(content=content, status_code=status, media_type=FHIR_MEDIA, headers=hdrs)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"


# =========================================================================== resource mappers

_GENDER = {"F": "female", "M": "male", "X": "other"}


def org_ref(hid: str | None) -> dict[str, str]:
    return {"reference": f"Organization/{hid}", "display": hospital_name(hid)}


def patient_ref(p_or_mrn: Patient | str) -> dict[str, str]:
    if isinstance(p_or_mrn, Patient):
        return {"reference": f"Patient/{p_or_mrn.mrn}", "display": p_or_mrn.name}
    return {"reference": f"Patient/{p_or_mrn}"}


def _split_name(name: str) -> dict[str, Any]:
    parts = name.strip().split()
    out: dict[str, Any] = {"use": "official", "text": name}
    if len(parts) >= 2:
        out["family"] = parts[-1]
        out["given"] = parts[:-1]
    elif parts:
        out["family"] = parts[0]
    return out


def _address(addr: str) -> dict[str, Any]:
    out: dict[str, Any] = {"use": "home", "type": "physical", "text": addr}
    # "12 Elm St, Meridian City, MC 04412"-style; best effort
    pieces = [s.strip() for s in addr.replace("\n", ",").split(",") if s.strip()]
    if len(pieces) >= 2:
        out["line"] = [pieces[0]]
        out["city"] = pieces[1]
        if len(pieces) >= 3:
            m = re.match(r"([A-Za-z]{2})\s+(\S+)", pieces[2])
            if m:
                out["state"], out["postalCode"] = m.group(1), m.group(2)
    return out


def patient_resource(p: Patient) -> dict[str, Any]:
    return {
        "resourceType": "Patient",
        "id": p.mrn,
        "meta": {"versionId": "1", "profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]},
        "identifier": [{
            "use": "usual",
            "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "MR",
                                 "display": "Medical record number"}]},
            "system": MRN_SYSTEM,
            "value": p.mrn,
            "assigner": org_ref(p.hospital_id),
        }],
        "active": True,
        "name": [_split_name(p.name)],
        "telecom": [{"system": "phone", "value": p.phone, "use": "home"}],
        "gender": _GENDER.get(p.sex, "unknown"),
        "birthDate": p.dob,
        "address": [_address(p.address)],
        "generalPractitioner": [{"display": p.attending}],
        "managingOrganization": org_ref(p.hospital_id),
    }


_RANGE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)")
_LT_RE = re.compile(r"^\s*(?:<|≤|<=)\s*(-?\d+(?:\.\d+)?)")
_GT_RE = re.compile(r"^\s*(?:>|≥|>=)\s*(-?\d+(?:\.\d+)?)")


def parse_range(text: str) -> tuple[float | None, float | None]:
    if m := _RANGE_RE.match(text or ""):
        return float(m.group(1)), float(m.group(2))
    if m := _LT_RE.match(text or ""):
        return None, float(m.group(1))
    if m := _GT_RE.match(text or ""):
        return float(m.group(1)), None
    return None, None


def _num(v: float) -> float | int:
    return int(v) if float(v).is_integer() else v


def _qty(v: float, unit: str) -> dict[str, Any]:
    return {"value": _num(v), "unit": unit, "system": "http://unitsofmeasure.org", "code": unit}


def observation_resource(o: Observation) -> dict[str, Any]:
    low, high = parse_range(o.ref_range)
    rr: dict[str, Any] = {"text": o.ref_range}
    if low is not None:
        rr["low"] = _qty(low, o.unit)
    if high is not None:
        rr["high"] = _qty(high, o.unit)
    res: dict[str, Any] = {
        "resourceType": "Observation",
        "id": o.obs_id,
        "meta": {"versionId": "1", "lastUpdated": o.issued},
        "status": "final",
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                  "code": "laboratory", "display": "Laboratory"}]}],
        "code": {"coding": [{"system": "http://loinc.org", "code": o.code, "display": o.display}], "text": o.display},
        "subject": patient_ref(o.mrn),
        "effectiveDateTime": o.issued,
        "issued": o.issued,
        "performer": [org_ref(o.performer_hospital)],
        "valueQuantity": _qty(o.value, o.unit),
        "referenceRange": [rr],
    }
    interp = None
    if low is not None and o.value < low:
        interp = ("L", "Low")
    elif high is not None and o.value > high:
        interp = ("H", "High")
    elif low is not None or high is not None:
        interp = ("N", "Normal")
    if interp:
        res["interpretation"] = [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
            "code": interp[0], "display": interp[1]}]}]
    if o.signature:
        res["extension"] = [{"url": SIG_EXT_URL, "valueString": o.signature}]
    return res


def diagnostic_reports(p_mrn: str, obs: list[Observation]) -> list[dict[str, Any]]:
    """Group results into one report per (lab, issue date)."""
    groups: dict[tuple[str, str], list[Observation]] = {}
    for o in obs:
        groups.setdefault((o.performer_hospital, (o.issued or "")[:10]), []).append(o)
    out = []
    for (lab, day), items in sorted(groups.items(), key=lambda kv: kv[0][1], reverse=True):
        issued = max(i.issued for i in items)
        out.append({
            "resourceType": "DiagnosticReport",
            "id": "dr-" + stable_hex(p_mrn, lab, day, n=10),
            "meta": {"versionId": "1", "lastUpdated": issued},
            "status": "final",
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0074", "code": "LAB",
                                      "display": "Laboratory"}]}],
            "code": {"coding": [{"system": "http://loinc.org", "code": "11502-2", "display": "Laboratory report"}],
                     "text": "Laboratory report"},
            "subject": patient_ref(p_mrn),
            "effectiveDateTime": issued,
            "issued": issued,
            "performer": [org_ref(lab)],
            "result": [{"reference": f"Observation/{i.obs_id}", "display": i.display} for i in items],
        })
    return out


def _authored(p: Patient, i: int) -> str:
    # deterministic date in 2026 so repeated reads are consistent
    day = stable_int(p.mrn, "rx", i) % 300
    return datetime.fromordinal(datetime(2026, 1, 1).toordinal() + day).strftime("%Y-%m-%d")


def medication_requests(p: Patient) -> list[dict[str, Any]]:
    out = []
    for i, med in enumerate(p.medications):
        out.append({
            "resourceType": "MedicationRequest",
            "id": "mr-" + stable_hex(p.mrn, "med", i, med, n=10),
            "meta": {"versionId": "1"},
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {"text": med},
            "subject": patient_ref(p),
            "authoredOn": _authored(p, i),
            "requester": {"display": p.attending},
            "dosageInstruction": [{"text": "As directed"}],
        })
    return out


def allergy_resources(p: Patient) -> list[dict[str, Any]]:
    out = []
    for i, a in enumerate(p.allergies):
        if a.strip().upper() in {"NKDA", "NKA", "NONE"}:
            continue
        out.append({
            "resourceType": "AllergyIntolerance",
            "id": "al-" + stable_hex(p.mrn, "allergy", i, a, n=10),
            "meta": {"versionId": "1"},
            "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                                           "code": "active"}]},
            "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                                               "code": "confirmed"}]},
            "code": {"text": a},
            "patient": patient_ref(p),
            "recordedDate": _authored(p, 100 + i),
        })
    return out


def condition_resources(p: Patient) -> list[dict[str, Any]]:
    out = []
    for i, c in enumerate(p.conditions):
        code, _, text = c.partition(" ")
        coding = [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": code, "display": text or code}] \
            if re.match(r"^[A-Z]\d", code) else []
        cc: dict[str, Any] = {"text": text if coding else c}
        if coding:
            cc["coding"] = coding
        out.append({
            "resourceType": "Condition",
            "id": "cd-" + stable_hex(p.mrn, "cond", i, c, n=10),
            "meta": {"versionId": "1"},
            "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                           "code": "active"}]},
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-category",
                                      "code": "problem-list-item"}]}],
            "code": cc,
            "subject": patient_ref(p),
            "recordedDate": _authored(p, 200 + i),
        })
    return out


def document_id(p: Patient) -> str:
    return "doc-" + stable_hex(p.mrn, "note", n=12)


def document_reference(p: Patient) -> dict[str, Any] | None:
    if not p.notes:
        return None
    raw = p.notes.encode("utf-8")
    date = _authored(p, 999) + "T09:30:00+00:00"
    return {
        "resourceType": "DocumentReference",
        "id": document_id(p),
        "meta": {"versionId": "1", "lastUpdated": date},
        "status": "current",
        "docStatus": "final",
        "type": {"coding": [{"system": "http://loinc.org", "code": "11506-3", "display": "Progress note"}],
                 "text": "Progress note"},
        "category": [{"coding": [{"system": "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
                                  "code": "clinical-note", "display": "Clinical Note"}]}],
        "subject": patient_ref(p),
        "date": date,
        "author": [{"display": p.attending}],
        "custodian": org_ref(p.hospital_id),
        "description": "Clinical note",
        "content": [{
            "attachment": {
                "contentType": "text/plain; charset=utf-8",
                "language": "en-US",
                "data": base64.b64encode(raw).decode("ascii"),
                "size": len(raw),
                "hash": base64.b64encode(hashlib.sha1(raw).digest()).decode("ascii"),
                "title": "Progress note",
                "creation": date,
            },
            "format": {"system": "http://ihe.net/fhir/ihe.formatcode.fhir/CodeSystem/formatcode",
                       "code": "urn:ihe:iti:xds:2017:mimeTypeSufficient", "display": "mimeType Sufficient"},
        }],
        "context": {"related": [org_ref(p.hospital_id)]},
    }


def organization_resource(h: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "Organization",
        "id": h["id"],
        "meta": {"versionId": "1"},
        "active": True,
        "type": [{"text": h.get("kind", "")}],
        "name": h["name"],
        "alias": [h.get("short", "")],
        "partOf": {"display": "Meridian Health Network"},
    }


def capability_statement(base: str) -> dict[str, Any]:
    def res(t: str, interactions: list[str], params: list[tuple[str, str]]) -> dict[str, Any]:
        return {
            "type": t,
            "profile": f"http://hl7.org/fhir/StructureDefinition/{t}",
            "interaction": [{"code": i} for i in interactions],
            "versioning": "versioned",
            "searchParam": [{"name": n, "type": ty} for n, ty in params],
        }

    return {
        "resourceType": "CapabilityStatement",
        "id": "mhn-cdr",
        "status": "active",
        "date": "2026-09-30",
        "publisher": "Meridian Health Network IT Services",
        "kind": "instance",
        "software": {"name": SOFTWARE_NAME, "version": SOFTWARE_VERSION, "releaseDate": "2026-09-30"},
        "implementation": {"description": "Meridian Health Network clinical data repository", "url": f"{base}/fhir"},
        "fhirVersion": FHIR_VERSION,
        "format": ["application/fhir+json", "json"],
        "rest": [{
            "mode": "server",
            "security": {
                "cors": False,
                "service": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/restful-security-service",
                                         "code": "SMART-on-FHIR"}]}],
                "description": "Session tokens issued by the MHN identity service.",
            },
            "resource": [
                res("Patient", ["read", "search-type"],
                    [("_count", "number"), ("_offset", "number"), ("hospital", "token"), ("name", "string")]),
                res("Observation", ["read", "search-type", "create", "update"], [("patient", "reference")]),
                res("DiagnosticReport", ["search-type"], [("patient", "reference")]),
                res("MedicationRequest", ["search-type"], [("patient", "reference")]),
                res("AllergyIntolerance", ["search-type"], [("patient", "reference")]),
                res("Condition", ["search-type"], [("patient", "reference")]),
                res("DocumentReference", ["read", "search-type"], [("patient", "reference")]),
                res("Organization", ["read", "search-type"], []),
            ],
        }],
    }


def _ref_tail(ref: Any) -> str | None:
    if isinstance(ref, dict):
        ref = ref.get("reference")
    if isinstance(ref, str) and ref:
        return ref.rstrip("/").split("/")[-1]
    return None


def body_mrn(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    mrn = _ref_tail(body.get("subject")) or body.get("mrn")
    return str(mrn) if mrn else None


def observation_from_body(body: Any, obs_id: str, stored: Observation | None) -> Observation:
    """Accepts a FHIR Observation (or a flat dict with the dataclass field names)."""
    if not isinstance(body, dict):
        raise FhirError(400, "structure", "Request body must be a JSON object")
    rt = body.get("resourceType")
    if rt is not None and rt != "Observation":
        raise FhirError(400, "invalid", f"Expected resourceType 'Observation', got '{rt}'")

    mrn = body_mrn(body) or (stored.mrn if stored else None)
    if not mrn:
        raise FhirError(422, "required", "Observation.subject is required")

    code_field = body.get("code")
    if isinstance(code_field, dict):
        coding = ((code_field.get("coding") or [{}])[0]) or {}
        code = coding.get("code")
        display = coding.get("display") or code_field.get("text")
    else:
        code, display = code_field, body.get("display")

    vq = body.get("valueQuantity") or {}
    value = vq.get("value", body.get("value"))
    unit = vq.get("unit") or vq.get("code") or body.get("unit")

    rr = (body.get("referenceRange") or [{}])[0] if isinstance(body.get("referenceRange"), list) else {}
    ref_range = rr.get("text") or body.get("ref_range")
    if not ref_range and (rr.get("low") or rr.get("high")):
        lo, hi = (rr.get("low") or {}).get("value"), (rr.get("high") or {}).get("value")
        ref_range = f"{lo}-{hi}" if lo is not None and hi is not None else (f"<{hi}" if hi is not None else f">{lo}")

    perf = body.get("performer")
    performer = _ref_tail(perf[0]) if isinstance(perf, list) and perf else body.get("performer_hospital")

    sig = body.get("signature")
    for ext in body.get("extension") or []:
        if isinstance(ext, dict) and ext.get("url") == SIG_EXT_URL:
            sig = ext.get("valueString")

    if value is None and stored is None:
        raise FhirError(422, "required", "Observation.valueQuantity is required")
    try:
        value_f = float(value) if value is not None else stored.value  # type: ignore[union-attr]
    except (TypeError, ValueError):
        raise FhirError(422, "value", "Observation.valueQuantity.value must be a number") from None

    return Observation(
        obs_id=obs_id,
        mrn=str(mrn),
        code=str(code or (stored.code if stored else "")),
        display=str(display or (stored.display if stored else "")),
        value=value_f,
        unit=str(unit or (stored.unit if stored else "")),
        ref_range=str(ref_range or (stored.ref_range if stored else "")),
        issued=str(body.get("issued") or body.get("effectiveDateTime") or (stored.issued if stored else now_iso())),
        performer_hospital=str(performer or (stored.performer_hospital if stored else "")),
        signature=str(sig or ""),
    )


# =========================================================================== search helpers


def _int_param(request: Request, name: str, default: int, lo: int, hi: int) -> int:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return default
    try:
        v = int(raw)
    except ValueError:
        raise FhirError(400, "invalid", f"Invalid value for search parameter '{name}': '{raw}'") from None
    return max(lo, min(hi, v))


def _patient_param(request: Request) -> str:
    qp = request.query_params
    raw = qp.get("patient") or qp.get("subject") or qp.get("patient._id") or qp.get("subject:Patient")
    if not raw:
        raise FhirError(400, "required", "Search requires the 'patient' parameter")
    return raw.rstrip("/").split("/")[-1]


def _hospital_param(request: Request) -> str | None:
    raw = request.query_params.get("hospital") or request.query_params.get("organization")
    if not raw:
        return None
    return raw.rstrip("/").split("/")[-1]


def _scan(world: WorldProvider, hospital: str | None, cap: int = SCAN_CAP):
    off = 0
    while off < cap:
        page = world.list_patients(hospital, off, min(SCAN_PAGE, cap - off))
        if not page:
            return
        yield from page
        if len(page) < min(SCAN_PAGE, cap - off):
            return
        off += len(page)


_hospital_counts: "weakref.WeakKeyDictionary[Any, dict[str | None, int]]" = weakref.WeakKeyDictionary()


def _count_for_hospital(world: WorldProvider, hospital: str) -> int:
    fn = getattr(world, "count_patients", None)
    if callable(fn):
        try:
            return int(fn(hospital))
        except Exception:  # noqa: BLE001
            pass
    try:
        cache = _hospital_counts.setdefault(world, {})
    except TypeError:
        cache = {}
    if hospital not in cache:
        cache[hospital] = sum(1 for _ in _scan(world, hospital))
    return cache[hospital]


def _bundle(request: Request, base: str, resources: list[dict[str, Any]], total: int,
            offset: int | None = None, count: int | None = None, mode: str = "match") -> dict[str, Any]:
    self_url = f"{base}{request.url.path}" + (f"?{request.url.query}" if request.url.query else "")
    links = [{"relation": "self", "url": self_url}]
    if offset is not None and count is not None:
        params = {k: v for k, v in request.query_params.multi_items() if k not in ("_count", "_offset")}

        def page_url(off: int) -> str:
            q = urlencode([*params.items(), ("_count", count), ("_offset", off)])
            return f"{base}{request.url.path}?{q}"

        links.append({"relation": "first", "url": page_url(0)})
        if offset > 0:
            links.append({"relation": "previous", "url": page_url(max(0, offset - count))})
        if offset + count < total:
            links.append({"relation": "next", "url": page_url(offset + count)})
        if total > 0 and count > 0:
            links.append({"relation": "last", "url": page_url(((total - 1) // count) * count)})
    return {
        "resourceType": "Bundle",
        "id": uuid.uuid4().hex,
        "meta": {"lastUpdated": now_iso()},
        "type": "searchset",
        "total": total,
        "link": links,
        "entry": [{
            "fullUrl": f"{base}/fhir/{r['resourceType']}/{r['id']}",
            "resource": r,
            "search": {"mode": mode},
        } for r in resources],
    }


# =========================================================================== integrity


def _default_integrity(stored: Observation | None, obs: Observation, ctx: SessionContext) -> IntegrityResult:
    """Default policy: the submitted signature must match the stored one. If it does, only this
    tier's own record changes (accepted by the caller's hospital); otherwise every hospital rejects."""
    if not obs.signature or stored is None or not stored.signature or obs.signature != stored.signature:
        return [], hospital_ids()
    return [ctx.hospital_id], []


def _find_obs(world: WorldProvider, mrn: str, obs_id: str) -> Observation | None:
    try:
        for o in world.observations(mrn):
            if o.obs_id == obs_id:
                return o
    except Exception:  # noqa: BLE001
        return None
    return None


# =========================================================================== routes


def add_fhir_routes(router: APIRouter, resolve_world: ResolveWorld, sink: EventSink,
                    integrity_check: IntegrityCheck | None = None) -> None:

    async def run(request: Request, handler: Callable[[Call, str], Any]) -> Response:
        call = await Call.open(request, resolve_world)
        base = public_base(request)
        try:
            res = handler(call, base)
            if inspect.isawaitable(res):
                res = await res
        except FhirError as e:
            res = fhir_response(operation_outcome(e.code, e.diagnostics), status=e.status)
        return call.finish(res)

    def _get_patient(call: Call, mrn: str) -> Patient:
        p = call.world.get_patient(mrn)
        if p is None:
            raise FhirError(404, "not-found", f"Resource Patient/{mrn} is not known")
        return p

    # ------------------------------------------------------------- metadata
    @router.get("/fhir/metadata")
    async def metadata(request: Request) -> Response:
        return await run(request, lambda call, base: fhir_response(capability_statement(base)))

    # ------------------------------------------------------------- Patient
    @router.get("/fhir/Patient")
    async def patient_search(request: Request) -> Response:
        def h(call: Call, base: str) -> Response:
            count = _int_param(request, "_count", DEFAULT_COUNT, 0, MAX_COUNT)
            offset = _int_param(request, "_offset", 0, 0, 10**9)
            hospital = _hospital_param(request)
            name = (request.query_params.get("name") or "").strip().lower()
            w = call.world
            if name:
                matches = [p for p in _scan(w, hospital) if name in p.name.lower()]
                total, page = len(matches), matches[offset:offset + count]
            else:
                total = _count_for_hospital(w, hospital) if hospital else w.total_patients()
                page = w.list_patients(hospital, offset, count) if count else []
            return fhir_response(_bundle(request, base, [patient_resource(p) for p in page], total, offset, count))
        return await run(request, h)

    @router.get("/fhir/Patient/{mrn}")
    async def patient_read(request: Request, mrn: str) -> Response:
        def h(call: Call, base: str) -> Response:
            p = _get_patient(call, mrn)
            return fhir_response(patient_resource(p), headers={"ETag": 'W/"1"'})
        return await run(request, h)

    # ------------------------------------------------------------- Observation
    @router.get("/fhir/Observation")
    async def observation_search(request: Request) -> Response:
        def h(call: Call, base: str) -> Response:
            mrn = _patient_param(request)
            obs = sorted(call.world.observations(mrn), key=lambda o: o.issued or "", reverse=True)
            code = request.query_params.get("code")
            if code:
                code = code.split("|")[-1]
                obs = [o for o in obs if o.code == code]
            return fhir_response(_bundle(request, base, [observation_resource(o) for o in obs], len(obs)))
        return await run(request, h)

    async def _write_observation(call: Call, base: str, obs_id: str | None) -> Response:
        try:
            body = json.loads(await call.request.body() or b"null")
        except (ValueError, UnicodeDecodeError):
            raise FhirError(400, "structure", "Unable to parse request body as JSON") from None
        creating = obs_id is None
        if isinstance(body, dict) and obs_id is not None and body.get("id") not in (None, obs_id):
            raise FhirError(400, "processing", f"Resource id '{body.get('id')}' does not match URL id '{obs_id}'")
        if creating:
            obs_id = "obs-" + uuid.uuid4().hex[:12]
        # find the stored copy first (needed for missing fields + the default signature check)
        mrn = body_mrn(body)
        stored = _find_obs(call.world, mrn, obs_id) if (mrn and not creating) else None
        obs = observation_from_body(body, obs_id, stored)

        if integrity_check is not None:
            # custom policy: the world records the write, then the policy decides who accepts it
            saved = call.world.put_observation(obs) or obs
            verdict = integrity_check(obs, call.world, call.ctx)
            if inspect.isawaitable(verdict):
                verdict = await verdict
            accepted_by, rejected_by = list(verdict[0]), list(verdict[1])
        else:
            # default policy: a rejected write changes nothing; an accepted one changes only this record
            accepted_by, rejected_by = _default_integrity(stored, obs, call.ctx)
            # A world that can verify signatures over the content (the real tier) gets the final say:
            # resubmitting a stored signature with a changed value must not pass.
            verify = getattr(call.world, "verify_observation", None)
            if accepted_by and verify is not None and not verify(obs):
                accepted_by, rejected_by = [], hospital_ids()
            saved = (call.world.put_observation(obs) or obs) if accepted_by else obs

        ctx = call.ctx
        await safe_emit(sink, make_event(
            "tamper.attempt",
            TamperAttempt(resource=f"Observation/{obs_id}", accepted=bool(accepted_by),
                          accepted_by=accepted_by, rejected_by=rejected_by),
            run_id=ctx.run_id, actor="attacker", session_id=ctx.session_id,
            hospital_id=ctx.hospital_id, tier=call.world.tier,
        ))

        if not accepted_by:
            return fhir_response(operation_outcome(
                "security",
                f"Observation/{obs_id}: result signature verification failed; update was not accepted",
            ), status=422)
        version = "1" if creating else "2"
        res = observation_resource(saved)
        res["meta"]["versionId"] = version
        res["meta"]["lastUpdated"] = now_iso()
        loc = f"{base}/fhir/Observation/{obs_id}/_history/{version}"
        return fhir_response(res, status=201 if creating else 200,
                             headers={"Location": loc, "ETag": f'W/"{version}"', "Last-Modified":
                                      datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")})

    @router.post("/fhir/Observation")
    async def observation_create(request: Request) -> Response:
        return await run(request, lambda call, base: _write_observation(call, base, None))

    @router.put("/fhir/Observation/{obs_id}")
    async def observation_update(request: Request, obs_id: str) -> Response:
        return await run(request, lambda call, base: _write_observation(call, base, obs_id))

    # ------------------------------------------------------------- per-patient searches
    @router.get("/fhir/DiagnosticReport")
    async def diagnostic_report_search(request: Request) -> Response:
        def h(call: Call, base: str) -> Response:
            mrn = _patient_param(request)
            reps = diagnostic_reports(mrn, call.world.observations(mrn))
            return fhir_response(_bundle(request, base, reps, len(reps)))
        return await run(request, h)

    def _per_patient(builder: Callable[[Patient], list[dict[str, Any]]]):
        async def endpoint(request: Request) -> Response:
            def h(call: Call, base: str) -> Response:
                p = call.world.get_patient(_patient_param(request))
                items = builder(p) if p is not None else []
                return fhir_response(_bundle(request, base, items, len(items)))
            return await run(request, h)
        return endpoint

    router.add_api_route("/fhir/MedicationRequest", _per_patient(medication_requests), methods=["GET"])
    router.add_api_route("/fhir/AllergyIntolerance", _per_patient(allergy_resources), methods=["GET"])
    router.add_api_route("/fhir/Condition", _per_patient(condition_resources), methods=["GET"])

    def _doc_list(p: Patient) -> list[dict[str, Any]]:
        d = document_reference(p)
        return [d] if d else []

    router.add_api_route("/fhir/DocumentReference", _per_patient(_doc_list), methods=["GET"])

    @router.get("/fhir/DocumentReference/{doc_id}")
    async def document_read(request: Request, doc_id: str) -> Response:
        def h(call: Call, base: str) -> Response:
            # ids are derived from the MRN; the client may pass ?patient= to help us, else scan
            cands: list[Patient] = []
            qp = request.query_params.get("patient")
            if qp:
                p = call.world.get_patient(qp.split("/")[-1])
                cands = [p] if p else []
            else:
                cands = list(_scan(call.world, None))
            for p in cands:
                if document_id(p) == doc_id and p.notes:
                    return fhir_response(document_reference(p), headers={"ETag": 'W/"1"'})  # type: ignore[arg-type]
            raise FhirError(404, "not-found", f"Resource DocumentReference/{doc_id} is not known")
        return await run(request, h)

    # ------------------------------------------------------------- Organization
    @router.get("/fhir/Organization")
    async def org_search(request: Request) -> Response:
        def h(call: Call, base: str) -> Response:
            orgs = [organization_resource(x) for x in hospitals()]
            return fhir_response(_bundle(request, base, orgs, len(orgs)))
        return await run(request, h)

    @router.get("/fhir/Organization/{org_id}")
    async def org_read(request: Request, org_id: str) -> Response:
        def h(call: Call, base: str) -> Response:
            for x in hospitals():
                if x["id"] == org_id:
                    return fhir_response(organization_resource(x), headers={"ETag": 'W/"1"'})
            raise FhirError(404, "not-found", f"Resource Organization/{org_id} is not known")
        return await run(request, h)

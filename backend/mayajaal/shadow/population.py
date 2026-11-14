"""Lazily generated patient population for one shadow session.

Only a light index (hospital per row, MRN per row) is built up front; every patient and lab result
is regenerated on demand from its own HMAC seed, so the same row always comes back identical.
"""

from __future__ import annotations

import hashlib
import hmac
import random
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from mayajaal.shadow import vocab as V
from mayajaal.shadow.seeding import entity_digest, entity_rng
from mayajaal.world_api import Observation, Patient

# The world's clock. Night shift, early hours of 14 Nov 2026.
NOW = datetime(2026, 11, 14, 3, 47, 12)
TODAY = NOW.date()
LAB_WINDOW_START = NOW - timedelta(days=90)

CLINICAL_HOSPITALS = {
    "aur": ("St. Aurelia General", "general", 620),
    "riv": ("Riverside Children's", "pediatric", 210),
    "nor": ("Northgate Medical Center", "general", 410),
    "eas": ("Eastbank Community", "community", 160),
    "wes": ("Westfield Heart Institute", "cardiac", 190),
}
HOSPITAL_ORDER = ["aur", "riv", "nor", "eas", "wes"]
TARGET_POPULATION = 4800
INPATIENT_RATE = {"general": 0.16, "pediatric": 0.12, "community": 0.2, "cardiac": 0.28}


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


# --------------------------------------------------------------------------- clinicians


@dataclass
class Clinician:
    name: str            # "Dr. Amara Patel"
    given: str
    family: str
    specialty: str
    username: str
    hospital_id: str
    credential: str      # MD / DO

    @property
    def display(self) -> str:
        return self.name


def pick_name(rng: random.Random, sex: str) -> tuple[str, str]:
    _, ff, fm, last = V.NAME_POOLS[V.NAME_POOL_PICK.pick(rng)]
    first = (ff if sex == "F" else fm).pick(rng)
    return first, last.pick(rng)


def build_roster(key: bytes, session: str, hid: str) -> list[Clinician]:
    rng = entity_rng(key, session, f"roster/{hid}")
    kind = CLINICAL_HOSPITALS[hid][1]
    out: list[Clinician] = []
    used: set[str] = set()
    for spec in V.ROSTER_SPECIALTIES[kind]:
        sex = "F" if rng.random() < 0.52 else "M"
        given, family = pick_name(rng, sex)
        base = ascii_fold(f"{given[0]}.{family}").lower().replace("'", "")
        user = base
        n = 2
        while user in used:
            user, n = f"{base}{n}", n + 1
        used.add(user)
        out.append(Clinician(f"Dr. {given} {family}", given, family, spec, user, hid,
                             "DO" if rng.random() < 0.18 else "MD"))
    return out


# --------------------------------------------------------------------------- patient core


@dataclass
class PatientCore:
    idx: int
    mrn: str
    given: str
    family: str
    dob: date
    age: int
    sex: str
    hospital_id: str
    address: str
    phone: str
    conditions: list[V.Condition]
    medications: list[str]
    allergies: list[str]
    attending: Clinician
    inpatient: bool
    admit: datetime | None
    bed: str
    latent: dict[str, float]           # per-analyte baseline value
    once: set[str]                     # analytes measured once (value == latent)
    updated_at: datetime
    notes: str = ""
    peds: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def name(self) -> str:
        return f"{self.given} {self.family}"

    def to_patient(self) -> Patient:
        return Patient(
            mrn=self.mrn, name=self.name, dob=self.dob.isoformat(), sex=self.sex, hospital_id=self.hospital_id,
            address=self.address, phone=self.phone, conditions=[c.label for c in self.conditions],
            medications=list(self.medications), allergies=list(self.allergies), attending=self.attending.name,
            notes=self.notes,
        )


def ckd_epi_2021(scr: float, age: int, sex: str) -> float:
    k, a = (0.7, -0.241) if sex == "F" else (0.9, -0.302)
    r = scr / k
    egfr = 142 * min(r, 1) ** a * max(r, 1) ** -1.200 * 0.9938 ** age
    return egfr * (1.012 if sex == "F" else 1.0)


def creatinine_for_egfr(target: float, age: int, sex: str) -> float:
    lo, hi = 0.2, 15.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if ckd_epi_2021(mid, age, sex) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _normal(rng: random.Random, lo: float, hi: float) -> float:
    return lo + (hi - lo) * rng.betavariate(2.4, 2.4)


def _age_for(rng: random.Random, kind: str) -> int:
    if kind == "pediatric":
        band = rng.random()
        if band < 0.18:
            return 0
        if band < 0.45:
            return rng.randint(1, 5)
        if band < 0.72:
            return rng.randint(6, 11)
        return rng.randint(12, 17)
    if kind == "cardiac":
        return min(97, max(28, int(rng.gauss(69, 11))))
    band = rng.random()
    if band < 0.24:
        return rng.randint(18, 39)
    if band < 0.58:
        return rng.randint(40, 64)
    return min(101, rng.randint(65, 84) + (rng.randint(0, 12) if rng.random() < 0.35 else 0))


def _dob_for(rng: random.Random, age: int) -> date:
    if age == 0:
        return TODAY - timedelta(days=rng.randint(9, 360))
    anchor = date(TODAY.year - age, TODAY.month, TODAY.day)
    return anchor - timedelta(days=rng.randint(0, 364))


def _phone(rng: random.Random) -> str:
    exch = rng.randint(201, 989)
    while exch in (555, 911, 411, 611):
        exch = rng.randint(201, 989)
    return f"({rng.choice(V.AREA_CODES)}) {exch}-{rng.randint(0, 9999):04d}"


def _address(rng: random.Random, hid: str) -> str:
    num = rng.choice([rng.randint(2, 99), rng.randint(100, 999), rng.randint(1000, 4999)])
    street = f"{num} {rng.choice(V.STREET_NAMES)} {V.STREET_SUFFIX.pick(rng)}"
    if rng.random() < 0.28:
        street += ", " + rng.choice(V.UNIT_FORMATS).format(n=rng.randint(1, 24), l=rng.choice("ABCDEF"))
    return f"{street}, {V.CITY}, {V.STATE} {rng.choice(V.ZIPS[hid])}"


PEDS_MED_SWAP = {
    "Montelukast 10 mg PO nightly": "Montelukast 5 mg chewable PO nightly",
    "Fluticasone HFA 110 mcg 2 puffs inhaled BID": "Fluticasone HFA 44 mcg 2 puffs inhaled BID with spacer",
    "Albuterol HFA 2 puffs inhaled q4h PRN wheeze": "Albuterol HFA 2 puffs inhaled with spacer q4h PRN wheeze",
    "Levothyroxine 75 mcg PO daily before breakfast": "Levothyroxine 50 mcg PO daily before breakfast",
    "Ferrous sulfate 325 mg PO daily": "Ferrous sulfate 15 mg/mL elemental iron 3 mg/kg PO daily",
    "Sertraline 50 mg PO daily": "Sertraline 25 mg PO daily",
    "Levetiracetam 500 mg PO BID": "Levetiracetam 20 mg/kg PO BID",
    "Lamotrigine 100 mg PO BID": "Lamotrigine 25 mg PO BID",
    "Escitalopram 10 mg PO daily": "Escitalopram 5 mg PO daily",
}

DRUG_CLASS = {
    "Empagliflozin": "sglt2", "Dapagliflozin": "sglt2", "Hydrochlorothiazide": "thiazide", "Chlorthalidone": "thiazide",
    "Atorvastatin": "statin", "Rosuvastatin": "statin", "Simvastatin": "statin", "Apixaban": "anticoag",
    "Warfarin": "anticoag", "Heparin": "anticoag", "Enoxaparin": "anticoag", "Metoprolol": "bb", "Carvedilol": "bb",
    "Lisinopril": "raas", "Losartan": "raas", "Sacubitril-valsartan": "raas", "Omeprazole": "acid",
    "Pantoprazole": "acid", "Famotidine": "acid", "Clopidogrel": "p2y12", "Ticagrelor": "p2y12",
    "Sitagliptin": "dpp4", "Linagliptin": "dpp4", "Sertraline": "ssri", "Escitalopram": "ssri",
    "Ferrous": "iron", "Diltiazem": "rate", "Acetaminophen": "apap", "Ibuprofen": "nsaid", "Meloxicam": "nsaid",
    "Ceftriaxone": "ceph", "Cephalexin": "ceph", "Levetiracetam": "aed", "Lamotrigine": "aed",
}


def drug_class(med: str) -> str:
    words = med.split()
    if words[0] == "Insulin":
        return " ".join(words[:2])
    return DRUG_CLASS.get(words[0], words[0])


def build_patient(key: bytes, session: str, idx: int, mrn: str, hid: str, roster: list[Clinician],
                  updated_at: datetime) -> PatientCore:
    rng = entity_rng(key, session, f"patient/{idx}")
    kind = CLINICAL_HOSPITALS[hid][1]
    age = _age_for(rng, kind)
    peds = age < 18
    sex = "F" if rng.random() < (0.49 if kind != "cardiac" else 0.42) else "M"
    given, family = pick_name(rng, sex)
    dob = _dob_for(rng, age)
    address = _address(rng, hid)
    phone = _phone(rng)

    # ---- problems
    table = V.PEDS_DX if peds else (V.CARDIAC_DX if kind == "cardiac" else V.ADULT_DX)
    if peds:
        n_dx = rng.choice([1, 1, 1, 2, 2, 3])
    else:
        n_dx = max(0, min(6, int(rng.gauss(0.6 + age / 22, 1.0))))
        if kind == "cardiac":
            n_dx = max(n_dx, 2)
    conds: list[V.Condition] = []
    tries = 0
    while len(conds) < n_dx and tries < 40:
        tries += 1
        c = table.pick(rng)
        if c in conds or (c.sex and c.sex != sex) or not (c.min_age <= age <= c.max_age):
            continue
        if c.code.startswith("E11") and any(x.code.startswith(("E11", "E10")) for x in conds):
            continue
        if c.code.startswith("N18") and any(x.code.startswith("N18") or x.code == "E11.22" for x in conds):
            continue
        if c.acute and any(x.acute for x in conds):
            continue
        conds.append(c)

    inpatient = rng.random() < INPATIENT_RATE[kind] or any(c.acute for c in conds)
    if inpatient and not any(c.acute for c in conds) and rng.random() < 0.6:
        pool = V.ACUTE_PEDS if peds else (V.ACUTE_CARDIAC if kind == "cardiac" else V.ACUTE_ADULT)
        pool = [c for c in pool if c.min_age <= age <= c.max_age and (not c.sex or c.sex == sex)]
        if pool:
            conds.insert(0, rng.choice(pool))
    conds.sort(key=lambda c: (not c.acute, -(c.w_cardiac if kind == "cardiac" else c.w_adult)))

    # ---- medications
    meds: list[str] = []
    seen: set[str] = set()
    for c in conds:
        if not c.meds:
            continue
        k = rng.randint(*c.n_meds)
        for m in rng.sample(c.meds, min(k, len(c.meds))):
            if peds:
                m = PEDS_MED_SWAP.get(m, m)
            drug = drug_class(m)
            if drug in seen:
                continue
            seen.add(drug)
            meds.append(m)
    if not peds and rng.random() < 0.35:
        m = rng.choice(V.ADULT_EXTRA_MEDS)
        if drug_class(m) not in seen:
            meds.append(m)
            seen.add(drug_class(m))
    if inpatient and not peds:
        for m in rng.sample(V.INPATIENT_MEDS, rng.randint(1, 2)):
            if drug_class(m) not in seen and not any(x.startswith(("Heparin", "Apixaban", "Warfarin")) for x in meds):
                meds.append(m)
                seen.add(drug_class(m))

    # ---- allergies
    r = rng.random()
    if age < 1:
        r = min(0.999, r * 1.5)
    if r < (0.62 if not peds else 0.72):
        allergies = [V.NKDA]
    else:
        allergies = []
        for _ in range(1 if r < 0.9 else 2):
            a = (V.PEDS_ALLERGIES if peds else V.ALLERGIES).pick(rng)
            if a not in allergies:
                allergies.append(a)

    # ---- attending
    attending = _pick_attending(rng, roster, conds, kind, inpatient)

    # ---- encounter
    admit = None
    bed = ""
    if inpatient:
        admit = NOW - timedelta(days=rng.randint(0, 8), hours=rng.randint(3, 20), minutes=rng.randint(0, 59))
        ward = rng.choice(V.WARDS[hid])
        bed = f"{ward}-{rng.randint(1, 28):02d}{rng.choice('AB') if ward not in ('ICU', 'CCU', 'PICU') else ''}"
        updated_at = max(updated_at, min(admit + timedelta(minutes=rng.randint(25, 300)),
                                         datetime(2026, 11, 14, 1, 58)))

    # ---- latent lab values
    latent, once = _latent_labs(rng, conds, meds, age, sex, peds, kind)

    core = PatientCore(idx=idx, mrn=mrn, given=given, family=family, dob=dob, age=age, sex=sex, hospital_id=hid,
                       address=address, phone=phone, conditions=conds, medications=meds, allergies=allergies,
                       attending=attending, inpatient=inpatient, admit=admit, bed=bed, latent=latent, once=once,
                       updated_at=updated_at, peds=peds)
    core.notes = _note(rng, core)
    return core


def _pick_attending(rng, roster, conds, kind, inpatient) -> Clinician:
    wanted = []
    for c in conds:
        wanted.append(c.specialty)
    if inpatient and kind != "pediatric":
        wanted.append("Hospitalist")
    wanted.append(V.GENERIC_SPECIALTY[kind])
    for spec in wanted:
        hits = [d for d in roster if d.specialty == spec or V.SPECIALTY_FALLBACK.get(d.specialty) == spec]
        if hits and rng.random() < 0.85:
            return rng.choice(hits)
    return rng.choice(roster)


def _latent_labs(rng, conds, meds, age, sex, peds, kind) -> tuple[dict[str, float], set[str]]:
    ranges: dict[str, tuple[float, float]] = {}
    for code in V.LABS:
        lo, hi = V.LABS[code].ref(sex, peds)
        ranges[code] = (lo, hi)
    order: set[str] = set(V.CORE_LABS)
    overrides: dict[str, tuple[float, float]] = {}
    for c in conds:
        order.update(c.order_labs)
        for code, rr in c.labs.items():
            lo, hi = ranges[code]
            mid, width = (lo + hi) / 2, max(hi - lo, 1e-6)
            score = abs((rr[0] + rr[1]) / 2 - mid) / width
            prev = overrides.get(code)
            if prev is None or score > abs((prev[0] + prev[1]) / 2 - mid) / width:
                overrides[code] = rr
            if code not in V.CORE_LABS and code != "62238-1":
                order.add(code)
    if any(m.startswith("Warfarin") for m in meds):
        overrides["6301-6"] = (1.8, 3.4)
        order.add("6301-6")
    if any(m.startswith("Heparin") for m in meds):
        order.add("6301-6")
    if not peds:
        if rng.random() < 0.3:
            order.add("4548-4")
        if rng.random() < 0.25:
            order.add("13457-7")
        if rng.random() < 0.08:
            order.add("3016-3")
        if rng.random() < 0.15:
            order.add("1742-6")
        if kind == "cardiac":
            order.update(["89579-7", "13457-7"])

    latent: dict[str, float] = {}
    for code in sorted(order):
        lab = V.LABS[code]
        if code in overrides:
            lo, hi = overrides[code]
            val = rng.uniform(lo, hi)
        else:
            lo, hi = ranges[code]
            val = _normal(rng, lo, hi)
            if rng.random() < 0.06:          # mild incidental abnormality
                val *= rng.choice([0.9, 1.1])
        latent[code] = round(max(lab.lo_floor, val), lab.decimals)

    # creatinine and eGFR must agree (adults, CKD-EPI 2021)
    if peds:
        latent.pop("62238-1", None)
    else:
        if "62238-1" in overrides:
            lo, hi = overrides["62238-1"]
            latent["2160-0"] = round(creatinine_for_egfr(rng.uniform(lo, hi), age, sex), 2)
        latent["62238-1"] = round(ckd_epi_2021(latent["2160-0"], age, sex))
    # anaemia of CKD tends to sit with low ferritin only if iron deficient; keep ferritin plausible
    once = {c for c in latent if c in ("4548-4", "13457-7", "3016-3", "1989-3", "2276-4", "1742-6")}
    return latent, once


def _age_str(core: PatientCore) -> str:
    if core.age == 0:
        months = max(1, (TODAY - core.dob).days // 30)
        return f"{months}mo {core.sex}"
    if core.peds:
        return f"{core.age}yo {core.sex}"
    return f"{core.age}{core.sex}"


def _plan_line(rng, core: PatientCore, c: V.Condition) -> str:
    lt = core.latent
    code = c.code
    if code.startswith(("E11", "E10")) and "4548-4" in lt:
        a1c = lt["4548-4"]
        return f"A1c {a1c:.1f}% - {'intensify regimen, diabetes education referral' if a1c >= 8 else 'continue current regimen'}"
    if code == "E78.5" and "13457-7" in lt:
        return f"LDL {lt['13457-7']:.0f} on statin, recheck lipids 12 wk"
    if code.startswith("N18"):
        return f"eGFR {lt.get('62238-1', 0):.0f}, avoid nephrotoxins, renally dose meds"
    if code == "E03.9" and "3016-3" in lt:
        return f"TSH {lt['3016-3']:.2f}, adjust levothyroxine and repeat in 6 wk"
    if code == "I48.91":
        return "rate controlled, continue anticoagulation (CHA2DS2-VASc reviewed)"
    if code == "I50.22":
        return "daily weights, strict I/O, 2 g Na diet, continue GDMT"
    if code == "I21.4":
        return "trending troponin, cardiology following, cath lab review in AM"
    if code == "J18.9":
        return "CXR RLL infiltrate, continue abx, wean O2 to keep SpO2 >92%"
    if code == "A41.9":
        return "blood cultures x2 pending, lactate trending, MAP goal >65"
    if code == "D50.9" and "2276-4" in lt:
        return f"ferritin {lt['2276-4']:.0f}, oral iron, consider IV iron if intolerant"
    if code == "J44.9":
        return "no exacerbation this visit, inhaler technique reviewed"
    if code == "J45.909":
        return "asthma action plan updated, spacer technique reviewed"
    if code == "I10":
        return rng.choice(["BP at goal", "BP above goal, home readings requested", "BP 138/84, continue current meds"])
    if code == "H66.90":
        return "ear exam reviewed with parent, return if fever >48h or otorrhea"
    if code == "J21.9":
        return "supportive care, suction PRN, monitor feeds and work of breathing"
    if code == "F90.2":
        return "school reports improved focus, continue stimulant"
    return ""


def _note(rng: random.Random, core: PatientCore) -> str:
    probs = ", ".join(c.short for c in core.conditions if not c.acute) or "no significant PMH"
    acute = next((c for c in core.conditions if c.acute), None)
    plans = [p for p in (_plan_line(rng, core, c) for c in core.conditions[:3]) if p]
    who = _age_str(core)
    if core.inpatient and core.admit:
        generic = (["fever, poor feeding", "dehydration", "respiratory distress, obs"] if core.peds else
                   ["fall at home", "shortness of breath", "chest pain, rule-out ACS", "generalized weakness",
                    "dehydration", "syncope work-up"])
        reason = acute.short if acute else rng.choice(generic)
        s = f"{who} w/ {probs}. Admitted {core.admit:%m/%d} via ED with {reason}. Bed {core.bed}."
        if plans:
            s += " Plan: " + "; ".join(plans) + "."
        if core.peds:
            endings = [" Parents at bedside.", " Mom at bedside, updated on plan.", " Dad updated by phone."]
        elif core.age >= 70:
            endings = [" Full code.", " Full code. Family updated.", " DNR/DNI per MOLST.",
                       " Full code. Dispo pending PT eval."]
        else:
            endings = [" Full code.", " Full code. Family updated.", " Full code. Dispo pending PT eval."]
        s += rng.choice(endings)
        return s
    visit = NOW - timedelta(days=rng.randint(2, 16))
    s = f"{who} seen in clinic {visit:%m/%d} for f/u of {probs}."
    if plans:
        s += " " + "; ".join(plans) + "."
    s += f" RTC {rng.choice([4, 6, 8, 12, 12, 26])} wk."
    return s


# --------------------------------------------------------------------------- observations

NOISE = {"718-7": 0.04, "6690-2": 0.10, "777-3": 0.08, "2951-2": 0.012, "2823-3": 0.05, "2160-0": 0.04,
         "2345-7": 0.14, "6301-6": 0.08, "30934-4": 0.15, "2524-7": 0.12, "89579-7": 0.1}


def build_observations(key: bytes, session: str, core: PatientCore) -> list[Observation]:
    rng = entity_rng(key, session, f"labs/{core.idx}")
    # ---- draw times (collected)
    draws: list[datetime] = []
    if core.inpatient and core.admit:
        first = core.admit + timedelta(minutes=rng.randint(20, 70))
        draws.append(first)
        day = (first + timedelta(days=1)).replace(hour=4, minute=0, second=0)
        while day < NOW - timedelta(hours=1):
            draws.append(day + timedelta(minutes=rng.randint(15, 105)))
            day += timedelta(days=1)
        draws = [draws[0]] + draws[1:][-3:]
        # earlier outpatient labs from before this admission
        if rng.random() < 0.4:
            draws.insert(0, LAB_WINDOW_START + timedelta(days=rng.randint(1, 60), hours=rng.randint(8, 15),
                                                         minutes=rng.randint(0, 59)))
    else:
        n = rng.choice([1, 1, 2, 2, 3])
        for _ in range(n):
            draws.append(LAB_WINDOW_START + timedelta(days=rng.randint(1, 88), hours=rng.randint(7, 16),
                                                      minutes=rng.randint(0, 59)))
        draws.sort()

    out: list[Observation] = []
    acute_infx = any(c.code in ("A41.9", "J18.9", "K35.80", "J21.9") for c in core.conditions)
    nstemi = any(c.code == "I21.4" for c in core.conditions)
    acute_codes = {code for c in core.conditions if c.acute for code in c.labs}
    for di, t in enumerate(draws):
        tests = [c for c in V.CORE_LABS]
        if not core.peds:
            tests.append("62238-1")
        if di == 0:
            tests += sorted(c for c in core.latent if c in core.once)
        tests += [c for c in ("6301-6", "30934-4", "2524-7", "89579-7", "1989-3")
                  if c in core.latent and c not in core.once and (di == 0 or c in ("6301-6", "89579-7", "2524-7"))]
        house = core.hospital_id
        doy = t.timetuple().tm_yday
        acc_lum = f"L{t:%y}{doy:03d}-{rng.randint(10000, 99999)}"
        acc_house = f"{house.upper()}{t:%y}{doy:03d}-{rng.randint(1000, 9999)}"
        stat = core.inpatient and di == len(draws) - 1 and di > 0
        creat_draw = None
        creat_meta = None
        tat_house = rng.randint(32, 80)
        tat_lum = rng.randint(70, 140) if (core.inpatient or stat) else rng.randint(180, 22 * 60)
        for ti, code in enumerate(tests):
            lab = V.LABS[code]
            in_house = rng.random() < (lab.inhouse + (0.25 if core.inpatient else 0))
            base = core.latent.get(code)
            if code == "62238-1":
                val = ckd_epi_2021(creat_draw or core.latent["2160-0"], core.age, core.sex)
            elif base is None:
                continue
            elif code in core.once:
                val = base
            elif code in acute_codes and core.admit and t < core.admit:
                lo, hi = lab.ref(core.sex, core.peds)
                val = _normal(rng, lo, hi)
            else:
                val = base * (1 + max(-2.0, min(2.0, rng.gauss(0, 1))) * NOISE.get(code, 0.05))
                if acute_infx and code in ("6690-2", "2524-7") and core.inpatient:
                    val = base * (1 - 0.13 * di) if di else base
                    val = max(val, V.LABS[code].ref(core.sex, core.peds)[0] * 1.05)
                if nstemi and code == "89579-7":
                    shape = [0.35, 1.0, 0.72, 0.45, 0.3][min(di, 4)]
                    val = base * shape
            val = round(max(val, 0.1 if lab.decimals else 1), lab.decimals)
            if code == "62238-1" and creat_meta is not None:
                in_house = creat_meta[0]
            if code == "62238-1":
                val = float(round(val))
            tat = tat_house if in_house else tat_lum
            issued = t + timedelta(minutes=tat + (ti % 3) * rng.randint(0, 4), seconds=rng.randint(0, 59))
            if issued > NOW:
                issued = NOW - timedelta(minutes=rng.randint(3, 40))
            if code == "62238-1" and creat_meta is not None:
                issued = creat_meta[1] + timedelta(seconds=rng.randint(0, 3))
            if code == "2160-0":
                creat_draw = val
                creat_meta = (in_house, issued)
            acc = acc_house if in_house else acc_lum
            obs_id = f"{acc}.{ti + 1:02d}"
            perf = house if in_house else "lum"
            sig = hmac.new(key, f"{obs_id}|{core.mrn}|{code}|{val}".encode(), hashlib.sha256).hexdigest()[:32]
            out.append(Observation(obs_id=obs_id, mrn=core.mrn, code=code, display=lab.display, value=val,
                                   unit=lab.unit, ref_range=lab.ref_str(core.sex, core.peds),
                                   issued=issued.strftime("%Y-%m-%dT%H:%M:%S"), performer_hospital=perf,
                                   signature=sig))
    out.sort(key=lambda o: (o.issued, o.obs_id))
    return out


def fmt_value(obs: Observation) -> str:
    lab = V.LABS.get(obs.code)
    dec = lab.decimals if lab else 2
    return f"{obs.value:.{dec}f}"


def flag(obs: Observation) -> str:
    rr = obs.ref_range
    try:
        if rr.startswith("<"):
            return "H" if obs.value >= float(rr[1:]) else ""
        if rr.startswith(">="):
            return "L" if obs.value < float(rr[2:]) else ""
        lo, hi = (float(x) for x in rr.split("-"))
    except ValueError:
        return ""
    if obs.value < lo:
        return "L"
    if obs.value > hi:
        return "H"
    return ""


# --------------------------------------------------------------------------- census


class Census:
    """Which hospital each row belongs to, and each row's MRN. Cheap to build (~N HMACs)."""

    def __init__(self, key: bytes, session: str):
        self.key, self.session = key, session
        rng = entity_rng(key, session, "census")
        beds = sum(v[2] for v in CLINICAL_HOSPITALS.values())
        counts = {}
        for hid in HOSPITAL_ORDER:
            share = TARGET_POPULATION * CLINICAL_HOSPITALS[hid][2] / beds
            counts[hid] = int(round(share)) + rng.randint(-9, 14)
        labels = [h for h in HOSPITAL_ORDER for _ in range(counts[h])]
        rng.shuffle(labels)
        self.hospital_of: list[str] = labels
        self.n = len(labels)
        self.counts = counts
        self.by_hospital: dict[str, list[int]] = {h: [] for h in HOSPITAL_ORDER}
        for i, h in enumerate(labels):
            self.by_hospital[h].append(i)
        self.mrn_of: list[str] = []
        self.idx_of: dict[str, int] = {}
        for i in range(self.n):
            num = int.from_bytes(entity_digest(key, session, f"mrn/{i}")[:8], "big") % 900000 + 100000
            mrn = f"MRN-{num}"
            while mrn in self.idx_of:
                num = (num - 100000 + 7919) % 900000 + 100000
                mrn = f"MRN-{num}"
            self.mrn_of.append(mrn)
            self.idx_of[mrn] = i
        # registrations: the last few rows arrived after the older nightly dumps
        self.recent_13 = rng.randint(9, 22)      # rows registered on 13 Nov (after the 13 Nov dump)
        self.recent_12 = rng.randint(8, 20)      # rows registered on 12 Nov
        self.rosters: dict[str, list[Clinician]] = {h: build_roster(key, session, h) for h in HOSPITAL_ORDER}

    def updated_at(self, idx: int) -> datetime:
        rng = random.Random(int.from_bytes(entity_digest(self.key, self.session, f"upd/{idx}")[:8], "big"))
        n = self.n
        if idx >= n - self.recent_13:
            return datetime(2026, 11, 13, 3, 0) + timedelta(minutes=rng.randint(0, 20 * 60))
        if idx >= n - self.recent_13 - self.recent_12:
            return datetime(2026, 11, 12, 3, 0) + timedelta(minutes=rng.randint(0, 20 * 60))
        return datetime(2026, 11, 11, 23, 0) - timedelta(minutes=rng.randint(0, 89 * 24 * 60))

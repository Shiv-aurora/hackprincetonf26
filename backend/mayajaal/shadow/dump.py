"""pg_dump-style SQL text for the shadow nightly backups, plus a parser for its COPY rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Iterable

from mayajaal.world_api import Observation, Patient

PREVIEW_ROWS = 200
LAB_PREVIEW_PATIENTS = 12

PATIENT_COLUMNS = ["id", "mrn", "family_name", "given_name", "birth_date", "sex", "facility_id", "address", "phone",
                   "attending", "problem_list", "medications", "allergies", "clinical_notes", "updated_at"]
LAB_COLUMNS = ["id", "accession", "mrn", "loinc_code", "test_name", "value", "unit", "ref_range", "flag",
               "performing_lab", "resulted_at"]
LIST_SEP = "; "


@dataclass
class DumpSpec:
    path: str
    started: datetime        # when pg_dump began
    rows: int                # rows in public.patients
    size: int                # compressed bytes (what ls shows)
    database: str = "meridian_pmi"


def copy_escape(v: object) -> str:
    if v is None:
        return r"\N"
    s = str(v)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def copy_unescape(s: str) -> str | None:
    if s == r"\N":
        return None
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            out.append({"t": "\t", "n": "\n", "r": "\r", "\\": "\\"}.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def patient_copy_row(row_id: int, p: Patient, updated_at: datetime) -> str:
    given, _, family = p.name.partition(" ")
    vals = [row_id, p.mrn, family, given, p.dob, p.sex, p.hospital_id, p.address, p.phone, p.attending,
            LIST_SEP.join(p.conditions), LIST_SEP.join(p.medications), LIST_SEP.join(p.allergies), p.notes,
            updated_at.strftime("%Y-%m-%d %H:%M:%S")]
    return "\t".join(copy_escape(v) for v in vals)


def patient_from_copy_row(line: str) -> Patient:
    f = [copy_unescape(x) or "" for x in line.split("\t")]
    d = dict(zip(PATIENT_COLUMNS, f))

    def lst(s: str) -> list[str]:
        return [x for x in s.split(LIST_SEP) if x] if s else []

    return Patient(mrn=d["mrn"], name=f"{d['given_name']} {d['family_name']}", dob=d["birth_date"], sex=d["sex"],
                   hospital_id=d["facility_id"], address=d["address"], phone=d["phone"], conditions=lst(d["problem_list"]),
                   medications=lst(d["medications"]), allergies=lst(d["allergies"]), attending=d["attending"],
                   notes=d["clinical_notes"])


def parse_patient_rows(sql: str) -> list[Patient]:
    """Extract the patients COPY block from dump text (used by tests and by anyone replaying a dump)."""
    out: list[Patient] = []
    inside = False
    for line in sql.splitlines():
        if line.startswith("COPY public.patients "):
            inside = True
            continue
        if inside:
            if line == "\\.":
                break
            out.append(patient_from_copy_row(line))
    return out


HEADER = """--
-- PostgreSQL database dump
--

-- Dumped from database version 14.13 (Ubuntu 14.13-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.13 (Ubuntu 14.13-0ubuntu0.22.04.1)

-- Started on {started}

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: patients; Type: TABLE; Schema: public; Owner: pmi_app
--

CREATE TABLE public.patients (
    id integer NOT NULL,
    mrn character varying(12) NOT NULL,
    family_name text NOT NULL,
    given_name text NOT NULL,
    birth_date date NOT NULL,
    sex character(1) NOT NULL,
    facility_id character varying(8) NOT NULL,
    address text,
    phone character varying(20),
    attending text,
    problem_list text,
    medications text,
    allergies text,
    clinical_notes text,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.patients OWNER TO pmi_app;

--
-- Name: patients_id_seq; Type: SEQUENCE; Schema: public; Owner: pmi_app
--

CREATE SEQUENCE public.patients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.patients_id_seq OWNER TO pmi_app;

ALTER SEQUENCE public.patients_id_seq OWNED BY public.patients.id;

--
-- Name: lab_results; Type: TABLE; Schema: public; Owner: pmi_app
--

CREATE TABLE public.lab_results (
    id bigint NOT NULL,
    accession character varying(24) NOT NULL,
    mrn character varying(12) NOT NULL,
    loinc_code character varying(10) NOT NULL,
    test_name text NOT NULL,
    value numeric(10,2),
    unit character varying(20),
    ref_range character varying(20),
    flag character(1),
    performing_lab character varying(8) NOT NULL,
    resulted_at timestamp without time zone NOT NULL
);


ALTER TABLE public.lab_results OWNER TO pmi_app;

--
-- Data for Name: patients; Type: TABLE DATA; Schema: public; Owner: pmi_app
--

COPY public.patients ({pcols}) FROM stdin;
"""

TRAILER = """
--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: pmi_app
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: patients_mrn_key; Type: INDEX; Schema: public; Owner: pmi_app
--

CREATE UNIQUE INDEX patients_mrn_key ON public.patients USING btree (mrn);


--
-- Name: lab_results_mrn_idx; Type: INDEX; Schema: public; Owner: pmi_app
--

CREATE INDEX lab_results_mrn_idx ON public.lab_results USING btree (mrn, resulted_at DESC);


--
-- Name: lab_results lab_results_mrn_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pmi_app
--

ALTER TABLE ONLY public.lab_results
    ADD CONSTRAINT lab_results_mrn_fkey FOREIGN KEY (mrn) REFERENCES public.patients(mrn);


-- Completed on {completed}

--
-- PostgreSQL database dump complete
--
"""


def render_dump(spec: DumpSpec, rows: Iterable[tuple[int, Patient, datetime]],
                labs: Iterable[Observation], lab_total: int, flag_fn: Callable[[Observation], str],
                completed: datetime) -> str:
    rows = list(rows)
    parts = [HEADER.format(started=spec.started.strftime("%Y-%m-%d %H:%M:%S EST"), pcols=", ".join(PATIENT_COLUMNS))]
    for row_id, p, upd in rows:
        parts.append(patient_copy_row(row_id, p, upd) + "\n")
    parts.append("\\.\n")
    shown = len(rows)
    if spec.rows > shown:
        parts.append(f"-- [{spec.rows - shown:,} further rows of public.patients follow in the full stream; "
                     f"{spec.rows:,} rows total]\n")
    parts.append("\n\n--\n-- Data for Name: lab_results; Type: TABLE DATA; Schema: public; Owner: pmi_app\n--\n\n")
    parts.append(f"COPY public.lab_results ({', '.join(LAB_COLUMNS)}) FROM stdin;\n")
    labs = list(labs)
    for i, o in enumerate(labs):
        acc = o.obs_id.rsplit(".", 1)[0]
        vals = [i + 1, acc, o.mrn, o.code, o.display, f"{o.value:.2f}", o.unit, o.ref_range, flag_fn(o) or None,
                o.performer_hospital.upper(), o.issued.replace("T", " ")]
        parts.append("\t".join(copy_escape(v) for v in vals) + "\n")
    parts.append("\\.\n")
    if lab_total > len(labs):
        parts.append(f"-- [{lab_total - len(labs):,} further rows of public.lab_results follow in the full stream; "
                     f"{lab_total:,} rows total]\n")
    parts.append(TRAILER.format(completed=completed.strftime("%Y-%m-%d %H:%M:%S EST")))
    return "".join(parts)

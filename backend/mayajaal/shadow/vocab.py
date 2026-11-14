"""Static vocabulary for the shadow hospital: names, streets, ICD-10 conditions, medications,
allergies and LOINC lab definitions. Public templates only; nothing here comes from real data.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from faker.providers.person.en_IN import Provider as _PersonIN
from faker.providers.person.en_US import Provider as _PersonUS
from faker.providers.person.es_MX import Provider as _PersonMX
from faker.providers.person.yo_NG import Provider as _PersonNG

from mayajaal.shadow.seeding import Weighted

# --------------------------------------------------------------------------- names


def _w(table) -> Weighted:
    if isinstance(table, dict):
        return Weighted(list(table.keys()), list(table.values()))
    items = list(table)
    return Weighted(items, [1.0] * len(items))


def _clean(names) -> list[str]:
    return [n for n in names if " " not in n and n.isalpha()]


EAST_ASIAN_FIRST_F = ["Mei", "Lin", "Yuna", "Hana", "Jia", "Xin", "Minji", "Seo-yeon", "Thao", "Linh", "Mai", "Ying"]
EAST_ASIAN_FIRST_M = ["Wei", "Jun", "Hiroshi", "Minho", "Tuan", "Hao", "Kenji", "Jae", "Bao", "Long", "Chen", "Daniel"]
EAST_ASIAN_LAST = ["Chen", "Wang", "Li", "Zhang", "Liu", "Nguyen", "Tran", "Pham", "Kim", "Park", "Lee", "Choi",
                   "Tanaka", "Sato", "Huang", "Lin", "Wu", "Le", "Yamamoto", "Zhou"]

# (weight, first_f, first_m, last) per name pool; Meridian City is a diverse mid-size city.
NAME_POOLS = [
    (0.66, _w(_PersonUS.first_names_female), _w(_PersonUS.first_names_male), _w(_PersonUS.last_names)),
    (0.16, _w(_clean(_PersonMX.first_names_female)), _w(_clean(_PersonMX.first_names_male)),
     _w(_clean(_PersonMX.last_names))),
    (0.08, _w(_clean(_PersonIN.first_names_female)), _w(_clean(_PersonIN.first_names_male)),
     _w(_clean(_PersonIN.last_names))),
    (0.06, _w(_clean(_PersonNG.first_names_female)), _w(_clean(_PersonNG.first_names_male)),
     _w(_clean(_PersonNG.last_names))),
    (0.04, _w(EAST_ASIAN_FIRST_F), _w(EAST_ASIAN_FIRST_M), _w(EAST_ASIAN_LAST)),
]
NAME_POOL_PICK = Weighted(list(range(len(NAME_POOLS))), [p[0] for p in NAME_POOLS])

# --------------------------------------------------------------------------- addresses

CITY = "Meridian City"
STATE = "MC"
AREA_CODES = ["471", "471", "471", "738"]

STREET_NAMES = [
    "Harbor", "Lantern", "Quarry", "Mill", "Juniper", "Orchard", "Beacon", "Canal", "Foundry", "Chestnut",
    "Sycamore", "Willow", "Granite", "Riverside", "Market", "Union", "Station", "Prospect", "Linden", "Magnolia",
    "Cedar", "Elm", "Maple", "Oak", "Pine", "Birch", "Hawthorne", "Kingsley", "Aurelia", "Northgate", "Eastbank",
    "Westfield", "Lumen", "Meridian", "Tanner", "Cooper", "Founders", "Bridgewater", "Ashford", "Delancey",
    "Holloway", "Pemberton", "Larkspur", "Copper", "Fulton", "Garrison", "Highland", "Ivy", "Laurel", "Monroe",
    "Franklin", "Jefferson", "Lincoln", "Madison", "Washington", "Adams", "Clinton", "Grant", "Hamilton",
    "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Twelfth",
]
STREET_SUFFIX = _w({"St": 30, "Ave": 22, "Rd": 12, "Dr": 10, "Ln": 7, "Ct": 5, "Blvd": 4, "Way": 4, "Pl": 3,
                    "Ter": 2, "Pkwy": 1})
UNIT_FORMATS = ["Apt {n}", "Apt {n}{l}", "Unit {n}", "#{n}"]

# Neighbourhood ZIPs: each hospital draws mostly from its own catchment.
ZIPS = {
    "aur": ["47101", "47102", "47103", "47104", "47110"],
    "riv": ["47120", "47121", "47122", "47101", "47130"],
    "nor": ["47140", "47141", "47142", "47143", "47110"],
    "eas": ["47150", "47151", "47152", "47104"],
    "wes": ["47160", "47161", "47162", "47130", "47121"],
}

# --------------------------------------------------------------------------- labs


@dataclass(frozen=True)
class Lab:
    code: str
    display: str
    unit: str
    decimals: int
    f: tuple[float, float]          # adult female reference interval
    m: tuple[float, float]          # adult male reference interval
    peds: tuple[float, float] | None = None
    ref_text: str | None = None     # override printed range (e.g. "<100")
    inhouse: float = 0.12           # chance a result is run in-house instead of at Lumen
    lo_floor: float = 0.0

    def ref(self, sex: str, peds: bool) -> tuple[float, float]:
        if peds and self.peds:
            return self.peds
        return self.f if sex == "F" else self.m

    def ref_str(self, sex: str, peds: bool) -> str:
        if self.ref_text:
            return self.ref_text
        lo, hi = self.ref(sex, peds)
        return f"{lo:.{self.decimals}f}-{hi:.{self.decimals}f}"


LABS: dict[str, Lab] = {lab.code: lab for lab in [
    Lab("718-7", "Hemoglobin", "g/dL", 1, (12.0, 15.5), (13.5, 17.5), (11.0, 14.5)),
    Lab("6690-2", "Leukocytes", "10*3/uL", 1, (4.0, 11.0), (4.0, 11.0), (5.0, 14.5)),
    Lab("777-3", "Platelets", "10*3/uL", 0, (150, 400), (150, 400), (150, 450)),
    Lab("2951-2", "Sodium", "mmol/L", 0, (136, 145), (136, 145), (135, 145), inhouse=0.2),
    Lab("2823-3", "Potassium", "mmol/L", 1, (3.5, 5.1), (3.5, 5.1), (3.4, 4.7), inhouse=0.2),
    Lab("2160-0", "Creatinine", "mg/dL", 2, (0.59, 1.04), (0.74, 1.35), (0.30, 0.70), inhouse=0.2),
    Lab("2345-7", "Glucose", "mg/dL", 0, (70, 99), (70, 99), (70, 99), inhouse=0.35),
    Lab("62238-1", "eGFR (CKD-EPI 2021)", "mL/min/1.73m2", 0, (60, 120), (60, 120), ref_text=">=60"),
    Lab("4548-4", "Hemoglobin A1c", "%", 1, (4.0, 5.6), (4.0, 5.6), (4.0, 5.6), inhouse=0.03),
    Lab("13457-7", "LDL Cholesterol (calc)", "mg/dL", 0, (50, 99), (50, 99), (50, 109), ref_text="<100", inhouse=0.03),
    Lab("3016-3", "TSH", "mIU/L", 2, (0.45, 4.50), (0.45, 4.50), (0.70, 5.70), inhouse=0.02),
    Lab("6301-6", "INR", "{INR}", 1, (0.8, 1.1), (0.8, 1.1), (0.8, 1.1), inhouse=0.25),
    Lab("89579-7", "Troponin I, high sensitivity", "ng/L", 0, (2, 15), (2, 33), (1, 10), ref_text="<34",
        inhouse=0.6),
    Lab("30934-4", "BNP", "pg/mL", 0, (10, 99), (10, 99), ref_text="<100", inhouse=0.3),
    Lab("2276-4", "Ferritin", "ng/mL", 0, (11, 307), (24, 336), (7, 140), inhouse=0.02),
    Lab("1742-6", "ALT", "U/L", 0, (7, 35), (7, 56), (5, 45)),
    Lab("2524-7", "Lactate", "mmol/L", 1, (0.5, 2.2), (0.5, 2.2), (0.5, 2.2), inhouse=0.7),
    Lab("1989-3", "25-OH Vitamin D", "ng/mL", 0, (30, 100), (30, 100), (30, 100), inhouse=0.0),
]}

CORE_LABS = ["718-7", "6690-2", "777-3", "2951-2", "2823-3", "2160-0", "2345-7"]

# --------------------------------------------------------------------------- conditions


@dataclass(frozen=True)
class Condition:
    code: str
    display: str
    meds: tuple[str, ...]
    specialty: str
    labs: dict[str, tuple[float, float]] = field(default_factory=dict)   # code -> abnormal value range
    order_labs: tuple[str, ...] = ()                                   # extra tests this dx triggers
    w_adult: float = 0.0
    w_peds: float = 0.0
    w_cardiac: float = 0.0
    n_meds: tuple[int, int] = (1, 2)
    sex: str | None = None
    min_age: int = 0
    max_age: int = 120
    acute: bool = False
    short: str = ""                 # how a clinician abbreviates it in notes

    @property
    def label(self) -> str:
        return f"{self.code} {self.display}"


C = Condition
CONDITIONS: list[Condition] = [
    # ---- metabolic / renal
    C("E11.9", "Type 2 diabetes mellitus without complications",
      ("Metformin 1000 mg PO BID", "Empagliflozin 10 mg PO daily", "Insulin glargine 22 units SC nightly",
       "Sitagliptin 100 mg PO daily", "Glipizide 5 mg PO daily"),
      "Endocrinology", {"4548-4": (6.8, 10.9), "2345-7": (128, 262)}, ("4548-4", "13457-7"),
      w_adult=14, w_cardiac=16, min_age=25, short="T2DM"),
    C("E11.22", "Type 2 diabetes mellitus with diabetic chronic kidney disease",
      ("Insulin glargine 18 units SC nightly", "Insulin lispro per sliding scale SC TID AC",
       "Linagliptin 5 mg PO daily", "Empagliflozin 10 mg PO daily"),
      "Nephrology", {"4548-4": (7.2, 11.4), "2345-7": (140, 290), "62238-1": (24, 52), "2823-3": (4.9, 5.6)},
      ("4548-4", "13457-7"), w_adult=4, w_cardiac=4, min_age=40, short="T2DM with DKD"),
    C("I10", "Essential (primary) hypertension",
      ("Lisinopril 20 mg PO daily", "Amlodipine 5 mg PO daily", "Losartan 50 mg PO daily",
       "Hydrochlorothiazide 25 mg PO daily", "Chlorthalidone 12.5 mg PO daily"),
      "Internal Medicine", {}, (), w_adult=24, w_cardiac=30, min_age=25, short="HTN"),
    C("E78.5", "Hyperlipidemia, unspecified",
      ("Atorvastatin 40 mg PO nightly", "Rosuvastatin 20 mg PO daily", "Simvastatin 20 mg PO nightly"),
      "Internal Medicine", {"13457-7": (101, 192)}, ("13457-7",), w_adult=16, w_cardiac=22, n_meds=(1, 1),
      min_age=30, short="HLD"),
    C("N18.30", "Chronic kidney disease, stage 3 unspecified",
      ("Sodium bicarbonate 650 mg PO BID", "Calcitriol 0.25 mcg PO daily"),
      "Nephrology", {"62238-1": (31, 58), "2823-3": (4.8, 5.5), "718-7": (10.4, 12.2)}, (),
      w_adult=6, w_cardiac=8, n_meds=(0, 1), min_age=45, short="CKD 3"),
    C("N18.4", "Chronic kidney disease, stage 4 (severe)",
      ("Sodium bicarbonate 650 mg PO TID", "Sevelamer 800 mg PO TID with meals", "Calcitriol 0.25 mcg PO daily"),
      "Nephrology", {"62238-1": (16, 29), "2823-3": (5.0, 5.9), "718-7": (9.1, 11.2)}, ("2276-4",),
      w_adult=1.5, w_cardiac=2, n_meds=(1, 2), min_age=50, short="CKD 4"),
    C("E03.9", "Hypothyroidism, unspecified",
      ("Levothyroxine 75 mcg PO daily before breakfast", "Levothyroxine 100 mcg PO daily before breakfast",
       "Levothyroxine 50 mcg PO daily before breakfast"),
      "Endocrinology", {"3016-3": (4.9, 11.8)}, ("3016-3",), w_adult=6, w_cardiac=4, w_peds=0.5, n_meds=(1, 1), min_age=3,
      short="hypothyroid"),
    C("E66.9", "Obesity, unspecified", ("Semaglutide 0.5 mg SC weekly",), "Internal Medicine", {}, (),
      w_adult=8, w_peds=3, w_cardiac=6, n_meds=(0, 1), min_age=4, short="obesity"),
    C("K76.0", "Fatty (change of) liver, not elsewhere classified", (), "Gastroenterology",
      {"1742-6": (58, 142)}, ("1742-6",), w_adult=3, n_meds=(0, 0), min_age=25, short="NAFLD"),
    C("M81.0", "Age-related osteoporosis without current pathological fracture",
      ("Alendronate 70 mg PO weekly", "Cholecalciferol 2000 units PO daily", "Calcium carbonate 600 mg PO BID"),
      "Internal Medicine", {"1989-3": (11, 27)}, ("1989-3",), w_adult=3, sex="F", min_age=55, short="osteoporosis"),
    # ---- haematology
    C("D50.9", "Iron deficiency anemia, unspecified",
      ("Ferrous sulfate 325 mg PO daily", "Ferrous sulfate 325 mg PO every other day"),
      "Hematology", {"718-7": (8.1, 10.6), "2276-4": (3, 14)}, ("2276-4",), w_adult=5, w_peds=2, n_meds=(1, 1),
      short="IDA"),
    C("D64.9", "Anemia, unspecified", ("Folic acid 1 mg PO daily",), "Internal Medicine",
      {"718-7": (8.6, 11.2)}, ("2276-4",), w_adult=3, w_cardiac=2, n_meds=(0, 1), short="anemia"),
    C("D57.1", "Sickle-cell disease without crisis",
      ("Hydroxyurea 500 mg PO daily", "Folic acid 1 mg PO daily", "Penicillin VK 250 mg PO BID"),
      "Pediatric Hematology", {"718-7": (6.8, 9.2), "6690-2": (10.5, 15.5)}, ("2276-4",), w_peds=1.5,
      n_meds=(2, 3), max_age=17, short="SCD"),
    # ---- cardiac
    C("I48.91", "Unspecified atrial fibrillation",
      ("Apixaban 5 mg PO BID", "Warfarin 5 mg PO daily", "Metoprolol succinate 50 mg PO daily",
       "Diltiazem ER 180 mg PO daily"),
      "Cardiology", {}, (), w_adult=5, w_cardiac=22, n_meds=(2, 2), min_age=50, short="AF"),
    C("I50.22", "Chronic systolic (congestive) heart failure",
      ("Furosemide 40 mg PO daily", "Sacubitril-valsartan 49-51 mg PO BID", "Carvedilol 12.5 mg PO BID",
       "Spironolactone 25 mg PO daily", "Dapagliflozin 10 mg PO daily"),
      "Cardiology", {"30934-4": (420, 2400), "2951-2": (131, 136)}, ("30934-4", "89579-7"), w_adult=3, w_cardiac=20,
      n_meds=(3, 4), min_age=45, short="HFrEF"),
    C("I25.10", "Atherosclerotic heart disease of native coronary artery without angina pectoris",
      ("Aspirin 81 mg PO daily", "Atorvastatin 80 mg PO nightly", "Clopidogrel 75 mg PO daily",
       "Metoprolol tartrate 25 mg PO BID"),
      "Cardiology", {"89579-7": (8, 30)}, ("89579-7", "13457-7"), w_adult=4, w_cardiac=26, n_meds=(2, 3),
      min_age=40, short="CAD"),
    C("I21.4", "Non-ST elevation (NSTEMI) myocardial infarction",
      ("Aspirin 81 mg PO daily", "Ticagrelor 90 mg PO BID", "Heparin infusion per ACS protocol",
       "Atorvastatin 80 mg PO nightly", "Metoprolol tartrate 25 mg PO BID"),
      "Cardiology", {"89579-7": (180, 6400)}, ("89579-7", "13457-7"), w_adult=0.8, w_cardiac=9, n_meds=(3, 4),
      min_age=40, acute=True, short="NSTEMI"),
    C("I35.0", "Nonrheumatic aortic (valve) stenosis",
      ("Furosemide 20 mg PO daily",), "Cardiothoracic Surgery", {"30934-4": (140, 620)}, ("30934-4",),
      w_cardiac=7, n_meds=(0, 1), min_age=60, short="AS"),
    C("I63.9", "Cerebral infarction, unspecified",
      ("Aspirin 81 mg PO daily", "Clopidogrel 75 mg PO daily", "Atorvastatin 80 mg PO nightly"),
      "Neurology", {}, ("13457-7",), w_adult=0.8, w_cardiac=1, n_meds=(2, 3), min_age=45, acute=True,
      short="CVA"),
    # ---- respiratory
    C("J44.9", "Chronic obstructive pulmonary disease, unspecified",
      ("Tiotropium 18 mcg inhaled daily", "Albuterol HFA 2 puffs inhaled q4h PRN wheeze",
       "Fluticasone-salmeterol 250-50 mcg 1 puff inhaled BID"),
      "Pulmonology", {}, (), w_adult=5, w_cardiac=4, n_meds=(2, 3), min_age=45, short="COPD"),
    C("J45.909", "Unspecified asthma, uncomplicated",
      ("Albuterol HFA 2 puffs inhaled q4h PRN wheeze", "Fluticasone HFA 110 mcg 2 puffs inhaled BID",
       "Montelukast 10 mg PO nightly"),
      "Pulmonology", {}, (), w_adult=5, w_peds=16, n_meds=(1, 2), min_age=2, short="asthma"),
    C("J18.9", "Pneumonia, unspecified organism",
      ("Ceftriaxone 1 g IV q24h", "Azithromycin 500 mg PO daily", "Doxycycline 100 mg PO BID"),
      "Infectious Disease", {"6690-2": (12.1, 19.4)}, (), w_adult=2.5, w_peds=3, w_cardiac=1, n_meds=(2, 2),
      acute=True, short="CAP"),
    C("G47.33", "Obstructive sleep apnea (adult) (pediatric)", (), "Pulmonology", {}, (), w_adult=4,
      w_cardiac=5, n_meds=(0, 0), min_age=30, short="OSA"),
    # ---- infection / acute
    C("A41.9", "Sepsis, unspecified organism",
      ("Piperacillin-tazobactam 4.5 g IV q6h", "Vancomycin per pharmacy dosing IV", "Lactated Ringer's 30 mL/kg IV bolus"),
      "Infectious Disease", {"6690-2": (15.2, 27.8), "2524-7": (2.4, 5.6)}, ("2524-7",), w_adult=1.2, w_peds=0.4,
      n_meds=(2, 3), acute=True, short="sepsis"),
    C("N39.0", "Urinary tract infection, site not specified",
      ("Nitrofurantoin 100 mg PO BID x5 days", "Cephalexin 500 mg PO BID x7 days"), "Internal Medicine",
      {"6690-2": (10.8, 14.6)}, (), w_adult=3, w_peds=1, n_meds=(1, 1), short="UTI"),
    C("K35.80", "Unspecified acute appendicitis", ("Ceftriaxone 2 g IV q24h", "Metronidazole 500 mg IV q8h"),
      "General Surgery", {"6690-2": (12.5, 18.2)}, (), w_adult=0.8, w_peds=1.5, n_meds=(2, 2), max_age=60,
      acute=True, short="appendicitis"),
    # ---- other chronic adult
    C("K21.9", "Gastro-esophageal reflux disease without esophagitis",
      ("Omeprazole 20 mg PO daily", "Pantoprazole 40 mg PO daily", "Famotidine 20 mg PO BID"),
      "Internal Medicine", {}, (), w_adult=8, w_cardiac=6, n_meds=(1, 1), short="GERD"),
    C("F32.9", "Major depressive disorder, single episode, unspecified",
      ("Sertraline 50 mg PO daily", "Escitalopram 10 mg PO daily", "Bupropion XL 150 mg PO daily"),
      "Psychiatry", {}, (), w_adult=6, w_cardiac=3, w_peds=0.6, n_meds=(1, 1), min_age=13, short="MDD"),
    C("F41.1", "Generalized anxiety disorder", ("Buspirone 10 mg PO BID", "Hydroxyzine 25 mg PO TID PRN anxiety"),
      "Psychiatry", {}, (), w_adult=4, w_peds=0.6, n_meds=(1, 1), min_age=12, short="GAD"),
    C("M17.11", "Unilateral primary osteoarthritis, right knee",
      ("Acetaminophen 650 mg PO q6h PRN pain", "Meloxicam 7.5 mg PO daily", "Diclofenac 1% gel topical QID"),
      "Orthopedics", {}, (), w_adult=4, w_cardiac=2, n_meds=(1, 2), min_age=45, short="R knee OA"),
    C("C50.911", "Malignant neoplasm of unspecified site of right female breast",
      ("Anastrozole 1 mg PO daily", "Ondansetron 8 mg PO q8h PRN nausea"), "Oncology",
      {"718-7": (9.4, 11.6), "6690-2": (2.6, 3.9)}, (), w_adult=1.2, sex="F", min_age=35, short="R breast CA"),
    C("G40.909", "Epilepsy, unspecified, not intractable, without status epilepticus",
      ("Levetiracetam 500 mg PO BID", "Lamotrigine 100 mg PO BID"), "Neurology", {}, (), w_adult=1.2, w_peds=2,
      n_meds=(1, 1), short="epilepsy"),
    # ---- paediatric
    C("E10.9", "Type 1 diabetes mellitus without complications",
      ("Insulin glargine 12 units SC nightly", "Insulin lispro per carb ratio SC with meals",
       "Glucagon 1 mg IM PRN severe hypoglycemia"),
      "Pediatric Endocrinology", {"4548-4": (7.4, 11.2), "2345-7": (148, 318)}, ("4548-4",), w_peds=4, w_adult=0.5,
      n_meds=(2, 3), min_age=2, short="T1DM"),
    C("H66.90", "Otitis media, unspecified, unspecified ear",
      ("Amoxicillin 400 mg/5 mL PO BID x10 days", "Ibuprofen 10 mg/kg PO q6h PRN fever"), "Pediatrics", {}, (),
      w_peds=10, n_meds=(1, 2), max_age=10, short="AOM"),
    C("J21.9", "Acute bronchiolitis, unspecified", ("Nasal saline drops PRN", "Acetaminophen 15 mg/kg PO q6h PRN fever"),
      "Pediatrics", {"6690-2": (9.0, 15.8)}, (), w_peds=5, n_meds=(0, 1), max_age=2, acute=True,
      short="bronchiolitis"),
    C("F90.2", "Attention-deficit hyperactivity disorder, combined type",
      ("Methylphenidate ER 18 mg PO daily", "Guanfacine ER 1 mg PO daily"), "Pediatrics", {}, (), w_peds=7,
      n_meds=(1, 1), min_age=5, max_age=17, short="ADHD"),
    C("L20.9", "Atopic dermatitis, unspecified", ("Hydrocortisone 2.5% cream topical BID", "Cetirizine 5 mg PO daily"),
      "Pediatrics", {}, (), w_peds=8, n_meds=(1, 2), max_age=17, short="eczema"),
    C("K59.00", "Constipation, unspecified", ("Polyethylene glycol 3350 8.5 g PO daily",), "Pediatrics", {}, (),
      w_peds=5, n_meds=(1, 1), short="constipation"),
    C("R56.00", "Simple febrile convulsions", ("Acetaminophen 15 mg/kg PO q6h PRN fever",), "Pediatrics",
      {"6690-2": (11.0, 16.4)}, (), w_peds=1.5, n_meds=(0, 1), max_age=5, acute=True, short="febrile seizure"),
]

ADULT_DX = Weighted(CONDITIONS, [c.w_adult for c in CONDITIONS])
PEDS_DX = Weighted(CONDITIONS, [c.w_peds for c in CONDITIONS])
CARDIAC_DX = Weighted(CONDITIONS, [c.w_cardiac for c in CONDITIONS])
DX_BY_CODE = {c.code: c for c in CONDITIONS}
ACUTE_ADULT = [c for c in CONDITIONS if c.acute and c.w_adult > 0]
ACUTE_PEDS = [c for c in CONDITIONS if c.acute and c.w_peds > 0]
ACUTE_CARDIAC = [c for c in CONDITIONS if c.acute and c.w_cardiac > 0]

ADULT_EXTRA_MEDS = ["Acetaminophen 500 mg PO q6h PRN pain", "Cholecalciferol 1000 units PO daily",
                    "Multivitamin 1 tab PO daily", "Docusate 100 mg PO BID PRN", "Melatonin 3 mg PO nightly PRN"]
INPATIENT_MEDS = ["Enoxaparin 40 mg SC daily", "Ondansetron 4 mg IV q8h PRN nausea",
                  "Acetaminophen 650 mg PO q6h PRN pain", "Senna 8.6 mg PO nightly"]

# --------------------------------------------------------------------------- allergies

ALLERGIES = _w({
    "Penicillin (hives)": 10, "Sulfonamide antibiotics (rash)": 6, "Codeine (nausea/vomiting)": 4,
    "Amoxicillin (rash)": 3, "Latex (contact dermatitis)": 2, "Iodinated contrast (urticaria)": 2,
    "Morphine (pruritus)": 2, "Shellfish (anaphylaxis)": 2, "Peanuts (anaphylaxis)": 2,
    "Lisinopril (angioedema)": 1, "Cephalexin (rash)": 1, "Ibuprofen (GI upset)": 2, "Eggs (hives)": 1,
    "Vancomycin (red man syndrome)": 1, "Tree nuts (anaphylaxis)": 1, "Adhesive tape (skin irritation)": 1,
})
PEDS_ALLERGIES = _w({
    "Amoxicillin (rash)": 6, "Penicillin (hives)": 4, "Peanuts (anaphylaxis)": 4, "Eggs (hives)": 3,
    "Tree nuts (anaphylaxis)": 2, "Cow's milk protein (vomiting)": 2, "Sulfonamide antibiotics (rash)": 1,
    "Cephalexin (rash)": 1, "Latex (contact dermatitis)": 1,
})
NKDA = "NKDA"

# --------------------------------------------------------------------------- clinicians

GENERIC_SPECIALTY = {"general": "Internal Medicine", "pediatric": "Pediatrics", "community": "Family Medicine",
                     "cardiac": "Cardiology"}

ROSTER_SPECIALTIES = {
    "general": ["Internal Medicine", "Internal Medicine", "Internal Medicine", "Hospitalist", "Hospitalist",
                "Hospitalist", "Cardiology", "Nephrology", "Pulmonology", "Endocrinology", "Infectious Disease",
                "General Surgery", "Oncology", "Hematology", "Neurology", "Gastroenterology", "Psychiatry",
                "Orthopedics"],
    "pediatric": ["Pediatrics", "Pediatrics", "Pediatrics", "Pediatrics", "Pediatrics", "Pediatric Endocrinology",
                  "Pediatric Hematology", "Pulmonology", "Neonatology", "Psychiatry", "General Surgery"],
    "community": ["Family Medicine", "Family Medicine", "Family Medicine", "Hospitalist", "Hospitalist",
                  "Hospitalist", "Internal Medicine", "Internal Medicine", "Emergency Medicine",
                  "Emergency Medicine", "General Surgery"],
    "cardiac": ["Cardiology", "Cardiology", "Cardiology", "Cardiology", "Interventional Cardiology",
                "Interventional Cardiology", "Electrophysiology", "Heart Failure", "Cardiothoracic Surgery",
                "Cardiothoracic Surgery", "Internal Medicine", "Endocrinology"],
}

# Fallbacks when a hospital has no exact specialist for a problem.
SPECIALTY_FALLBACK = {
    "Hospitalist": "Internal Medicine", "Family Medicine": "Internal Medicine", "Heart Failure": "Cardiology",
    "Interventional Cardiology": "Cardiology", "Electrophysiology": "Cardiology",
}

WARDS = {
    "aur": ["4W", "4E", "5W", "5E", "6N", "ICU", "CCU"],
    "riv": ["2A", "2B", "3A", "PICU"],
    "nor": ["3N", "3S", "4N", "4S", "ICU"],
    "eas": ["3E", "3W", "2E", "ICU"],
    "wes": ["CVU", "CCU", "5C", "6C"],
}

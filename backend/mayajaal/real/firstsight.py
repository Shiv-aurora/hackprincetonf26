"""First Sight: catch a stolen login on first sight, before it does anything a nurse can't do.

The policy rules (policy.py) fire on a single strong signal: a nurse opening the admin portal, a bulk
export, a cross-hospital read. Those are reliable but late: in the recorded attack the first one is the
attacker's 4th request, after they have already seen the nurse's real ward list.

This module adds many WEAK signals and adds them up with a CUSUM test (Page, 1954), the textbook
quickest-detection rule: keep a running score, add each request's evidence, subtract a little for every
request that looks ordinary, never go below zero, and raise the alarm when the score crosses H.

    S_0 = 0,   S_t = max(0, S_{t-1} + x_t),   alarm when S_t >= H
    x_t = sum of the signals that fired on request t,  or  -DRIFT  if none did

Signals (weights are log-likelihood-ratio guesses in nats: hand-set judgement calls, not fitted):

    login     scripted_client   a clinical login whose client is neither the EHR app nor a browser
              no_client         a clinical login that sends no client identity at all
              new_address       this user has logged in before, never from this address
              failed_logins     wrong passwords from the same address just before this success
              unmanaged_device  a clinical login without the hospital's device certificate (devices.py)
    request   machine_pace      >= 3 gaps, all short and nearly identical (coefficient of variation < 0.3)
              burst             two requests less than 0.25 s apart
              probing           a request for something that does not exist (404)
              fan_out           more distinct charts in two minutes than a whole ward (25)

What it does when it fires: the session is raised to the "suspicious" lane, nothing else. The rule
table then does the rest: real clinical reads need badge + MFA (step-up; never faked), and anything
non-clinical is diverted into the decoy. A real nurse wrongly flagged still sees real data after
step-up, which is why a false alarm here is cheap.

Limits, stated plainly: the client string is trivially spoofed and timing can be randomised. An attacker
working FROM the nurse's own workstation (malware on it) has her device, her address and can click at
human speed: First Sight will not catch them, the policy rules and the honeytokens still will. Pure Python, no I/O; reads no patient data.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

H = 2.0
DRIFT = 0.3

W = {
    "scripted_client": 2.2,
    "no_client": 1.0,
    "new_address": 0.8,
    "failed_logins": 0.6,       # per failure, up to 3
    "unmanaged_device": 1.2,    # alone it is not enough: nurses do use the web portal from home
    "machine_pace": 0.9,
    "burst": 0.4,
    "probing": 0.7,
    "fan_out": 0.5,             # per chart beyond FAN_OUT_LIMIT
}

WHY = {
    "scripted_client": "a nurse's login driven by a script, not the EHR app or a browser",
    "no_client": "a nurse's login with no client identity",
    "new_address": "a first login from this address for this user",
    "failed_logins": "wrong passwords from the same address just before",
    "unmanaged_device": "not one of the hospital's own devices",
    "machine_pace": "requests at a machine-regular pace",
    "burst": "requests faster than a person can click",
    "probing": "asking for things that don't exist",
    "fan_out": "opening more charts than a nurse does",
}

CLINICAL_ROLES = {"nurse", "physician", "lab_tech", "pharmacist", "clinician"}
SCRIPTED = ("python-", "curl/", "wget/", "go-http-client", "okhttp", "node", "undici", "axios", "libwww",
            "httpie", "java/", "aiohttp", "powershell", "scrapy", "headless")
KNOWN_CLIENTS = ("meridianehr/",)          # the hospital's own clinical client
BROWSER = ("mozilla/",)
FAN_OUT_LIMIT = 25           # more distinct charts than a whole ward (~20) in two minutes
FAN_OUT_WINDOW = 120.0
FAIL_WINDOW = 600.0


def client_kind(ua: str | None) -> str:
    """'ehr', 'browser', 'scripted' or 'none'."""
    u = (ua or "").strip().lower()
    if not u:
        return "none"
    if any(k in u for k in KNOWN_CLIENTS):
        return "ehr"
    if any(k in u for k in SCRIPTED):
        return "scripted"
    if u.startswith(BROWSER):
        return "browser"
    return "scripted"


@dataclass
class EarlyState:
    score: float = 0.0
    peak: float = 0.0
    n: int = 0
    fired: bool = False
    fired_at: int | None = None        # request number (0 = the login itself)
    reason: str = ""
    client: str = "none"               # client_kind() at login
    last_ts: float | None = None
    gaps: deque = field(default_factory=lambda: deque(maxlen=6))
    charts: deque = field(default_factory=deque)       # (ts, patient id)
    evidence: list[tuple[int, str, float]] = field(default_factory=list)   # (request no, signal, weight)

    def summary(self) -> str:
        names = []
        for _, sig, _ in self.evidence:
            if sig not in names:
                names.append(sig)
        return "; ".join(WHY[s] for s in names)


class FirstSight:
    """Per-session CUSUM over weak signals. Call on_login once, then before/after on every request."""

    def __init__(self, *, h: float = H, drift: float = DRIFT, clock=time.time) -> None:
        self.h, self.drift, self.clock = h, drift, clock
        self.sessions: dict[str, EarlyState] = {}
        self.addresses: dict[str, set[str]] = {}            # username -> addresses seen
        self.failures: dict[str, deque] = {}                # address -> failure timestamps

    # -------------------------------------------------------------- inputs
    def on_failed_login(self, ip: str | None) -> None:
        if ip:
            self.failures.setdefault(ip, deque(maxlen=20)).append(self.clock())

    def on_login(self, session_id: str, *, username: str, role: str, ua: str | None,
                 ip: str | None, managed: bool | None = None) -> EarlyState:
        """managed: True/False if the device certificate was checked, None if unknown (no signal)."""
        st = self.sessions.setdefault(session_id, EarlyState())
        now = self.clock()
        st.last_ts = now
        sigs: list[tuple[str, float]] = []
        kind = st.client = client_kind(ua)
        if role in CLINICAL_ROLES:
            if kind == "scripted":
                sigs.append(("scripted_client", W["scripted_client"]))
            elif kind == "none":
                sigs.append(("no_client", W["no_client"]))
            if managed is False:
                sigs.append(("unmanaged_device", W["unmanaged_device"]))
        seen = self.addresses.setdefault(username, set())
        if ip and seen and ip not in seen:
            sigs.append(("new_address", W["new_address"]))
        if ip:
            seen.add(ip)
            fails = [t for t in self.failures.get(ip, ()) if now - t <= FAIL_WINDOW]
            if fails:
                sigs.append(("failed_logins", W["failed_logins"] * min(3, len(fails))))
            self.failures.pop(ip, None)
        self._step(st, sigs, at=0)
        return st

    def before(self, session_id: str, *, target_patient: str | None = None) -> EarlyState | None:
        """Evidence available when a request arrives (timing, fan-out). Returns the state, or None if
        the session was never seen at login (unauthenticated callers are handled elsewhere)."""
        st = self.sessions.get(session_id)
        if st is None:
            return None
        now = self.clock()
        st.n += 1
        sigs: list[tuple[str, float]] = []
        # The hospital's EHR app loads one screen with several API calls at once and polls, so timing
        # says nothing about it. Timing only counts for browsers and scripts.
        if st.last_ts is not None and st.client != "ehr":
            gap = max(0.0, now - st.last_ts)
            if st.n > 1:                       # the gap after login is think time, not pace
                st.gaps.append(gap)
                if gap < 0.25:
                    sigs.append(("burst", W["burst"]))
            g = list(st.gaps)[-3:]
            if len(g) >= 3:
                mean = sum(g) / len(g)
                sd = (sum((x - mean) ** 2 for x in g) / len(g)) ** 0.5
                if mean < 2.5 and (sd / mean if mean else 0.0) < 0.3:
                    sigs.append(("machine_pace", W["machine_pace"]))
        st.last_ts = now
        if target_patient:
            st.charts.append((now, target_patient))
            while st.charts and now - st.charts[0][0] > FAN_OUT_WINDOW:
                st.charts.popleft()
            distinct = len({p for _, p in st.charts})
            if distinct > FAN_OUT_LIMIT:
                sigs.append(("fan_out", W["fan_out"]))
        self._step(st, sigs, at=st.n)
        return st

    def after(self, session_id: str, *, status: int) -> None:
        """Evidence from the response (a 404 is probing). Counts toward the next request's decision."""
        st = self.sessions.get(session_id)
        if st is not None and status == 404:
            self._step(st, [("probing", W["probing"])], at=st.n, drift=False)

    # -------------------------------------------------------------- the test
    def _step(self, st: EarlyState, sigs: list[tuple[str, float]], *, at: int, drift: bool = True) -> None:
        x = sum(w for _, w in sigs) if sigs else (-self.drift if drift else 0.0)
        st.score = max(0.0, st.score + x)
        st.peak = max(st.peak, st.score)
        st.evidence += [(at, s, w) for s, w in sigs]
        if not st.fired and st.score >= self.h:
            st.fired, st.fired_at = True, at
            where = "at login" if at == 0 else f"by request {at}"
            st.reason = f"First Sight {where} (score {st.score:.1f} ≥ {self.h:.1f}): {st.summary()}."

    def state(self, session_id: str) -> EarlyState | None:
        return self.sessions.get(session_id)


__all__ = ["FirstSight", "EarlyState", "client_kind", "H", "DRIFT", "W", "WHY"]

"""The jump box filesystem (hostname jump-eas): node table and file contents.

Every text file is generated from the same session world as the patient API, so names, MRNs,
lab values and credentials agree wherever the attacker looks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Callable

from mayajaal.shadow.dump import DumpSpec
from mayajaal.shadow.population import NOW, flag, fmt_value
from mayajaal.shadow.seeding import entity_rng, hexs

if TYPE_CHECKING:
    from mayajaal.shadow.world import ShadowWorld

HOME = "/home/n.okafor"
USER = "n.okafor"
USER_FULL = "Ngozi Okafor"
BACKUPS = "/mnt/backups"
WRITABLE_ROOTS = (HOME, "/tmp", "/var/tmp", "/dev/shm", BACKUPS)


@dataclass
class Node:
    kind: str                                   # "file" | "dir"
    mode: str = "-rw-r--r--"
    owner: str = "root"
    group: str = "root"
    mtime: datetime = NOW - timedelta(days=30)
    content: Callable[[], str] | str | None = None
    size: int | None = None                     # fixed size (binary / compressed files)
    readable: bool = True
    dump: DumpSpec | None = None                # pg_dump backups
    tokens: list[str] = field(default_factory=list)   # honeytoken ids touched on read
    patient_rows: Callable[[], list[int]] | None = None   # rows of patients this file carries


def d(mode="drwxr-xr-x", owner="root", group="root", mtime=None, readable=True) -> Node:
    return Node("dir", mode, owner, group, mtime or NOW - timedelta(days=41, hours=3), readable=readable)


def f(content, mode="-rw-r--r--", owner="root", group="root", mtime=None, **kw) -> Node:
    return Node("file", mode, owner, group, mtime or NOW - timedelta(days=41, hours=3), content, **kw)


# --------------------------------------------------------------------------- static system files

OS_RELEASE = """PRETTY_NAME="Ubuntu 22.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
VERSION="22.04.5 LTS (Jammy Jellyfish)"
VERSION_CODENAME=jammy
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=jammy
"""

PASSWD = """root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
sync:x:4:65534:sync:/bin:/bin/sync
games:x:5:60:games:/usr/games:/usr/sbin/nologin
man:x:6:12:man:/var/cache/man:/usr/sbin/nologin
lp:x:7:7:lp:/var/spool/lpd:/usr/sbin/nologin
mail:x:8:8:mail:/var/mail:/usr/sbin/nologin
news:x:9:9:news:/var/spool/news:/usr/sbin/nologin
uucp:x:10:10:uucp:/var/spool/uucp:/usr/sbin/nologin
proxy:x:13:13:proxy:/bin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
backup:x:34:34:backup:/var/backups:/usr/sbin/nologin
list:x:38:38:Mailing List Manager:/var/list:/usr/sbin/nologin
irc:x:39:39:ircd:/run/ircd:/usr/sbin/nologin
gnats:x:41:41:Gnats Bug-Reporting System (admin):/var/lib/gnats:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
_apt:x:100:65534::/nonexistent:/usr/sbin/nologin
systemd-network:x:101:102:systemd Network Management,,,:/run/systemd:/usr/sbin/nologin
systemd-resolve:x:102:103:systemd Resolver,,,:/run/systemd:/usr/sbin/nologin
messagebus:x:103:104::/nonexistent:/usr/sbin/nologin
systemd-timesync:x:104:105:systemd Time Synchronization,,,:/run/systemd:/usr/sbin/nologin
syslog:x:105:111::/home/syslog:/usr/sbin/nologin
uuidd:x:106:112::/run/uuidd:/usr/sbin/nologin
tcpdump:x:107:113::/nonexistent:/usr/sbin/nologin
sshd:x:108:65534::/run/sshd:/usr/sbin/nologin
landscape:x:109:116::/var/lib/landscape:/usr/sbin/nologin
pollinate:x:110:1::/var/cache/pollinate:/bin/false
fwupd-refresh:x:111:118:fwupd-refresh user,,,:/run/systemd:/usr/sbin/nologin
usbmux:x:112:46:usbmux daemon,,,:/var/lib/usbmux:/usr/sbin/nologin
lissync:x:998:998:Lumen LIS sync agent:/opt/lis:/usr/sbin/nologin
eastadmin:x:1000:1000:Eastbank IT,,,:/home/eastadmin:/bin/bash
n.okafor:x:1001:1001:Ngozi Okafor,3E Nursing,x4471,:/home/n.okafor:/bin/bash
d.mensah:x:1002:1002:Daniel Mensah,IT Support,x4020,:/home/d.mensah:/bin/bash
"""

GROUP = """root:x:0:
daemon:x:1:
bin:x:2:
sys:x:3:
adm:x:4:syslog,eastadmin,d.mensah,n.okafor
tty:x:5:
disk:x:6:
lp:x:7:
mail:x:8:
news:x:9:
uucp:x:10:
man:x:12:
proxy:x:13:
kmem:x:15:
dialout:x:20:
cdrom:x:24:eastadmin
floppy:x:25:
sudo:x:27:eastadmin,d.mensah
audio:x:29:
dip:x:30:eastadmin
www-data:x:33:
backup:x:34:
operator:x:37:
list:x:38:
irc:x:39:
src:x:40:
gnats:x:41:
shadow:x:42:
utmp:x:43:
video:x:44:
sasl:x:45:
plugdev:x:46:eastadmin
staff:x:50:
games:x:60:
users:x:100:
nogroup:x:65534:
systemd-journal:x:101:
syslog:x:111:
lpadmin:x:117:eastadmin,d.mensah,n.okafor
lissync:x:998:
eastadmin:x:1000:
n.okafor:x:1001:
d.mensah:x:1002:
eas-helpdesk:x:1100:d.mensah,n.okafor
"""

HOSTS = """127.0.0.1\tlocalhost
127.0.1.1\tjump-eas.eas.meridian.local jump-eas

# The following lines are desirable for IPv6 capable hosts
::1     ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters

# --- Meridian Health Network (managed by Lumen IT, do not edit; last sync 2026-10-03) ---
# Eastbank Community
10.40.4.10\tehr-eas01.eas.meridian.local ehr-eas01
10.40.4.11\tehr-eas02.eas.meridian.local ehr-eas02
10.40.4.21\tpacs-eas.eas.meridian.local pacs-eas
10.40.4.30\tprint-eas3.eas.meridian.local print-eas3
10.40.4.31\tprint-eas-ed.eas.meridian.local print-eas-ed
10.40.4.50\tportal.eas.meridian.local portal-eas
# St. Aurelia General
10.10.4.10\tehr-aur01.aur.meridian.local ehr-aur01
10.10.4.11\tehr-aur02.aur.meridian.local ehr-aur02
10.10.4.50\tportal.aur.meridian.local portal-aur
# Riverside Children's
10.20.4.10\tehr-riv01.riv.meridian.local ehr-riv01
10.20.4.50\tportal.riv.meridian.local portal-riv
# Northgate Medical Center
10.30.4.10\tehr-nor01.nor.meridian.local ehr-nor01
10.30.4.11\tehr-nor02.nor.meridian.local ehr-nor02
10.30.4.50\tportal.nor.meridian.local portal-nor
# Westfield Heart Institute
10.50.4.10\tehr-wes01.wes.meridian.local ehr-wes01
10.50.4.50\tportal.wes.meridian.local portal-wes
# Lumen Shared Pathology
10.60.2.15\tlis-api.lum.meridian.local lis-api
10.60.2.16\tlis-hl7.lum.meridian.local lis-hl7
10.60.2.40\tlum-backup01.lum.meridian.local lum-backup01
10.60.2.50\tresearch-portal.lum.meridian.local research-portal
10.60.2.60\tfhir.lum.meridian.local fhir-lum
# shared
10.0.0.10\tdc01.meridian.local dc01
10.0.0.11\tdc02.meridian.local dc02
10.0.0.25\tsmtp.meridian.local smtp
"""

RESOLV = """# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).
# Do not edit.
nameserver 127.0.0.53
options edns0 trust-ad
search eas.meridian.local meridian.local
"""

FSTAB = """# /etc/fstab: static file system information.
#
# <file system> <mount point>   <type>  <options>       <dump>  <pass>
/dev/mapper/ubuntu--vg-ubuntu--lv /               ext4    defaults        0       1
# /boot was on /dev/sda2 during curtin installation
/dev/disk/by-uuid/5b1e3c0a-7d2e-4f0b-9b1e-2f4c8e6a0d71 /boot ext4 defaults 0 1
/swap.img\tnone\tswap\tsw\t0\t0
# Lumen nightly backups -- creds file lost in the Oct rebuild, mount by hand for now (DM)
#//lum-backup01/nightly  /mnt/backups  cifs  credentials=/root/.smbcred,vers=3.0,noauto  0  0
"""

BASHRC = """# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc)
# for examples

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
shopt -s histappend

HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command
shopt -s checkwinsize

# set a fancy prompt (non-color, unless we know we "want" color)
case "$TERM" in
    xterm-color|*-256color) color_prompt=yes;;
esac

if [ "$color_prompt" = yes ]; then
    PS1='${debian_chroot:+($debian_chroot)}\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '
else
    PS1='${debian_chroot:+($debian_chroot)}\\u@\\h:\\w\\$ '
fi
unset color_prompt

# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
fi

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi

if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi

# --- added for ward helpdesk stuff (NO) ---
export LIS_ENDPOINT=https://lis-api.lum.meridian.local/v2
alias lisget='curl -s -H "X-API-Key: $(awk "/api_key:/ {print \\$2}" /opt/lis/config.yaml)" $LIS_ENDPOINT'
alias backups='ls -lah /mnt/backups'
alias pq='lpstat -o'
alias fixprinter='sudo systemctl restart cups && lpstat -p -d'
"""

PROFILE = """# ~/.profile: executed by the command interpreter for login shells.
# This file is not read by bash(1), if ~/.bash_profile or ~/.bash_login
# exists.

# if running bash
if [ -n "$BASH_VERSION" ]; then
    # include .bashrc if it exists
    if [ -f "$HOME/.bashrc" ]; then
\t. "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
"""

BASH_LOGOUT = """# ~/.bash_logout: executed by bash(1) when login shell exits.

# when leaving the console clear the screen to increase privacy

if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi
"""

MOTD = """Welcome to Ubuntu 22.04.5 LTS (GNU/Linux 5.15.0-124-generic x86_64)

  Eastbank Community -- ward jump host. Authorised clinical and IT staff only.
  All activity is logged. Problems: Eastbank IT x4020 / helpdesk@eas.meridian.local
"""


# --------------------------------------------------------------------------- generated files


def bash_history(w: "ShadowWorld") -> str:
    pw = w.svc_password
    rng = entity_rng(w.key, w.seed_session, "fs/bash_history")
    pid = rng.randint(1000, 9999)
    lines = [
        "ls", "cd Documents", "ls -la", "nano handover_notes.txt", "cd", "lpstat -p -d",
        "sudo systemctl restart cups", "lpstat -p -d", "ping -c 3 print-eas3", "exit",
        "who", "df -h", "cat /etc/hosts | grep lum", "ping -c 2 lis-api.lum.meridian.local",
        "curl -s https://lis-api.lum.meridian.local/v2/health",
        "curl -sk https://lis-api.lum.meridian.local/v2/health", "cat /opt/lis/config.yaml",
        "systemctl status lis-sync", "sudo journalctl -u lis-sync --since \"1 hour ago\" | tail -40",
        "sudo systemctl restart lis-sync", "systemctl status lis-sync", "exit",
        "ls /mnt/backups", "sudo mkdir -p /mnt/backups",
        f"sudo mount -t cifs //lum-backup1/nightly /mnt/backups -o user=svc_lisbackup,pass={pw}",
        f"sudo mount -t cifs //lum-backup01/nightly /mnt/backups -o user=svc_lisbackup,pass={pw}",
        "ls -la /mnt/backups", "du -sh /mnt/backups/*", "ls -la /mnt/backups/research_cohort_q4",
        "head -5 /mnt/backups/lis_results_export.csv", "exit",
        "nano ~/.bashrc", "source ~/.bashrc", "lisget/health", "lisget /health", "pq",
        "fixprinter", "top", "free -m", f"kill {pid}", "clear", "exit",
        "cd Documents", "nano handover_notes.txt", "ls", "cd ..", "history | grep mount",
        "mount | grep cifs", "ls -lah /mnt/backups", "exit",
        "fixprinter", "lpstat -o", "cancel -a print-eas3", "fixprinter", "exit",
        "last -n 10", "uptime", "ls -lah /mnt/backups", "sha256sum -c /mnt/backups/SHA256SUMS 2>/dev/null | tail -3",
        "nano Documents/handover_notes.txt", "exit",
    ]
    return "\n".join(lines) + "\n"


def handover_notes(w: "ShadowWorld") -> str:
    pts = w.eas_inpatients(6)
    rng = entity_rng(w.key, w.seed_session, "fs/handover")
    out = [
        "NIGHT HANDOVER - 3 East Med/Surg + overflow - Eastbank Community",
        f"Updated 13 Nov 2026 19:{rng.randint(10, 55)} by N. Okafor RN (nights x3 this week)",
        "",
        "PATIENTS",
        "--------",
    ]
    for c in pts:
        meds = ", ".join(m.split(" PO")[0].split(" IV")[0].split(" SC")[0] for m in c.medications[:3]) or "no regular meds"
        allergy = "NKDA" if c.allergies == ["NKDA"] else "ALLERGY: " + "; ".join(c.allergies)
        line1 = f"{c.bed:<9}{c.family.upper()}, {c.given}  {c.mrn}  {c.age}{c.sex}  Dr. {c.attending.family}"
        dx = ", ".join(x.short for x in c.conditions[:3]) or "obs"
        codes = {x.code for x in c.conditions}
        todos = ["AM labs ordered", "fall risk, bed alarm on", "family to call after 0800", "PT/OT eval today",
                 "pain controlled on PRNs", "IV access L forearm, flushes OK"]
        if codes & {"E11.9", "E11.22", "E10.9"}:
            todos = ["watch BG overnight, sliding scale", "BG 0200 and 0600"]
        elif codes & {"N18.30", "N18.4", "E11.22"}:
            todos = ["needs repeat K+ at 0600", "renal diet, strict I/O"]
        elif codes & {"A41.9", "J18.9"}:
            todos = ["repeat lactate/cultures pending, obs q2h", "O2 2L NC, wean as tolerated"]
        elif codes & {"K35.80"}:
            todos = ["NPO after midnight for OR", "surgical team to review AM"]
        elif codes & {"I50.22", "I21.4"}:
            todos = ["daily weight 0600, strict I/O", "tele on, call if HR >120"]
        todo = rng.choice(todos)
        out += [line1, f"         {dx}. {meds}. {allergy}. {todo}.", ""]
    out += [
        "IT / MISC (because apparently I'm the night IT person now)",
        "-----------------------------------------------------------",
        "- 3E printer (print-eas3) drops off every few hours. On the jump box: `fixprinter` (alias in my .bashrc).",
        "- Lumen results slow overnight. If a STAT trop isn't back in 45 min call Lumen lab x7710, don't re-order.",
        "- Backup share (\\\\lum-backup01\\nightly) disconnects after Lumen's Tuesday patching. Daniel (IT, x4020)",
        "  said just remount it with the svc_lisbackup account, the command is in my shell history. Don't give the",
        "  password out over the phone, Lumen IT will never ask for it.",
        "- Research team (Dr. Halvorsen's Q4 cohort) asked us NOT to delete anything under research_cohort_q4.",
        "- LIS API key lives in /opt/lis/config.yaml. Do NOT paste it into Teams again (sorry Daniel).",
        "",
        "Bed board / staffing: 2 RNs + 1 HCA on 3E tonight, float from 2E after 0200.",
    ]
    return "\n".join(out) + "\n"


def auth_log(w: "ShadowWorld") -> str:
    rng = entity_rng(w.key, w.seed_session, "fs/auth_log")
    ev: list[tuple[datetime, str]] = []
    host = "jump-eas"

    def sshd(t, user, ip, method="password"):
        pid = rng.randint(1200, 98000)
        port = rng.randint(40000, 65000)
        ev.append((t, f"sshd[{pid}]: Accepted {method} for {user} from {ip} port {port} ssh2"))
        ev.append((t, f"sshd[{pid}]: pam_unix(sshd:session): session opened for user {user}(uid="
                      f"{ {'n.okafor': 1001, 'd.mensah': 1002, 'eastadmin': 1000}[user] }) by (uid=0)"))
        ev.append((t, f"systemd-logind[812]: New session {rng.randint(300, 999)} of user {user}."))
        end = t + timedelta(minutes=rng.randint(3, 40), seconds=rng.randint(0, 59))
        ev.append((end, f"sshd[{pid}]: pam_unix(sshd:session): session closed for user {user}"))

    def sudo(t, user, cmd, cwd="/home/n.okafor"):
        ev.append((t, f"sudo: {user} : TTY=pts/{rng.randint(0, 3)} ; PWD={cwd} ; USER=root ; COMMAND={cmd}"))
        ev.append((t, f"sudo: pam_unix(sudo:session): session opened for user root(uid=0) by {user}(uid="
                      f"{ {'n.okafor': 1001, 'd.mensah': 1002, 'eastadmin': 1000}[user] })"))
        ev.append((t + timedelta(seconds=rng.randint(1, 4)), "sudo: pam_unix(sudo:session): session closed for user root"))

    for day in range(9, 14):
        night = datetime(2026, 11, day, 22, rng.randint(0, 59), rng.randint(0, 59))
        sshd(night, "n.okafor", f"10.40.12.{rng.choice([31, 31, 33, 47])}")
        sudo(night + timedelta(minutes=2, seconds=rng.randint(0, 59)), "n.okafor", "/usr/bin/systemctl restart cups")
        if rng.random() < 0.6:
            t = datetime(2026, 11, day + 1, rng.randint(1, 5), rng.randint(0, 59), rng.randint(0, 59))
            sshd(t, "n.okafor", "10.40.12.31")
        day_t = datetime(2026, 11, day, rng.randint(9, 16), rng.randint(0, 59), rng.randint(0, 59))
        sshd(day_t, "d.mensah", "10.40.8.15", "publickey")
        if rng.random() < 0.5:
            sudo(day_t + timedelta(minutes=4, seconds=rng.randint(0, 59)), "d.mensah", "/usr/bin/apt-get upgrade -y", "/home/d.mensah")
        for _ in range(rng.randint(0, 2)):
            t = datetime(2026, 11, day, rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59))
            ev.append((t, f"sshd[{rng.randint(1200, 98000)}]: Failed password for invalid user admin from "
                          f"10.40.12.{rng.randint(20, 90)} port {rng.randint(40000, 65000)} ssh2"))
        ev.append((datetime(2026, 11, day, rng.randint(0, 23), 17, 1),
                   "CRON[{}]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)".format(
                       rng.randint(1200, 98000))))
    sudo(datetime(2026, 11, 11, 23, 14), "n.okafor", "/usr/bin/systemctl restart lis-sync")
    # the current session (the phished login, from the VPN pool)
    ev.append((NOW - timedelta(minutes=9), f"sshd[{rng.randint(1200, 98000)}]: Accepted password for n.okafor from "
                                            f"10.99.14.{rng.randint(20, 220)} port {rng.randint(40000, 65000)} ssh2"))
    ev.sort(key=lambda e: e[0])
    return "".join(f"{t:%b} {t.day:>2} {t:%H:%M:%S} {host} {msg}\n" for t, msg in ev if t <= NOW)


def lis_config(w: "ShadowWorld") -> str:
    return f"""# Lumen LIS client -- Eastbank ward terminals
# Managed by Lumen IT (lis-sync). Local edits are overwritten on the next sync.
lis:
  endpoint: https://lis-api.lum.meridian.local/v2
  facility_id: eas
  client_id: eas-ward-terminals
  api_key: {w.api_key}
  scopes: [results.read, orders.read, orders.write]
  timeout_s: 20
  verify_tls: true
  ca_bundle: /etc/ssl/certs/meridian-internal-ca.pem

results:
  poll_interval_s: 60
  stat_alert_minutes: 45
  printers: [print-eas3, print-eas-ed]

hl7:
  host: lis-hl7.lum.meridian.local
  port: 2575
  sending_facility: EAS
  receiving_facility: LUMEN

logging:
  level: info
  file: /var/log/lis-sync/lis-sync.log
"""


def results_export(w: "ShadowWorld") -> str:
    rows = ["accession,mrn,patient_name,dob,loinc,test,value,unit,ref_range,flag,resulted,performing_lab,"
            "ordering_facility"]
    for idx in w.export_rows():
        c = w.core(idx)
        for o in w.obs_internal(c.mrn):
            if o.issued < "2026-11-06":
                continue
            acc = o.obs_id.rsplit(".", 1)[0]
            rows.append(f"{acc},{c.mrn},\"{c.family}, {c.given}\",{c.dob.isoformat()},{o.code},\"{o.display}\","
                        f"{fmt_value(o)},{o.unit},{o.ref_range},{flag(o)},{o.issued.replace('T', ' ')},"
                        f"{o.performer_hospital.upper()},{c.hospital_id.upper()}")
    return "\n".join(rows) + "\n"


def cohort_csv(w: "ShadowWorld") -> str:
    rows = ["study_id,age_band,sex,site,dx_codes,hba1c_pct,egfr_latest,ldl_mgdl,n_results_90d"]
    for i, idx in enumerate(w.cohort_rows()):
        c = w.core(idx)
        obs = w.obs_internal(c.mrn)
        latest = {}
        for o in obs:
            latest[o.code] = fmt_value(o)
        band = f"{(c.age // 10) * 10}-{(c.age // 10) * 10 + 9}"
        dx = " ".join(x.code for x in c.conditions)
        rows.append(f"RC4-{i + 1:04d},{band},{c.sex},{c.hospital_id.upper()},{dx},{latest.get('4548-4', '')},"
                    f"{latest.get('62238-1', '')},{latest.get('13457-7', '')},{len(obs)}")
    return "\n".join(rows) + "\n"


def cohort_readme(w: "ShadowWorld") -> str:
    n = len(w.cohort_rows())
    return f"""# Q4 Metabolic & Renal Outcomes Cohort (de-identified extract)

Prepared by Lumen Research Informatics for IRB protocol MHN-2026-0417
(PI: Dr. E. Halvorsen, St. Aurelia General / Nephrology).

## Contents
- `cohort.csv` -- {n} participants with type 2 diabetes and/or CKD stage 3-4, seen at AUR, NOR or EAS
  between 2026-08-16 and 2026-11-13. Ages are banded; dates and identifiers removed (Safe Harbor).

| column | meaning |
|---|---|
| study_id | stable pseudonymous id (RC4-nnnn) |
| age_band | 10-year band |
| site | treating facility code |
| dx_codes | ICD-10-CM problem list codes |
| hba1c_pct / egfr_latest / ldl_mgdl | most recent result in window (Lumen LIS) |
| n_results_90d | number of resulted lab tests in window |

## Re-identification / linkage
The linkage key (study_id -> MRN) is NOT stored on this share. Approved investigators can pull it,
together with the identified results extract, from the Research Data Portal:

    {w.research_url}

Access is logged. Links expire at the end of the quarter. Questions: research-informatics@lum.meridian.local
"""


def sha256sums(w: "ShadowWorld") -> str:
    rng = entity_rng(w.key, w.seed_session, "fs/sha256")
    return "".join(f"{hexs(rng, 64)}  {spec.path.rsplit('/', 1)[1]}\n" for spec in w.dumps())


# --------------------------------------------------------------------------- tree


def build_tree(w: "ShadowWorld") -> dict[str, Node]:
    t: dict[str, Node] = {}
    old = NOW - timedelta(days=203, hours=5)
    for p in ["/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/media", "/mnt", "/opt", "/proc", "/run",
              "/sbin", "/snap", "/srv", "/sys", "/tmp", "/usr", "/var", "/var/log", "/var/tmp", "/var/backups",
              "/usr/bin", "/usr/lib", "/usr/local", "/usr/share", "/etc/ssh", "/etc/ssl", "/etc/ssl/certs",
              "/etc/cron.d", "/dev/shm"]:
        t[p] = d(mtime=old)
    t["/tmp"] = d("drwxrwxrwt", mtime=NOW - timedelta(minutes=11))
    t["/var/tmp"] = d("drwxrwxrwt", mtime=NOW - timedelta(hours=7))
    t["/dev/shm"] = d("drwxrwxrwt", mtime=NOW - timedelta(days=3))
    t["/root"] = d("drwx------", readable=False, mtime=NOW - timedelta(days=12))
    t["/home/eastadmin"] = d("drwxr-x---", "eastadmin", "eastadmin", readable=False)
    t["/home/d.mensah"] = d("drwxr-x---", "d.mensah", "d.mensah", readable=False, mtime=NOW - timedelta(days=2))
    t["/var/log/lis-sync"] = d("drwxr-x---", "lissync", "lissync", readable=False, mtime=NOW - timedelta(minutes=2))

    # /etc
    t["/etc/os-release"] = f(OS_RELEASE, mtime=datetime(2024, 9, 11, 14, 22))
    t["/etc/lsb-release"] = f('DISTRIB_ID=Ubuntu\nDISTRIB_RELEASE=22.04\nDISTRIB_CODENAME=jammy\n'
                              'DISTRIB_DESCRIPTION="Ubuntu 22.04.5 LTS"\n', mtime=datetime(2024, 9, 11, 14, 22))
    t["/etc/hostname"] = f("jump-eas\n", mtime=old)
    t["/etc/hosts"] = f(HOSTS, mtime=datetime(2026, 10, 3, 9, 12))
    t["/etc/passwd"] = f(PASSWD, mtime=datetime(2026, 10, 6, 15, 40))
    t["/etc/group"] = f(GROUP, mtime=datetime(2026, 10, 6, 15, 40))
    t["/etc/shadow"] = f("", "-rw-r-----", "root", "shadow", datetime(2026, 10, 6, 15, 40), readable=False, size=1689)
    t["/etc/sudoers"] = f("", "-r--r-----", mtime=old, readable=False, size=1800)
    t["/etc/resolv.conf"] = f(RESOLV, mtime=NOW - timedelta(days=6))
    t["/etc/fstab"] = f(FSTAB, mtime=datetime(2026, 10, 6, 16, 2))
    t["/etc/motd"] = f(MOTD, mtime=old)
    t["/etc/ssh/sshd_config"] = f("Include /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication yes\n"
                                  "KbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\n"
                                  "PrintMotd no\nAcceptEnv LANG LC_*\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n",
                                  mtime=old)
    t["/etc/ssl/certs/meridian-internal-ca.pem"] = f(
        "-----BEGIN CERTIFICATE-----\n" + "\n".join(
            hexs(entity_rng(w.key, "infra", f"ca/{i}"), 64) for i in range(18)) + "\n-----END CERTIFICATE-----\n",
        mtime=datetime(2025, 3, 2, 11, 0))
    t["/etc/cron.d/lis-sync"] = f("# Lumen LIS client sync\n*/5 * * * * lissync /opt/lis/bin/lis-sync --quiet\n",
                                  mtime=datetime(2026, 6, 18, 10, 5))

    # /var/log
    t["/var/log/auth.log"] = f(lambda: auth_log(w), "-rw-r-----", "syslog", "adm", NOW - timedelta(minutes=9))
    t["/var/log/syslog"] = f("", "-rw-r-----", "syslog", "adm", NOW - timedelta(seconds=40), readable=False,
                             size=2_418_337)

    # /opt/lis
    t["/opt/lis"] = d(mtime=datetime(2026, 6, 18, 10, 5))
    t["/opt/lis/bin"] = d(mtime=datetime(2026, 6, 18, 10, 5))
    t["/opt/lis/bin/lis-sync"] = f("", "-rwxr-xr-x", mtime=datetime(2026, 6, 18, 10, 5), readable=False,
                                   size=8_904_112)
    t["/opt/lis/config.yaml"] = f(lambda: lis_config(w), "-rw-r--r--", "lissync", "lissync",
                                  datetime(2026, 11, 2, 4, 15), tokens=[w.tok_api_key])

    # home
    hm = NOW - timedelta(days=1, hours=6)
    t[HOME] = d("drwxr-x---", USER, USER, mtime=hm)
    t[f"{HOME}/.bash_history"] = f(lambda: bash_history(w), "-rw-------", USER, USER,
                                   datetime(2026, 11, 13, 7, 2), tokens=[w.tok_credential])
    t[f"{HOME}/.bashrc"] = f(BASHRC, "-rw-r--r--", USER, USER, datetime(2026, 10, 21, 2, 41))
    t[f"{HOME}/.profile"] = f(PROFILE, "-rw-r--r--", USER, USER, datetime(2026, 4, 2, 11, 7))
    t[f"{HOME}/.bash_logout"] = f(BASH_LOGOUT, "-rw-r--r--", USER, USER, datetime(2026, 4, 2, 11, 7))
    t[f"{HOME}/.cache"] = d("drwx------", USER, USER, mtime=datetime(2026, 4, 2, 11, 9))
    t[f"{HOME}/.ssh"] = d("drwx------", USER, USER, mtime=datetime(2026, 9, 1, 3, 30))
    t[f"{HOME}/.ssh/known_hosts"] = f(
        "".join(f"|1|{hexs(entity_rng(w.key, w.seed_session, f'kh/{i}'), 28)}= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI"
                f"{hexs(entity_rng(w.key, w.seed_session, f'khk/{i}'), 43)}\n" for i in range(4)),
        "-rw-r--r--", USER, USER, datetime(2026, 9, 1, 3, 31))
    t[f"{HOME}/Documents"] = d("drwxr-xr-x", USER, USER, mtime=datetime(2026, 11, 13, 19, 31))
    t[f"{HOME}/Documents/handover_notes.txt"] = f(lambda: handover_notes(w), "-rw-rw-r--", USER, USER,
                                                  datetime(2026, 11, 13, 19, 31))
    t[f"{HOME}/Downloads"] = d("drwxr-xr-x", USER, USER, mtime=datetime(2026, 10, 21, 2, 39))

    # backups share (CIFS mount: everything shows as root, 0755)
    t["/mnt/backups"] = d(mtime=datetime(2026, 11, 14, 2, 31))
    for spec in w.dumps():
        t[spec.path] = Node("file", "-rwxr-xr-x", "root", "root",
                            spec.started + timedelta(minutes=19, seconds=spec.size % 50), size=spec.size, dump=spec,
                            tokens=w.dump_tokens(spec.path))
    t[f"{BACKUPS}/SHA256SUMS"] = f(lambda: sha256sums(w), "-rwxr-xr-x", mtime=datetime(2026, 11, 14, 2, 31))
    t[f"{BACKUPS}/lis_results_export.csv"] = f(lambda: results_export(w), "-rwxr-xr-x",
                                               mtime=datetime(2026, 11, 13, 23, 30),
                                               patient_rows=w.export_rows)
    t[f"{BACKUPS}/research_cohort_q4"] = d(mtime=datetime(2026, 11, 13, 17, 2))
    t[f"{BACKUPS}/research_cohort_q4/cohort.csv"] = f(lambda: cohort_csv(w), "-rwxr-xr-x",
                                                      mtime=datetime(2026, 11, 13, 17, 2))
    t[f"{BACKUPS}/research_cohort_q4/README.md"] = f(lambda: cohort_readme(w), "-rwxr-xr-x",
                                                     mtime=datetime(2026, 11, 13, 17, 1), tokens=[w.tok_url])
    return t

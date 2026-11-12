#!/usr/bin/env python3
"""Bar screen dashboard: now playing + Milkdrop visualizer for a small wide secondary screen.

- Reads the active media player over MPRIS (D-Bus) and serves it as JSON.
- Serves the dashboard page (web/) on 127.0.0.1 only.
- Watches for the bar screen (any very wide output, or one picked by name) and opens a
  dedicated kiosk browser window on it, closing it when the screen goes away.
- Pauses the page while the session is locked or the monitors are asleep, and hands
  the outside temperature to the optional lock screen clock.

The browser's default audio input is pointed at the monitor of the current default
output (PULSE_SOURCE=@DEFAULT_MONITOR@), so the visualizer gets a digital copy of
what is playing, never the microphone.

Settings come from environment variables (see config.env.example), which the systemd
unit loads from ~/.config/bar-screen-dashboard/config.env.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen

import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

NAME = "bar-screen-dashboard"


def env(key, default=""):
    return os.environ.get("BAR_" + key, default).strip()


HOME = os.path.expanduser("~")
BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
PORT = int(env("PORT", "8765"))
SCREEN = env("SCREEN", "auto")             # auto | monitor name from EDID | output name (HDMI-1)
MIN_RATIO = float(env("MIN_RATIO", "3"))   # "auto" picks the first output at least this wide
BROWSER = env("BROWSER") or next((b for b in (shutil.which(n) for n in (
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser")) if b), "")
QUERY = env("QUERY")                       # extra page options, e.g. "bars=0" or "debug"
STATE_DIR = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local/state"), NAME)
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(HOME, ".cache"), NAME)
PROFILE = os.path.join(STATE_DIR, "browser-profile")
WM_CLASS = NAME
ART_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
APPLETSRC = os.path.join(HOME, ".config/plasma-org.kde.plasma.desktop-appletsrc")
WEATHER_EVERY = 15 * 60      # seconds between Open-Meteo reads
WEATHER_STALE = 90 * 60      # hide the temperature if the last good read is older than this
# The lock screen can't make network requests, so the temperature is handed to it as a
# file name in this folder ("temp_16"); its wallpaper plugin watches the folder.
LOCKINFO = os.path.join(CACHE_DIR, "lockinfo")

state_lock = threading.Lock()
state = {"status": "Stopped"}
art_path = None          # local file currently allowed to be served as /art


def log(*a):
    print("[bar-screen]", *a, flush=True)


# ---------------------------------------------------------------- MPRIS -----
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def dbus_call(name, path, iface, method, args=None, sig=None, timeout=800):
    return bus.call_sync(name, path, iface, method, args, sig and GLib.VariantType(sig),
                         Gio.DBusCallFlags.NONE, timeout, None).unpack()


def player_props(name):
    try:
        (props,) = dbus_call(name, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties",
                             "GetAll", GLib.Variant("(s)", ("org.mpris.MediaPlayer2.Player",)), "(a{sv})")
        return props
    except GLib.Error:
        return None


def pick_player():
    (names,) = dbus_call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                         "ListNames", None, "(as)")
    cands = []
    for n in names:
        if not n.startswith("org.mpris.MediaPlayer2."):
            continue
        p = player_props(n)
        if not p:
            continue
        md = p.get("Metadata") or {}
        title = md.get("xesam:title") or ""
        if not title:
            continue                       # e.g. a Bluetooth headset with nothing to report
        status = p.get("PlaybackStatus", "Stopped")
        short = n.split(".", 3)[-1]
        score = {"Playing": 300, "Paused": 200}.get(status, 100)
        # Browsers show up twice: Plasma's integration has the cover art, prefer it.
        if short.startswith("plasma-browser-integration"):
            score += 20
        if md.get("mpris:artUrl"):
            score += 10
        cands.append((score, n, short, p, md))
    if not cands:
        return None
    cands.sort(key=lambda c: -c[0])
    return cands[0]


def artists(md):
    a = md.get("xesam:artist") or []
    if isinstance(a, str):
        a = [a]
    return ", ".join(x for x in a if x)


def default_sink_is_bluetooth():
    try:
        out = subprocess.run(["pactl", "get-default-sink"], capture_output=True, text=True, timeout=2).stdout
        return out.strip().startswith("bluez_output")
    except Exception:
        return False


def poll_mpris():
    global art_path
    bt_checked = 0
    bt = False
    while True:
        try:
            now = time.time()
            if now - bt_checked > 5:
                bt, bt_checked = default_sink_is_bluetooth(), now
            c = pick_player()
            if c is None:
                new = {"status": "Stopped", "bluetooth": bt}
                ap = None
            else:
                _, name, short, p, md = c
                pos = None
                try:
                    (v,) = dbus_call(name, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties", "Get",
                                     GLib.Variant("(ss)", ("org.mpris.MediaPlayer2.Player", "Position")), "(v)")
                    pos = int(v)
                except GLib.Error:
                    pass
                art = md.get("mpris:artUrl") or ""
                ap = None
                if art.startswith("file://"):
                    path = unquote(urlparse(art).path)
                    if path.lower().endswith(ART_EXT) and os.path.isfile(path):
                        ap = path
                        art = "/art?v=%d" % (hash((path, os.path.getmtime(path))) & 0xFFFFFFF)
                    else:
                        art = ""
                elif not art.startswith("https://"):
                    art = ""
                new = {
                    "status": p.get("PlaybackStatus", "Stopped"),
                    "player": short,
                    "title": md.get("xesam:title") or "",
                    "artist": artists(md),
                    "album": md.get("xesam:album") or "",
                    "art": art,
                    "lengthUs": int(md.get("mpris:length") or 0),
                    "positionUs": pos,
                    "rate": float(p.get("Rate") or 1.0),
                    "sampledAt": int(now * 1000),
                    "bluetooth": bt,
                }
            with state_lock:
                state.clear()
                state.update(new)
                art_path = ap
        except Exception as e:  # keep serving even if D-Bus hiccups
            log("mpris poll error:", e)
        time.sleep(1)


# -------------------------------------------------------------- weather -----
# Location: BAR_LAT/BAR_LON if set, otherwise the location saved by the Weather Glance
# panel widget (plasma-weather-glance), so both show the same number. No location = no
# temperature. Units: BAR_UNITS, else the widget's setting, else the locale.
weather = {"temp": None, "at": 0}


def weather_glance_config():
    """Settings of the (non-ghost) Weather Glance applet, if one is on a panel."""
    try:
        lines = open(APPLETSRC, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return {}
    ids, conf, sect = set(), {}, ""
    for ln in lines:
        if ln.startswith("["):
            sect = ln
            continue
        k, _, v = ln.partition("=")
        m = re.fullmatch(r"\[Containments\]\[\d+\]\[Applets\]\[(\d+)\]", sect)
        if m and k == "plugin" and v == "org.kde.plasma.weatherglance":
            ids.add(m.group(1))
        m = re.fullmatch(r"\[Containments\]\[\d+\]\[Applets\]\[(\d+)\]\[Configuration\]\[General\]", sect)
        if m:
            conf.setdefault(m.group(1), {})[k] = v
    for i in sorted(ids):
        c = conf.get(i, {})
        if c.get("ghost") != "true" and "lat" in c and "lon" in c:
            return c
    return {}


def locale_uses_fahrenheit():
    loc = os.environ.get("LC_ALL") or os.environ.get("LC_MEASUREMENT") or os.environ.get("LANG") or ""
    return re.search(r"_(US|LR|MM)\b", loc) is not None


def weather_settings():
    """(lat, lon, fahrenheit) or None when no location is known."""
    wg = weather_glance_config()
    lat, lon = env("LAT"), env("LON")
    try:
        loc = (float(lat), float(lon)) if lat and lon else (float(wg["lat"]), float(wg["lon"]))
    except (KeyError, ValueError):
        return None
    if loc == (0.0, 0.0):
        return None
    units = env("UNITS", "auto")
    if units == "auto":
        units = wg.get("tempUnit", "auto")
    f = units == "fahrenheit" or (units not in ("celsius", "fahrenheit") and locale_uses_fahrenheit())
    return loc[0], loc[1], f


def poll_weather():
    while True:
        wait = WEATHER_EVERY
        ws = weather_settings()
        if ws:
            lat, lon, f = ws
            url = ("https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f"
                   "&current=temperature_2m&timezone=auto%s" % (lat, lon, "&temperature_unit=fahrenheit" if f else ""))
            try:
                with urlopen(Request(url, headers={"User-Agent": NAME}), timeout=15) as r:
                    t = json.load(r)["current"]["temperature_2m"]
                weather.update(temp=float(t), at=time.time())
            except Exception as e:
                log("weather error:", e)
                wait = 120
        else:
            weather.update(temp=None)
            wait = 120
        time.sleep(wait)


def current_temp():
    if weather["temp"] is None or time.time() - weather["at"] > WEATHER_STALE:
        return None
    return round(weather["temp"])


# -------------------------------------------------------- visibility -----
# Nothing to draw while the session is locked or the monitors are asleep: the page pauses.
view = {"hidden": False}


def session_locked():
    try:
        (v,) = dbus_call("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver",
                         "org.freedesktop.ScreenSaver", "GetActive", None, "(b)")
        return bool(v)
    except GLib.Error:
        return False


def monitors_asleep():
    try:
        out = subprocess.run(["xset", "q"], capture_output=True, text=True, timeout=2).stdout
        return "Monitor is Off" in out
    except Exception:
        return False


def write_lockinfo():
    t = current_temp()
    want = {"temp_%d" % t} if t is not None else set()
    try:
        os.makedirs(LOCKINFO, exist_ok=True)
        have = set(os.listdir(LOCKINFO))
        for f in have - want:
            os.remove(os.path.join(LOCKINFO, f))
        for f in want - have:
            open(os.path.join(LOCKINFO, f), "w").close()
    except OSError as e:
        log("lockinfo error:", e)


def watch_visibility():
    while True:
        hidden = session_locked() or monitors_asleep()
        if hidden != view["hidden"]:
            log("display hidden" if hidden else "display visible")
        view["hidden"] = hidden
        write_lockinfo()
        time.sleep(2)


# --------------------------------------------------------------- screen -----
def find_screen():
    """Return (output, x, y, w, h) of the bar screen, or None.

    BAR_SCREEN=auto picks the first connected output at least BAR_MIN_RATIO times wider
    than tall; otherwise it matches an output name (HDMI-1) or the monitor's EDID name.
    """
    try:
        out = subprocess.run(["xrandr", "--current", "--props"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    want_hex = SCREEN.encode().hex().lower()
    for b in re.split(r"(?m)^(?=\S)", out):          # one block per output
        m = re.match(r"(\S+) connected (?:primary )?(\d+)x(\d+)\+(\d+)\+(\d+)", b)
        if not m:
            continue
        name, w, h, x, y = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
        if SCREEN == "auto":
            hit = h > 0 and w / h >= MIN_RATIO
        elif SCREEN == name:
            hit = True
        else:
            em = re.search(r"EDID:\s*\n((?:\s+[0-9a-fA-F]+\n)+)", b)
            hit = bool(em) and want_hex in re.sub(r"\s", "", em.group(1)).lower()
        if hit:
            return (name, x, y, w, h)
    return None


def grant_audio_permission():
    """Allow the dashboard page to capture audio, in its own Chrome profile only.

    Done through the profile's saved site permission rather than a command-line
    flag, which would show a warning bar. Chrome must not be running when this runs.
    """
    path = os.path.join(PROFILE, "Default", "Preferences")
    try:
        prefs = json.load(open(path))
    except (OSError, ValueError):
        prefs = {}
    ex = prefs.setdefault("profile", {}).setdefault("content_settings", {}).setdefault("exceptions", {})
    key = "http://127.0.0.1:%d,*" % PORT
    for kind in ("media_stream_mic",):
        ex.setdefault(kind, {})[key] = {"last_modified": "13300000000000000", "setting": 1}
    # Don't nag about restoring the last session after it was closed with the screen.
    prefs["profile"]["exit_type"] = "Normal"
    prefs["profile"]["exited_cleanly"] = True
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    json.dump(prefs, open(tmp, "w"))
    os.replace(tmp, path)


class Window:
    def __init__(self):
        self.proc = None
        self.geo = None

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self, geo):
        _, x, y, w, h = geo
        grant_audio_permission()
        env = dict(os.environ, PULSE_SOURCE="@DEFAULT_MONITOR@")
        args = [BROWSER,
                "--user-data-dir=" + PROFILE,
                "--class=" + WM_CLASS,
                # Kiosk = true fullscreen on the screen it opens on: no frame, no 1px gaps.
                "--kiosk", "http://127.0.0.1:%d/%s" % (PORT, ("?" + QUERY.lstrip("?")) if QUERY else ""),
                "--window-position=%d,%d" % (x, y),
                "--window-size=%d,%d" % (w, h),
                "--autoplay-policy=no-user-gesture-required",
                "--no-first-run", "--no-default-browser-check",
                "--password-store=basic",
                "--disable-features=Translate,MediaRouter,GlobalMediaControls,HardwareMediaKeyHandling",
                "--disable-session-crashed-bubble", "--hide-crash-restore-bubble",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows"]
        log("opening dashboard on", geo)
        self.proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     start_new_session=True)
        self.geo = geo

    def stop(self):
        if self.running():
            log("closing dashboard")
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(5)
            except Exception:
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except Exception:
                    pass
        self.proc = None
        self.geo = None


def manage_window(win):
    misses = 0
    while True:
        geo = find_screen()
        if geo:
            misses = 0
            if not win.running() or win.geo != geo:
                win.stop()
                time.sleep(1)
                win.start(geo)
        else:
            misses += 1
            if misses >= 2 and win.running():   # ignore a single flaky read
                win.stop()
        time.sleep(5)


# ----------------------------------------------------------------- http -----
page_seen = {}


def note_page(query):
    """The page reports its preset; log changes so blank spells can be traced in the journal."""
    from urllib.parse import parse_qs
    q = parse_qs(query)
    for key in ("preset", "skipped", "audio"):
        v = (q.get(key) or [""])[0]
        if v and page_seen.get(key) != v:
            page_seen[key] = v
            log("%s: %s" % ({"preset": "preset", "skipped": "skipped dark preset"}.get(key, key), v))



class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/state":
            note_page(u.query)
            with state_lock:
                body = json.dumps(dict(state, temp=current_temp(), hidden=view["hidden"])).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/art":
            with state_lock:
                p = art_path
            if not p:
                self.send_error(404)
                return
            try:
                data = open(p, "rb").read()
            except OSError:
                self.send_error(404)
                return
            ext = os.path.splitext(p)[1].lower().lstrip(".")
            self.send_response(200)
            self.send_header("Content-Type", "image/" + ("jpeg" if ext in ("jpg", "jpeg") else ext))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()


def main():
    if not BROWSER:
        log("no Chrome/Chromium found; set BAR_BROWSER in ~/.config/%s/config.env" % NAME)
    threading.Thread(target=poll_mpris, daemon=True).start()
    threading.Thread(target=poll_weather, daemon=True).start()
    threading.Thread(target=watch_visibility, daemon=True).start()
    win = Window()
    if env("NO_WINDOW") != "1" and BROWSER:
        threading.Thread(target=manage_window, args=(win,), daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)

    def bye(*_):
        win.stop()
        os._exit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    log("serving on http://127.0.0.1:%d/" % PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()

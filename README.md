# Bar Screen Dashboard

Turn a small, wide secondary screen (those 1920×480 "bar" displays, or any panel
at least 3:1) into a music dashboard: what's playing, with cover art and progress,
over a calm [Milkdrop](https://en.wikipedia.org/wiki/MilkDrop)-style visualizer that
moves to whatever your computer is playing. When nothing is playing it shows a quiet
clock with the date and outside temperature.

## What it does

- **Now playing** from any app that reports to the desktop (MPRIS): Spotify, browsers
  (YouTube, etc.), most music players. Cover art, title, artist, progress.
- **Visualizer**: [Butterchurn](https://github.com/jberg/butterchurn) (a WebGL
  port of Milkdrop) with a hand-picked list of calm, flowing presets, changing every
  couple of minutes with a slow crossfade. An automatic dimmer keeps bright presets
  from glaring in a dark room, and a preset that goes black is skipped.
- **Spectrum bars** over the visualizer (can be turned off), never taller than half
  the screen.
- **Hears the output, not the microphone**: it listens to a digital copy of what your
  speakers/headphones play. With Bluetooth headphones it delays the visuals to match
  their lag.
- **Small clock and outside temperature** in the corner.
- **Hands-off**: starts with your session, appears when the screen is connected and
  disappears when it's unplugged; stays put when you switch virtual desktops; never
  steals keyboard focus; pauses while the session is locked or the monitors are asleep.
- **Lock screen clock** (optional, KDE Plasma): while locked, the bar screen shows the
  same clock, date and temperature instead of a squeezed lock screen.

## Requirements

- Linux with an **X11** session (screen detection uses `xrandr`; Wayland isn't supported yet)
- PipeWire or PulseAudio (`pactl`), Python 3 with PyGObject (`python3-gi`)
- Google Chrome or Chromium (or another Chromium-based browser)
- The window rule and the lock screen clock are for **KDE Plasma 6**; on other desktops
  the dashboard works, but you may have to tell your window manager to keep the window
  borderless and on all workspaces.

## Install

```sh
git clone https://github.com/amalakhovsky/bar-screen-dashboard
cd bar-screen-dashboard
./install.sh               # dashboard only
./install.sh --lock-clock  # plus the lock screen clock (KDE Plasma), then log out and in
```

It installs to `~/.local/share/bar-screen-dashboard`, runs as the systemd user service
`bar-screen-dashboard`, and keeps its own browser profile in
`~/.local/state/bar-screen-dashboard`, separate from your normal browser.

To update, `git pull` and run `./install.sh` again. To remove, `./uninstall.sh`
(`--purge` also deletes settings and the browser profile).

## Settings

`~/.config/bar-screen-dashboard/config.env`, then
`systemctl --user restart bar-screen-dashboard`:

| Setting | Default | Meaning |
|---|---|---|
| `BAR_SCREEN` | `auto` | `auto` = first screen at least `BAR_MIN_RATIO` times wider than tall; or an output name (`HDMI-1`); or the monitor's own name |
| `BAR_MIN_RATIO` | `3` | How wide counts as a bar screen |
| `BAR_BROWSER` | first found | Path to Chrome/Chromium |
| `BAR_LAT`, `BAR_LON` | empty | Location for the temperature; empty = reuse the [Weather Glance](https://github.com/amalakhovsky/plasma-weather-glance) widget's location, if present |
| `BAR_UNITS` | `auto` | `celsius`, `fahrenheit`, or `auto` (Weather Glance's setting, else your locale) |
| `BAR_PORT` | `8765` | Local port (listens on 127.0.0.1 only) |
| `BAR_QUERY` | empty | Page options: `bars=0` (no bars), `debug`, `force=playing`, `cycle=12` (preview presets quickly) |

The look (preset list, timing, brightness target, bar count) is in the `CFG` block at
the top of `app/web/app.js`.

## How it works

`server.py` (Python standard library + GLib) reads the active player over D-Bus,
serves a small web page on localhost, watches `xrandr` for the bar screen and opens a
kiosk browser window on it. The browser's default audio input is set to the *monitor*
of your current output (`PULSE_SOURCE=@DEFAULT_MONITOR@`), which the page feeds to
Butterchurn through Web Audio.

The lock screen can't run a browser, so `--lock-clock` installs a lock screen
wallpaper plugin that draws the clock on wide screens (and your usual image on the
others), and a copy of Plasma's lock screen code that hides Plasma's own clock on wide
screens only. That copy is rebuilt from your installed Plasma at every login; if a
Plasma update changes the code too much, it falls back to Plasma's original.

## Privacy

Everything stays on your machine. The page only listens on 127.0.0.1. The only
outside request is the temperature (every 15 minutes) from [Open-Meteo](https://open-meteo.com)
for the configured location.

## Credits and license

Butterchurn and butterchurn-presets by Jordan Berg, MIT license, bundled in
`app/web/vendor/` with their license files. Everything else: GPL-3.0-or-later.

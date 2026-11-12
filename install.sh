#!/usr/bin/env bash
# Install or upgrade the bar screen dashboard for the current user.
#   ./install.sh               dashboard only
#   ./install.sh --lock-clock  also the clock + temperature on the bar screen while locked (KDE Plasma)
set -euo pipefail
cd "$(dirname "$0")"

NAME=bar-screen-dashboard
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/$NAME"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/$NAME"
UNITDIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DROPIN="$UNITDIR/plasma-ksmserver.service.d/bar-screen-lock.conf"
LOCK=0
for a in "$@"; do
    case "$a" in
        --lock-clock) LOCK=1 ;;
        *) echo "unknown option: $a" >&2; exit 2 ;;
    esac
done

# ---- checks
missing=()
for c in python3 xrandr xset pactl systemctl; do command -v "$c" >/dev/null || missing+=("$c"); done
python3 -c 'import gi; gi.require_version("Gio", "2.0")' 2>/dev/null || missing+=("python3-gi (PyGObject)")
if ((${#missing[@]})); then echo "Missing: ${missing[*]}" >&2; exit 1; fi
[ "${XDG_SESSION_TYPE:-x11}" = "x11" ] || echo "Note: this needs an X11 session (it uses xrandr); ${XDG_SESSION_TYPE} is not supported yet."
command -v google-chrome >/dev/null || command -v google-chrome-stable >/dev/null || command -v chromium >/dev/null \
    || command -v chromium-browser >/dev/null || command -v brave-browser >/dev/null \
    || echo "Note: no Chrome/Chromium found; install one or set BAR_BROWSER in $CONF/config.env."

# ---- app files
mkdir -p "$DEST"
rm -rf "${DEST:?}/web"
cp -r app/. "$DEST/"
mkdir -p "$CONF"
[ -f "$CONF/config.env" ] || cp config.env.example "$CONF/config.env"

# ---- window rule (KDE): no border, off the taskbar/switcher, on all desktops, never takes focus
if command -v kwriteconfig6 >/dev/null; then
    rules=$(kreadconfig6 --file kwinrulesrc --group General --key rules)
    case ",$rules," in
        *",$NAME,"*) ;;
        *) rules="${rules:+$rules,}$NAME" ;;
    esac
    kwriteconfig6 --file kwinrulesrc --group General --key rules "$rules"
    kwriteconfig6 --file kwinrulesrc --group General --key count "$(tr ',' '\n' <<<"$rules" | grep -c .)"
    w() { kwriteconfig6 --file kwinrulesrc --group "$NAME" --key "$1" "$2"; }
    w Description "Bar screen dashboard"
    w wmclass "$NAME"; w wmclasscomplete false; w wmclassmatch 1
    w noborder true; w noborderrule 2
    w skiptaskbar true; w skiptaskbarrule 2
    w skippager true; w skippagerrule 2
    w skipswitcher true; w skipswitcherrule 2
    w desktops ""; w desktopsrule 2
    w acceptfocus false; w acceptfocusrule 2
    (qdbus6 org.kde.KWin /KWin reconfigure || qdbus org.kde.KWin /KWin reconfigure) >/dev/null 2>&1 || true
fi

# ---- lock screen clock (KDE Plasma)
if ((LOCK)); then
    command -v kpackagetool6 >/dev/null || { echo "--lock-clock needs KDE Plasma 6 (kpackagetool6)" >&2; exit 1; }
    if kpackagetool6 -t Plasma/Wallpaper -l 2>/dev/null | grep -qx org.kde.barscreenlock; then
        kpackagetool6 -t Plasma/Wallpaper --upgrade lock-wallpaper >/dev/null
    else
        kpackagetool6 -t Plasma/Wallpaper --install lock-wallpaper >/dev/null
    fi
    # Keep the lock screen image you already have on your normal screens.
    cur=$(kreadconfig6 --file kscreenlockerrc --group Greeter --key WallpaperPlugin)
    if [ "$cur" != org.kde.barscreenlock ]; then
        img=$(kreadconfig6 --file kscreenlockerrc --group Greeter --group Wallpaper --group "${cur:-org.kde.image}" --group General --key Image)
        kwriteconfig6 --file kscreenlockerrc --group Greeter --group Wallpaper --group org.kde.barscreenlock --group General --key Image "$img"
        kwriteconfig6 --file kscreenlockerrc --group Greeter --key BarScreenPreviousPlugin "${cur:-org.kde.image}"
        kwriteconfig6 --file kscreenlockerrc --group Greeter --key WallpaperPlugin org.kde.barscreenlock
    fi
    mkdir -p "$(dirname "$DROPIN")"
    cat > "$DROPIN" <<CONF
# Added by bar-screen-dashboard (./install.sh --lock-clock). The lock screen, which ksmserver
# starts, uses a copy of the Plasma shell package that hides Plasma's own clock on very wide
# screens, where the lock screen wallpaper draws a centred clock instead.
# Remove with ./uninstall.sh, or delete this file and log out and back in.
[Service]
Environment=PLASMA_DEFAULT_SHELL=org.kde.plasma.barscreenlock
CONF
    python3 -I "$DEST/lockshell.py"
fi

# ---- service
mkdir -p "$UNITDIR"
cp systemd/$NAME.service "$UNITDIR/"
systemctl --user daemon-reload
systemctl --user enable $NAME.service >/dev/null 2>&1
systemctl --user restart $NAME.service

echo "Installed. Settings: $CONF/config.env (then: systemctl --user restart $NAME)"
((LOCK)) && echo "Log out and back in once for the lock screen clock to take effect."
exit 0

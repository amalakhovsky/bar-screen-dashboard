#!/usr/bin/env bash
# Remove the bar screen dashboard. Keeps your settings and browser profile unless --purge.
set -uo pipefail
NAME=bar-screen-dashboard
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/$NAME"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/$NAME"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/$NAME"
UNITDIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DROPIN="$UNITDIR/plasma-ksmserver.service.d/bar-screen-lock.conf"

systemctl --user disable --now $NAME.service >/dev/null 2>&1
rm -f "$UNITDIR/$NAME.service"
systemctl --user daemon-reload

# window rule
if command -v kwriteconfig6 >/dev/null; then
    rules=$(kreadconfig6 --file kwinrulesrc --group General --key rules | tr ',' '\n' | grep -vx "$NAME" | paste -sd, -)
    kwriteconfig6 --file kwinrulesrc --group General --key rules "$rules"
    kwriteconfig6 --file kwinrulesrc --group General --key count "$(tr ',' '\n' <<<"$rules" | grep -c .)"
    for k in Description wmclass wmclasscomplete wmclassmatch noborder noborderrule skiptaskbar skiptaskbarrule \
             skippager skippagerrule skipswitcher skipswitcherrule desktops desktopsrule acceptfocus acceptfocusrule; do
        kwriteconfig6 --file kwinrulesrc --group "$NAME" --key "$k" --delete
    done
    (qdbus6 org.kde.KWin /KWin reconfigure || qdbus org.kde.KWin /KWin reconfigure) >/dev/null 2>&1
fi

# lock screen clock
if [ -f "$DROPIN" ] || [ "$(kreadconfig6 --file kscreenlockerrc --group Greeter --key WallpaperPlugin 2>/dev/null)" = org.kde.barscreenlock ]; then
    prev=$(kreadconfig6 --file kscreenlockerrc --group Greeter --key BarScreenPreviousPlugin)
    kwriteconfig6 --file kscreenlockerrc --group Greeter --key WallpaperPlugin "${prev:-org.kde.image}"
    kwriteconfig6 --file kscreenlockerrc --group Greeter --key BarScreenPreviousPlugin --delete
    rm -f "$DROPIN"
    rmdir "$(dirname "$DROPIN")" 2>/dev/null
    rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/plasma/shells/org.kde.plasma.barscreenlock"
    kpackagetool6 -t Plasma/Wallpaper --remove org.kde.barscreenlock >/dev/null 2>&1
    echo "Lock screen clock removed; log out and back in to finish."
fi

rm -rf "${DEST:?}"
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/$NAME"
if [ "${1:-}" = "--purge" ]; then
    rm -rf "${CONF:?}" "${STATE:?}"
fi
echo "Removed $NAME."

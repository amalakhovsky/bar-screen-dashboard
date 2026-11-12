// Same look as the dashboard's idle mode (web/app.js drawIdle + style.css #idleClock).
import QtQuick
import QtCore
import Qt.labs.folderlistmodel

Rectangle {
    id: scene
    color: "#0a0c16"

    // Outside temperature, written by the dashboard server as a file name "temp_<C>".
    // The lock screen blocks network access, so this is how it gets the number.
    FolderListModel {
        id: info
        folder: StandardPaths.writableLocation(StandardPaths.GenericCacheLocation) + "/bar-screen-dashboard/lockinfo"
        nameFilters: ["temp_*"]
        showDirs: false
    }
    readonly property string temp: {
        if (info.count < 1) return "";
        const v = String(info.get(0, "fileName")).slice(5);
        return /^-?\d+$/.test(v) ? v + "°" : "";
    }

    property date now: new Date()
    Timer { interval: 1000; running: true; repeat: true; onTriggered: scene.now = new Date() }

    // Three slow blue bands, drawn at quarter resolution and scaled up.
    Canvas {
        id: bands
        width: 960; height: 240
        transform: Scale { xScale: scene.width / 960; yScale: scene.height / 240 }
        smooth: true
        renderStrategy: Canvas.Cooperative
        property real t: 0
        Timer { interval: 66; running: true; repeat: true; onTriggered: { bands.t = Date.now() / 1000; bands.requestPaint(); } }
        onPaint: {
            const ctx = getContext("2d"), w = 960, h = 240, s = t;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#0a0c16";
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = "lighter";
            const list = [
                { hue: 215, amp: 38, y: 0.55, sp: 0.05, f: 1.6, a: 0.16 },
                { hue: 228, amp: 46, y: 0.45, sp: 0.035, f: 1.1, a: 0.14 },
                { hue: 200, amp: 30, y: 0.65, sp: 0.06, f: 2.2, a: 0.10 },
            ];
            for (const b of list) {
                const g = ctx.createLinearGradient(0, 0, 0, h);
                g.addColorStop(0, Qt.hsla(b.hue / 360, 0.7, 0.5, 0));
                g.addColorStop(b.y, Qt.hsla(b.hue / 360, 0.7, 0.5, b.a));
                g.addColorStop(1, Qt.hsla(b.hue / 360, 0.7, 0.5, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(0, h);
                for (let x = 0; x <= w; x += 16) {
                    const y = h * b.y + Math.sin(x / w * Math.PI * b.f + s * b.sp * 6) * b.amp
                              + Math.sin(x / w * Math.PI * b.f * 2.3 - s * b.sp * 4) * b.amp * 0.4;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(w, h);
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
        }
    }

    Column {
        anchors.centerIn: parent
        anchors.verticalCenterOffset: -4
        spacing: -6
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatTime(scene.now, "H:mm")
            font.family: "Noto Sans"; font.pixelSize: 150 * scene.height / 480; font.weight: Font.ExtraLight
            color: Qt.rgba(232 / 255, 236 / 255, 246 / 255, 0.85)
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatDate(scene.now, "dddd d MMMM") + (scene.temp ? "  ·  " + scene.temp : "")
            font.family: "Noto Sans"; font.pixelSize: 30 * scene.height / 480
            color: "#8f9bb8"
        }
    }
}

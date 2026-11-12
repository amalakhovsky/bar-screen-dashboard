/*
 * Lock screen wallpaper: the normal image on ordinary screens, and on very wide
 * bar screens (e.g. 1920x480) the same quiet clock the music dashboard
 * shows when nothing is playing. The real dashboard can't draw over the lock
 * screen, so this stands in for it while the session is locked.
 */
import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root
    readonly property bool wide: height > 0 && width / height >= (root.configuration.WideRatio || 3)

    Rectangle {                          // shown when no image is set
        anchors.fill: parent
        visible: !root.wide
        color: "#0a0c16"
    }
    Image {
        anchors.fill: parent
        visible: !root.wide
        source: root.wide ? "" : root.configuration.Image
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        sourceSize: Qt.size(root.width, root.height)
    }

    Loader {
        anchors.fill: parent
        active: root.wide
        source: "BarScene.qml"
    }
}

import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    property string cfg_Image
    property real cfg_WideRatio
    QQC2.TextField {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.image", "Image:")
        text: cfg_Image
        onTextEdited: cfg_Image = text
        implicitWidth: Kirigami.Units.gridUnit * 24
    }
    QQC2.Label {
        text: "Screens at least 3 times wider than tall show the clock instead."
        opacity: 0.7
    }
}

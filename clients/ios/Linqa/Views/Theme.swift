import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    static func hue(_ degrees: Double, saturation: Double = 0.7, brightness: Double = 0.55) -> Color {
        Color(hue: degrees / 360, saturation: saturation, brightness: brightness)
    }
}

enum LinqaColor {
    static let background = Color(hex: 0x0F0F12)
    static let panel = Color(hex: 0x16161C)
    static let panelAlt = Color(hex: 0x1A1A22)
    static let border = Color(hex: 0x26262F)
    static let text = Color(hex: 0xE8E8ED)
    static let textDim = Color(hex: 0x9898A6)
    static let textFaint = Color(hex: 0x6B6B7B)
    static let accent = Color(hex: 0x6E7CF6)
    static let bubbleMine = Color(hex: 0x3A3FB0)
    static let bubbleTheirs = Color(hex: 0x22222C)
}

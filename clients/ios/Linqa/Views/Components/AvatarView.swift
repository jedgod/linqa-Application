import SwiftUI

struct AvatarView: View {
    let initials: String
    let hue: Double
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [Color.hue(hue), Color.hue((hue + 40).truncatingRemainder(dividingBy: 360))],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.38, weight: .semibold))
                    .foregroundColor(.white)
            )
    }
}

func hue(fromId id: String) -> Double {
    var hash = 0
    for scalar in id.unicodeScalars { hash = (hash * 31 + Int(scalar.value)) % 360 }
    return Double(hash)
}

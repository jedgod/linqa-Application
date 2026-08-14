import Foundation

enum Format {
    static func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("j:mm")
        return formatter.string(from: date)
    }

    static func relative(_ date: Date) -> String {
        let diff = Date().timeIntervalSince(date)
        let minute = 60.0
        let hour = 60 * minute
        let day = 24 * hour

        if diff < minute { return "now" }
        if diff < hour { return "\(Int(diff / minute))m" }
        if diff < day { return "\(Int(diff / hour))h" }
        return "\(Int(diff / day))d"
    }
}

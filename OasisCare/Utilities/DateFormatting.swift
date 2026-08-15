import Foundation

enum DateFormatting {
    /// Short, human label relative to today: "Aujourd'hui", "Demain",
    /// "En retard de 3 j", "Dans 5 j", or a plain date further out.
    static func relativeDayLabel(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Aujourd'hui"
        } else if calendar.isDateInTomorrow(date) {
            return "Demain"
        } else if calendar.isDateInYesterday(date) {
            return "Hier"
        }

        let startOfToday = calendar.startOfDay(for: .now)
        let startOfTarget = calendar.startOfDay(for: date)
        let days = calendar.dateComponents([.day], from: startOfToday, to: startOfTarget).day ?? 0

        if days < 0 {
            return "En retard de \(-days) j"
        } else if days <= 6 {
            return "Dans \(days) j"
        }

        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

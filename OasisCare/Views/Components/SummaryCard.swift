import SwiftUI

struct SummaryCard: View {
    var title: String
    var count: Int
    var icon: String
    var tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
            Text("\(count)")
                .font(.title)
                .fontWeight(.semibold)
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

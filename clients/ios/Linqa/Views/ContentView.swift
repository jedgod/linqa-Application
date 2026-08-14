import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            ConversationListView()
        }
        .tint(LinqaColor.accent)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}

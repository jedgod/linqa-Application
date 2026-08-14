import SwiftUI

struct ConversationListView: View {
    @State private var conversations: [Conversation] = []
    @State private var query = ""
    @State private var showSettings = false

    private var filtered: [Conversation] {
        conversations
            .filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            .sorted { a, b in
                if a.pinned != b.pinned { return a.pinned }
                return MockData.lastMessageTime(a.id) > MockData.lastMessageTime(b.id)
            }
    }

    var body: some View {
        List {
            if filtered.isEmpty {
                Text("No conversations match \"\(query)\"")
                    .foregroundStyle(LinqaColor.textFaint)
                    .listRowBackground(LinqaColor.background)
            }
            ForEach(filtered) { conversation in
                NavigationLink(value: conversation) {
                    ConversationRow(conversation: conversation)
                }
                .listRowBackground(LinqaColor.background)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(LinqaColor.background)
        .searchable(text: $query, prompt: "Search conversations")
        .navigationTitle("Linqa")
        .navigationDestination(for: Conversation.self) { conversation in
            ChatView(conversation: conversation)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
            }
        }
        .task {
            conversations = await CoreBridge.listConversations()
        }
    }
}

private struct ConversationRow: View {
    let conversation: Conversation

    private var single: Contact? {
        conversation.isGroup ? nil : MockData.contact(for: conversation.participantIds[0])
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(
                initials: single?.initials ?? String(conversation.title.prefix(2)).uppercased(),
                hue: single?.colorHue ?? hue(fromId: conversation.id),
                size: 46
            )

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(conversation.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(LinqaColor.text)
                        .lineLimit(1)
                    Spacer()
                    Text(Format.relative(MockData.lastMessageTime(conversation.id)))
                        .font(.caption2)
                        .foregroundStyle(LinqaColor.textFaint)
                }
                HStack {
                    Text(MockData.conversationSubtitle(conversation.id))
                        .font(.footnote)
                        .foregroundStyle(LinqaColor.textDim)
                        .lineLimit(1)
                    Spacer()
                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)")
                            .font(.caption2.weight(.bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(LinqaColor.accent, in: Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

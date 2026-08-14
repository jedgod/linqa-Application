import SwiftUI

struct ChatView: View {
    let conversation: Conversation

    @State private var messages: [Message] = []
    @State private var draft = ""

    private var single: Contact? {
        conversation.isGroup ? nil : MockData.contact(for: conversation.participantIds[0])
    }

    private var subtitle: String {
        var text = "🔒 End-to-end encrypted"
        if let single {
            if single.online { text += " · Online" }
        } else {
            text += " · \(conversation.participantIds.count) members"
        }
        return text
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            Divider().background(LinqaColor.border)

            HStack(spacing: 10) {
                TextField("Message…", text: $draft)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(LinqaColor.panelAlt, in: Capsule())

                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up")
                        .foregroundColor(.white)
                        .frame(width: 34, height: 34)
                        .background(draft.trimmingCharacters(in: .whitespaces).isEmpty ? LinqaColor.accent.opacity(0.4) : LinqaColor.accent, in: Circle())
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(14)
        }
        .background(LinqaColor.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(conversation.title).font(.headline)
                    Text(subtitle).font(.caption2).foregroundStyle(LinqaColor.textDim)
                }
            }
        }
        .task {
            messages = await CoreBridge.listMessages(conversationId: conversation.id)
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        draft = ""

        let optimistic = Message(
            id: "pending-\(Date().timeIntervalSince1970)",
            conversationId: conversation.id,
            senderId: "me",
            text: text,
            sentAt: Date(),
            status: .sending,
            isMine: true
        )
        messages.append(optimistic)

        Task {
            let sent = await CoreBridge.sendMessage(conversationId: conversation.id, text: text)
            if let idx = messages.firstIndex(where: { $0.id == optimistic.id }) {
                messages[idx] = sent
            }
        }
    }
}

private struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack {
            if message.isMine { Spacer(minLength: 40) }

            VStack(alignment: .trailing, spacing: 4) {
                Text(message.text)
                    .foregroundColor(message.isMine ? .white : LinqaColor.text)
                Text(Format.clock(message.sentAt) + (message.isMine ? "  \(message.status.glyph)" : ""))
                    .font(.system(size: 10))
                    .opacity(0.65)
                    .foregroundColor(message.isMine ? .white : LinqaColor.text)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .background(message.isMine ? LinqaColor.bubbleMine : LinqaColor.bubbleTheirs)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            if !message.isMine { Spacer(minLength: 40) }
        }
    }
}

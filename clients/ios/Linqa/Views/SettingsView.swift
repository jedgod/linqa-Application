import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var profile: Profile?
    @State private var devices: [LinkedDevice] = []
    @State private var linkCode: String?
    @State private var linking = false

    var body: some View {
        List {
            if let profile {
                Section("Profile") {
                    HStack(spacing: 12) {
                        AvatarView(initials: "YOU", hue: 230, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.displayName).font(.subheadline.weight(.semibold))
                            Text(profile.username).font(.footnote).foregroundStyle(LinqaColor.textDim)
                        }
                    }
                }
                .listRowBackground(LinqaColor.panel)

                Section("Security") {
                    if profile.pqEnabled {
                        Label("Post-quantum encryption active", systemImage: "shield.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(LinqaColor.accent)
                    }
                    Text(profile.fingerprint)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(LinqaColor.textDim)
                }
                .listRowBackground(LinqaColor.panel)
            }

            Section("Linked devices") {
                ForEach(devices) { device in
                    HStack(spacing: 10) {
                        Text(device.platform.icon)
                            .frame(width: 30, height: 30)
                            .background(LinqaColor.panelAlt, in: RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(device.name).font(.subheadline)
                            Text(device.isCurrent ? "Active now" : "Active \(Format.relative(device.lastActive)) ago")
                                .font(.caption2)
                                .foregroundStyle(LinqaColor.textFaint)
                        }
                        Spacer()
                        if device.isCurrent {
                            Text("THIS DEVICE")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(LinqaColor.accent)
                        }
                    }
                }

                Button {
                    linkDevice()
                } label: {
                    if linking {
                        Text("Generating code…")
                    } else {
                        Text("+ Link a new device").fontWeight(.semibold)
                    }
                }
                .disabled(linking)

                if let linkCode {
                    VStack(spacing: 6) {
                        Text(linkCode)
                            .font(.system(.title3, design: .monospaced).weight(.bold))
                            .foregroundStyle(LinqaColor.accent)
                        Text("Enter this code on the new device. It expires in 5 minutes.")
                            .font(.caption2)
                            .foregroundStyle(LinqaColor.textFaint)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
            }
            .listRowBackground(LinqaColor.panel)
        }
        .scrollContentBackground(.hidden)
        .background(LinqaColor.background)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .task {
            profile = await CoreBridge.getProfile()
            devices = await CoreBridge.listDevices()
        }
    }

    private func linkDevice() {
        linking = true
        linkCode = nil
        Task {
            linkCode = await CoreBridge.beginDeviceLink()
            linking = false
        }
    }
}

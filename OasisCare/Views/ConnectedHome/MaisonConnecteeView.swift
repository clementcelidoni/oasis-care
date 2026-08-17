import SwiftUI
import SwiftData

/// Spec §1-8 — the HomeKit/Matter entry point. `HomeKitService.start()`
/// (which is what actually triggers the system permission prompt) only
/// runs when the user opens this screen or taps "Se connecter" — never
/// at app launch, per spec §1.
struct MaisonConnecteeView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var service = HomeKitService.shared
    @ObservedObject private var commandService = DeviceCommandService.shared
    @Query private var allDevices: [ConnectedDevice]

    @State private var isAddingAccessory = false
    @State private var addAccessoryError: String?
    @State private var accessoryToAssociate: (home: ConnectedHome, accessory: ConnectedAccessory)?
    @State private var isEmergencyStopping = false

    var body: some View {
        Group {
            switch service.accessState {
            case .unknown:
                introduction
            case .authorized:
                if service.homes.isEmpty {
                    ContentUnavailableView(
                        "Aucune maison trouvée",
                        systemImage: "house",
                        description: Text("Créez une maison dans l'app Maison d'Apple, puis revenez ici.")
                    )
                } else {
                    homesList
                }
            case .denied, .restricted, .unavailable:
                unavailable
            }
        }
        .navigationTitle("Maison connectée")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if service.accessState == .authorized, let firstHome = service.homes.first {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await addAccessory(to: firstHome) }
                    } label: {
                        if isAddingAccessory {
                            ProgressView()
                        } else {
                            Label("Ajouter un appareil", systemImage: "plus")
                        }
                    }
                    .disabled(isAddingAccessory)
                }
            }
        }
        .alert("Impossible d'ajouter l'appareil", isPresented: .constant(addAccessoryError != nil), actions: {
            Button("OK") { addAccessoryError = nil }
        }, message: {
            Text(addAccessoryError ?? "")
        })
        .sheet(item: Binding(
            get: { accessoryToAssociate.map { AssociationTarget(home: $0.home, accessory: $0.accessory) } },
            set: { newValue in accessoryToAssociate = newValue.map { ($0.home, $0.accessory) } }
        )) { target in
            AssociateDeviceSheet(accessory: target.accessory)
        }
    }

    private var introduction: some View {
        VStack(spacing: 16) {
            Image(systemName: "house.and.flag.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Connecter votre maison")
                .font(.title3.weight(.semibold))
            Text("Oasis Care peut afficher et contrôler les capteurs, vannes et autres équipements liés à vos plantes, votre jardin, votre serre ou votre bassin, via l'app Maison d'Apple.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter à Maison") { service.start() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var unavailable: some View {
        VStack(spacing: 16) {
            Image(systemName: "house.slash")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(service.accessState.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if service.accessState == .denied {
                Button("Réglages iPhone") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var homesList: some View {
        List {
            if !commandService.activeValves.isEmpty {
                Section {
                    Button(role: .destructive) {
                        Task { await emergencyStop() }
                    } label: {
                        HStack {
                            if isEmergencyStopping {
                                ProgressView()
                            } else {
                                Label("ARRÊT DE L'ARROSAGE", systemImage: "stop.circle.fill")
                            }
                            Spacer()
                            Text("\(commandService.activeValves.count) en cours")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(isEmergencyStopping)
                }
            }

            ForEach(service.homes) { home in
                Section(home.name) {
                    if home.accessories.isEmpty {
                        Text("Aucun équipement dans cette maison.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(home.accessories) { accessory in
                            Button {
                                accessoryToAssociate = (home, accessory)
                            } label: {
                                AccessoryRow(accessory: accessory)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .refreshable { service.refresh() }
    }

    private func emergencyStop() async {
        isEmergencyStopping = true
        await commandService.emergencyStopAll(devices: allDevices, context: modelContext)
        isEmergencyStopping = false
    }

    private func addAccessory(to home: ConnectedHome) async {
        isAddingAccessory = true
        do {
            try await service.addAccessory(toHomeID: home.id)
        } catch {
            addAccessoryError = error.localizedDescription
        }
        isAddingAccessory = false
    }
}

private struct AssociationTarget: Identifiable {
    var home: ConnectedHome
    var accessory: ConnectedAccessory
    var id: UUID { accessory.id }
}

private struct AccessoryRow: View {
    var accessory: ConnectedAccessory

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(accessory.isReachable ? Color.green : Color.secondary.opacity(0.4))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(accessory.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                Text([accessory.roomName, accessory.category].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if !accessory.isReachable {
                Text("Hors ligne")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

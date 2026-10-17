import ExpoModulesCore
import SwiftUI
import Combine
import UIKit
import BlinkCard
import BlinkCardUX

public class LinqaBlinkCardModule: Module {
  private var scanning = false
  private var cancellable: AnyCancellable?
  private var presented: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("LinqaBlinkCard")

    AsyncFunction("scanCard") { (licenseKey: String, promise: Promise) in
      Task { @MainActor in
        guard !self.scanning else { promise.reject("BLINKCARD_BUSY", "A card scan is already in progress"); return }
        guard !licenseKey.isEmpty else { promise.reject("BLINKCARD_LICENSE_MISSING", "BlinkCard license key is missing"); return }
        guard let top = self.topViewController() else { promise.reject("BLINKCARD_NO_ACTIVITY", "No foreground view controller"); return }
        self.scanning = true

        let analyzer: BlinkCardAnalyzer
        do {
          let sdk = try await BlinkCardSdk.createBlinkCardSdk(withSettings: BlinkCardSdkSettings(licenseKey: licenseKey))
          analyzer = try await BlinkCardAnalyzer(sdk: sdk, blinkCardSessionSettings: BlinkCardSessionSettings(), eventStream: BlinkCardEventStream())
        } catch {
          self.scanning = false
          promise.reject("BLINKCARD_SDK_INIT_FAILED", "Card scanner could not start: \(error.localizedDescription)")
          return
        }

        let model = BlinkCardUXModel(analyzer: analyzer)
        let host = UIHostingController(rootView: BlinkCardUXView(viewModel: model))
        host.modalPresentationStyle = .fullScreen
        self.presented = host

        self.cancellable = model.$result.sink { [weak self] state in
          guard let self, let state else { return }
          guard let scan = state.scanningResult else {
            self.finish(promise) { $0.resolve(["status": "canceled"]) }
            return
          }
          guard let account = scan.cardAccounts.first, !account.cardNumber.isEmpty else {
            self.finish(promise) { $0.reject("BLINKCARD_NO_CARD_NUMBER", "No card number was read") }
            return
          }
          let expiry = account.expiryDate
          let parsed = expiry?.successfullyParsed ?? false
          let card: [String: Any?] = [
            "number": account.cardNumber,
            "expMonth": parsed ? expiry?.month : nil,
            "expYear": parsed ? expiry?.year : nil,
            "cvv": account.cvv,
            "holderName": scan.cardholderName,
            "issuingNetwork": scan.issuingNetwork
          ]
          self.finish(promise) { $0.resolve(["status": "scanned", "card": card] as [String: Any]) }
        }

        top.present(host, animated: true)
      }
    }
  }

  @MainActor private func finish(_ promise: Promise, _ settle: @escaping (Promise) -> Void) {
    cancellable = nil
    let host = presented
    presented = nil
    scanning = false
    if let host { host.dismiss(animated: true) { settle(promise) } } else { settle(promise) }
  }

  @MainActor private func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
    var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
    while let next = top?.presentedViewController { top = next }
    return top
  }
}

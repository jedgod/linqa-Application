import ExpoModulesCore
import Foundation

/// JS face of the native call helpers. The heavy lifting lives in
/// LinqaBlurProcessor.m and LinqaPushKit.m, which register themselves at
/// launch; this module only reports capabilities, hands out the VoIP token,
/// and tells the screen-share extension to stop.
public class LinqaCallNativeModule: Module {
  private var tokenObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LinqaCallNative")

    Constants {
      var blur = false
      if #available(iOS 15.0, *) { blur = true }
      return ["blurSupported": blur, "screenShareSupported": true]
    }

    Events("onVoipToken")

    Function("getVoipToken") { () -> String? in
      UserDefaults.standard.string(forKey: "LinqaVoipToken")
    }

    /// Ends the broadcast extension (it listens for this Darwin notification).
    Function("stopScreenShareBroadcast") {
      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterPostNotification(
        center, CFNotificationName("app.linqa.screenshare.stop" as CFString), nil, nil, true)
    }

    OnStartObserving {
      self.tokenObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("LinqaVoipTokenUpdated"), object: nil, queue: .main
      ) { [weak self] note in
        if let token = note.userInfo?["token"] as? String {
          self?.sendEvent("onVoipToken", ["token": token])
        }
      }
    }

    OnStopObserving {
      if let o = self.tokenObserver { NotificationCenter.default.removeObserver(o) }
      self.tokenObserver = nil
    }
  }
}

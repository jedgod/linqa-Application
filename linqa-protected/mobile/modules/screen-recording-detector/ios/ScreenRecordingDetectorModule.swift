import ExpoModulesCore
import UIKit

public class ScreenRecordingDetectorModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ScreenRecordingDetector")

    Events("onChange")

    Constants([
      "isSupported": true
    ])

    Function("isCaptured") { () -> Bool in
      return Self.captured()
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: UIScreen.capturedDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onChange", ["isCaptured": Self.captured()])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }

  /// Recording, AirPlay mirroring and QuickTime capture all set isCaptured.
  private static func captured() -> Bool {
    let check = { UIScreen.screens.contains { $0.isCaptured } }
    if Thread.isMainThread { return check() }
    return DispatchQueue.main.sync(execute: check)
  }
}

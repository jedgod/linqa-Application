import CoreImage
import Foundation
import ReplayKit

/// Broadcast Upload Extension for Linqa screen share.
///
/// Streams the screen to the app over a Unix socket in the shared App Group
/// container, in the framing react-native-webrtc's ScreenCapturer reads:
/// an HTTP-style message with Content-Length, Buffer-Width, Buffer-Height and
/// Buffer-Orientation headers and a JPEG body. Frames never leave the device
/// except through the call itself.
final class SampleHandler: RPBroadcastSampleHandler {
  private var socket: FrameSocket?
  private let encoder = FrameEncoder()
  private let queue = DispatchQueue(label: "app.linqa.screenshare.upload")
  private var busy = false
  private var lastSent: CFAbsoluteTime = 0
  private let minFrameInterval: CFAbsoluteTime = 1.0 / 15.0

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    guard let path = Self.socketPath() else {
      return stop("Linqa isn't set up for screen sharing.")
    }
    let s = FrameSocket(path: path)
    guard s.connect() else {
      return stop("Start screen sharing from a Linqa call.")
    }
    socket = s
    DarwinStop.observe { [weak self] in self?.stop(nil) }
  }

  override func broadcastFinished() {
    DarwinStop.remove()
    queue.sync { socket?.close() }
    socket = nil
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with type: RPSampleBufferType) {
    guard type == .video, let socket else { return }
    let now = CFAbsoluteTimeGetCurrent()
    // Drop frames while the previous one is still being written, and cap fps.
    guard !busy, now - lastSent >= minFrameInterval else { return }
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let orientation = (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 1

    busy = true
    lastSent = now
    queue.async { [weak self] in
      defer { self?.busy = false }
      guard let self, let message = self.encoder.message(for: pixelBuffer, orientation: orientation) else { return }
      if !socket.write(message) { self.stop(nil) }
    }
  }

  private func stop(_ reason: String?) {
    let error = NSError(
      domain: "app.linqa.screenshare", code: 0,
      userInfo: [NSLocalizedDescriptionKey: reason ?? "Screen sharing stopped."])
    finishBroadcastWithError(error)
  }

  private static func socketPath() -> String? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String,
          let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return dir.appendingPathComponent("rtc_SSFD").path
  }
}

/// Scales a frame down and wraps it as the message ScreenCapturer expects.
final class FrameEncoder {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let maxLongEdge: CGFloat = 1280

  func message(for pixelBuffer: CVPixelBuffer, orientation: UInt32) -> Data? {
    var image = CIImage(cvPixelBuffer: pixelBuffer)
    let long = max(image.extent.width, image.extent.height)
    if long > maxLongEdge {
      let s = maxLongEdge / long
      image = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
    }
    let w = Int(image.extent.width.rounded())
    let h = Int(image.extent.height.rounded())
    guard let jpeg = context.jpegRepresentation(
      of: image, colorSpace: CGColorSpaceCreateDeviceRGB(),
      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.6])
    else { return nil }

    let msg = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(msg, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(msg, "Buffer-Width" as CFString, String(w) as CFString)
    CFHTTPMessageSetHeaderFieldValue(msg, "Buffer-Height" as CFString, String(h) as CFString)
    CFHTTPMessageSetHeaderFieldValue(msg, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(msg, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(msg)?.takeRetainedValue() as Data?
  }
}

/// Blocking Unix-socket client. Used only from the upload queue.
final class FrameSocket {
  private let path: String
  private var fd: Int32 = -1

  init(path: String) { self.path = path }

  func connect() -> Bool {
    fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    let capacity = MemoryLayout.size(ofValue: addr.sun_path)
    guard bytes.count < capacity else { close(); return false }
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
      raw.copyBytes(from: bytes)
      raw[bytes.count] = 0
    }
    let ok = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
      }
    }
    if !ok { close() }
    return ok
  }

  func write(_ data: Data) -> Bool {
    guard fd >= 0 else { return false }
    return data.withUnsafeBytes { raw -> Bool in
      guard var p = raw.baseAddress else { return false }
      var left = raw.count
      while left > 0 {
        let n = Darwin.write(fd, p, left)
        if n <= 0 {
          if n < 0 && errno == EINTR { continue }
          return false
        }
        left -= n
        p = p.advanced(by: n)
      }
      return true
    }
  }

  func close() {
    if fd >= 0 { Darwin.close(fd) }
    fd = -1
  }
}

/// The app posts "app.linqa.screenshare.stop" when the user taps Stop sharing.
enum DarwinStop {
  private static var handler: (() -> Void)?
  private static let name = "app.linqa.screenshare.stop" as CFString

  static func observe(_ fn: @escaping () -> Void) {
    handler = fn
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), nil,
      { _, _, _, _, _ in DarwinStop.handler?() },
      name, nil, .deliverImmediately)
  }

  static func remove() {
    CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil)
    handler = nil
  }
}

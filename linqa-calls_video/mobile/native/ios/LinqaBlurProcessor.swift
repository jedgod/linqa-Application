import CoreImage
import CoreVideo
import Foundation
import Vision
import WebRTC

/// Background blur for the outgoing camera track. On-device only.
/// Vision person segmentation (iOS 15+) -> Core Image blend -> new BGRA frame.
/// Needs `#import "ProcessorProvider.h"` in the app's bridging header.
@objc(LinqaBlurProcessor)
final class LinqaBlurProcessor: NSObject, VideoFrameProcessorDelegate {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private var pool: CVPixelBufferPool?
  private var poolSize = CGSize.zero
  private var frameCount = 0
  private var lastMask: CIImage?
  private var _request: AnyObject?

  @available(iOS 15.0, *)
  private var request: VNGeneratePersonSegmentationRequest {
    if let r = _request as? VNGeneratePersonSegmentationRequest { return r }
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = .balanced
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    _request = r
    return r
  }

  // The ObjC protocol has no nullability annotations, so it imports with IUO types.
  func capturer(_ capturer: RTCVideoCapturer!, didCapture frame: RTCVideoFrame!) -> RTCVideoFrame! {
    guard #available(iOS 15.0, *), let src = frame.buffer as? RTCCVPixelBuffer else { return frame }
    let pixelBuffer = src.pixelBuffer
    let input = CIImage(cvPixelBuffer: pixelBuffer)

    // Refresh the mask every other frame to save battery.
    frameCount += 1
    if lastMask == nil || frameCount % 2 == 0 {
      let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
      if (try? handler.perform([request])) != nil, let maskBuffer = request.results?.first?.pixelBuffer {
        var mask = CIImage(cvPixelBuffer: maskBuffer)
        mask = mask.transformed(by: CGAffineTransform(
          scaleX: input.extent.width / mask.extent.width,
          y: input.extent.height / mask.extent.height))
        lastMask = mask
      }
    }
    guard let mask = lastMask else { return frame }

    let background = input.clampedToExtent().applyingGaussianBlur(sigma: 18).cropped(to: input.extent)
    let output = input.applyingFilter("CIBlendWithMask", parameters: [
      kCIInputBackgroundImageKey: background,
      kCIInputMaskImageKey: mask,
    ])

    guard let out = makeBuffer(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer)) else {
      return frame
    }
    context.render(output, to: out)
    return RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: out), rotation: frame.rotation, timeStampNs: frame.timeStampNs)
  }

  private func makeBuffer(width: Int, height: Int) -> CVPixelBuffer? {
    let size = CGSize(width: width, height: height)
    if pool == nil || poolSize != size {
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
      ]
      var newPool: CVPixelBufferPool?
      CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &newPool)
      pool = newPool
      poolSize = size
    }
    guard let pool else { return nil }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    return buffer
  }
}

/// Registers "linqa-blur" with react-native-webrtc and exposes `blurSupported` to JS.
@objc(LinqaVideoEffects)
final class LinqaVideoEffects: NSObject {
  override init() {
    super.init()
    ProcessorProvider.addProcessor(LinqaBlurProcessor(), forName: "linqa-blur")
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func constantsToExport() -> [AnyHashable: Any] {
    if #available(iOS 15.0, *) { return ["blurSupported": true] }
    return ["blurSupported": false]
  }
}

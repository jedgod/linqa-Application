// Background blur for the outgoing camera track (iOS 15+). On-device only.
// Vision person segmentation -> Core Image blend -> new BGRA frame.
// Registered with react-native-webrtc as "linqa-blur" when the app launches.

#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCVideoFrame.h>
#import <react-native-webrtc/ProcessorProvider.h>
#import <react-native-webrtc/VideoFrameProcessor.h>

@interface LinqaBlurProcessor : NSObject <VideoFrameProcessorDelegate>
@end

@implementation LinqaBlurProcessor {
  CIContext *_context;
  CVPixelBufferPoolRef _pool;
  size_t _poolW, _poolH;
  NSUInteger _frame;
  CIImage *_lastMask;
  VNGeneratePersonSegmentationRequest *_request API_AVAILABLE(ios(15.0));
}

+ (void)load {
  [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                    object:nil
                                                     queue:[NSOperationQueue mainQueue]
                                                usingBlock:^(NSNotification *note) {
    if (@available(iOS 15.0, *)) {
      [ProcessorProvider addProcessor:[LinqaBlurProcessor new] forName:@"linqa-blur"];
    }
  }];
}

- (instancetype)init {
  if ((self = [super init])) {
    _context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates : @NO}];
    if (@available(iOS 15.0, *)) {
      _request = [VNGeneratePersonSegmentationRequest new];
      _request.qualityLevel = VNGeneratePersonSegmentationRequestQualityLevelBalanced;
      _request.outputPixelFormat = kCVPixelFormatType_OneComponent8;
    }
  }
  return self;
}

- (void)dealloc {
  if (_pool) CVPixelBufferPoolRelease(_pool);
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
  if (@available(iOS 15.0, *)) {
    if (![frame.buffer isKindOfClass:[RTCCVPixelBuffer class]]) return frame;
    CVPixelBufferRef pixelBuffer = ((RTCCVPixelBuffer *)frame.buffer).pixelBuffer;
    CIImage *input = [CIImage imageWithCVPixelBuffer:pixelBuffer];

    // Refresh the mask every other frame to save battery.
    _frame++;
    if (!_lastMask || _frame % 2 == 0) {
      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pixelBuffer options:@{}];
      if ([handler performRequests:@[ _request ] error:nil]) {
        VNPixelBufferObservation *obs = _request.results.firstObject;
        if (obs) {
          CIImage *mask = [CIImage imageWithCVPixelBuffer:obs.pixelBuffer];
          CGFloat sx = input.extent.size.width / mask.extent.size.width;
          CGFloat sy = input.extent.size.height / mask.extent.size.height;
          _lastMask = [mask imageByApplyingTransform:CGAffineTransformMakeScale(sx, sy)];
        }
      }
    }
    if (!_lastMask) return frame;

    CIImage *background = [[[input imageByClampingToExtent] imageByApplyingGaussianBlurWithSigma:18]
        imageByCroppingToRect:input.extent];
    CIImage *output = [input imageByApplyingFilter:@"CIBlendWithMask"
                               withInputParameters:@{
                                 kCIInputBackgroundImageKey : background,
                                 kCIInputMaskImageKey : _lastMask
                               }];

    CVPixelBufferRef out = [self bufferWidth:CVPixelBufferGetWidth(pixelBuffer) height:CVPixelBufferGetHeight(pixelBuffer)];
    if (!out) return frame;
    [_context render:output toCVPixelBuffer:out];
    RTCCVPixelBuffer *rtcBuffer = [[RTCCVPixelBuffer alloc] initWithPixelBuffer:out];
    CVPixelBufferRelease(out);
    return [[RTCVideoFrame alloc] initWithBuffer:rtcBuffer rotation:frame.rotation timeStampNs:frame.timeStampNs];
  }
  return frame;
}

- (CVPixelBufferRef)bufferWidth:(size_t)w height:(size_t)h CF_RETURNS_RETAINED {
  if (!_pool || _poolW != w || _poolH != h) {
    if (_pool) CVPixelBufferPoolRelease(_pool);
    _pool = NULL;
    NSDictionary *attrs = @{
      (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
      (id)kCVPixelBufferWidthKey : @(w),
      (id)kCVPixelBufferHeightKey : @(h),
      (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
    };
    CVPixelBufferPoolCreate(kCFAllocatorDefault, NULL, (__bridge CFDictionaryRef)attrs, &_pool);
    _poolW = w;
    _poolH = h;
  }
  if (!_pool) return NULL;
  CVPixelBufferRef buf = NULL;
  CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, _pool, &buf);
  return buf;
}

@end

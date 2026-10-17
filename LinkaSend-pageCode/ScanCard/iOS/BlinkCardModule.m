#import "BlinkCardModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <Microblink/Microblink.h>

@interface BlinkCardModule () <MBRecognizerRunnerViewControllerDelegate>
@property (nonatomic, strong) RCTPromiseResolveBlock resolveBlock;
@property (nonatomic, strong) RCTPromiseRejectBlock rejectBlock;
@property (nonatomic, strong) MBRecognizerRunnerViewController *recognizerRunnerVC;
@end

@implementation BlinkCardModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(startScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.resolveBlock = resolve;
    self.rejectBlock = reject;

    MBBlinkCardRecognizer *blinkCardRecognizer = [[MBBlinkCardRecognizer alloc] init];
    MBBlinkCardRecognizerSettings *settings = [[MBBlinkCardRecognizerSettings alloc] init];
    blinkCardRecognizer = [[MBBlinkCardRecognizer alloc] initWithSettings:settings];

    MBRecognizerCollection *recognizerCollection = [[MBRecognizerCollection alloc] initWithRecognizers:@[blinkCardRecognizer]];

    self.recognizerRunnerVC = [[MBRecognizerRunnerViewController alloc] initWithRecognizerCollection:recognizerCollection overlaySettings:nil];
    self.recognizerRunnerVC.delegate = self;

    UIViewController *rootVC = RCTPresentedViewController();
    [rootVC presentViewController:self.recognizerRunnerVC animated:YES completion:nil];
  });
}

- (void)recognizerRunnerViewControllerDidFinishScanning:(MBRecognizerRunnerViewController *)recognizerRunnerViewController state:(MBRecognizerResultState)state {
  if (state == MBRecognizerResultStateValid) {
    MBBlinkCardRecognizer *blinkCardRecognizer = (MBBlinkCardRecognizer *)recognizerRunnerViewController.recognizerCollection.recognizers.firstObject;
    MBBlinkCardRecognizerResult *result = blinkCardRecognizer.result;

    NSString *cardNumber = result.cardNumber;
    NSString *cardHolderName = result.owner;
    NSString *expiryDate = [NSString stringWithFormat:@"%02lu/%02lu", (unsigned long)result.expiryMonth, (unsigned long)(result.expiryYear % 100)];

    NSDictionary *data = @{
      @"cardNumber": cardNumber ?: @"",
      @"cardHolderName": cardHolderName ?: @"",
      @"expiryDate": expiryDate ?: @""
    };

    [self.recognizerRunnerVC dismissViewControllerAnimated:YES completion:^{
      if (self.resolveBlock) {
        self.resolveBlock(data);
        self.resolveBlock = nil;
        self.rejectBlock = nil;
      }
    }];
  } else {
    [self.recognizerRunnerVC dismissViewControllerAnimated:YES completion:^{
      if (self.rejectBlock) {
        self.rejectBlock(@"SCAN_FAILED", @"Scan failed or canceled", nil);
        self.resolveBlock = nil;
        self.rejectBlock = nil;
      }
    }];
  }
}

@end
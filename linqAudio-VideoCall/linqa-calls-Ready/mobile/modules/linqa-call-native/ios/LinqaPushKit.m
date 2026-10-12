// PushKit VoIP handling for Linqa calls.
//
// iOS rule: every VoIP push MUST be reported to CallKit before the completion
// handler returns, or iOS kills the app and eventually stops delivering pushes.
// That has to happen natively because JS may not be running yet (app killed).
//
// Push payload (from the server's VoipPushNotifier):
//   { "linqa": { "type": "call-ring",   "callId": "<uuid>", "kind": "voice|video", "fromUserId": "..." } }
//   { "linqa": { "type": "call-cancel", "callId": "<uuid>" } }
//
// The caller's name isn't in the push (Apple sees it). CallKit shows "Linqa"
// until JS starts and calls RNCallKeep.updateDisplay with the contact name.

#import <PushKit/PushKit.h>
#import <UIKit/UIKit.h>
#import <RNCallKeep/RNCallKeep.h>

static NSString *const kTokenKey = @"LinqaVoipToken";
static NSString *const kTokenNote = @"LinqaVoipTokenUpdated";

@interface LinqaPushKit : NSObject <PKPushRegistryDelegate>
@property(nonatomic, strong) PKPushRegistry *registry;
@end

@implementation LinqaPushKit

+ (instancetype)shared {
  static LinqaPushKit *s;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ s = [LinqaPushKit new]; });
  return s;
}

+ (void)load {
  [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                    object:nil
                                                     queue:[NSOperationQueue mainQueue]
                                                usingBlock:^(NSNotification *note) {
    // CallKit must be configured before a push from a cold start is reported.
    [RNCallKeep setup:@{
      @"appName" : @"Linqa",
      @"supportsVideo" : @YES,
      @"maximumCallGroups" : @1,
      @"maximumCallsPerCallGroup" : @1,
      @"includesCallsInRecents" : @NO,
    }];
    [[LinqaPushKit shared] start];
  }];
}

- (void)start {
  if (self.registry) return;
  self.registry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
  self.registry.delegate = self;
  self.registry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
}

- (void)pushRegistry:(PKPushRegistry *)registry
    didUpdatePushCredentials:(PKPushCredentials *)credentials
                     forType:(PKPushType)type {
  const unsigned char *bytes = credentials.token.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:credentials.token.length * 2];
  for (NSUInteger i = 0; i < credentials.token.length; i++) [hex appendFormat:@"%02x", bytes[i]];
  [[NSUserDefaults standardUserDefaults] setObject:hex forKey:kTokenKey];
  [[NSNotificationCenter defaultCenter] postNotificationName:kTokenNote object:nil userInfo:@{@"token" : hex}];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type {
  [[NSUserDefaults standardUserDefaults] removeObjectForKey:kTokenKey];
}

- (void)pushRegistry:(PKPushRegistry *)registry
    didReceiveIncomingPushWithPayload:(PKPushPayload *)payload
                              forType:(PKPushType)type
                withCompletionHandler:(void (^)(void))completion {
  NSDictionary *data = payload.dictionaryPayload[@"linqa"];
  NSString *callId = [data[@"callId"] isKindOfClass:[NSString class]] ? data[@"callId"] : nil;
  NSString *kind = data[@"type"];

  if (!callId || [[NSUUID alloc] initWithUUIDString:callId] == nil) {
    // Still must report something. Report and end immediately.
    NSString *dummy = [[NSUUID UUID] UUIDString];
    [self report:dummy video:NO payload:@{} completion:^{
      [RNCallKeep endCallWithUUID:dummy reason:1];
      completion();
    }];
    return;
  }

  if ([kind isEqualToString:@"call-cancel"]) {
    if ([RNCallKeep isCallActive:callId]) {
      // Already answered on this device. Satisfy iOS with a throwaway call
      // that ends at once, and leave the real one alone.
      NSString *dummy = [[NSUUID UUID] UUIDString];
      [self report:dummy video:NO payload:@{} completion:^{
        [RNCallKeep endCallWithUUID:dummy reason:1];
        completion();
      }];
      return;
    }
    [self report:callId video:NO payload:data completion:^{
      [RNCallKeep endCallWithUUID:callId reason:2];
      completion();
    }];
    return;
  }

  BOOL video = [data[@"kind"] isEqualToString:@"video"];
  [self report:callId video:video payload:data completion:completion];
}

- (void)report:(NSString *)uuid video:(BOOL)video payload:(NSDictionary *)payload completion:(void (^)(void))completion {
  [RNCallKeep reportNewIncomingCall:uuid
                             handle:@"Linqa"
                         handleType:@"generic"
                           hasVideo:video
                localizedCallerName:@"Linqa call"
                    supportsHolding:NO
                       supportsDTMF:NO
                   supportsGrouping:NO
                 supportsUngrouping:NO
                        fromPushKit:YES
                            payload:payload
              withCompletionHandler:completion];
}

@end

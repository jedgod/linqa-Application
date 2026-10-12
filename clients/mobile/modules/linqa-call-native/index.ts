import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
const native=requireOptionalNativeModule<any>('LinqaCallNative');
export const callNative={
  available:!!native,blurSupported:Platform.OS==='android'&&!!native?.blurSupported,
  screenShareSupported:Platform.OS==='android',
  startCallService:(id:string,video:boolean)=>native?.startCallService?.(id,video),
  stopCallService:()=>native?.stopCallService?.(),
  stopScreenShareBroadcast:()=>native?.stopScreenShareBroadcast?.()
};

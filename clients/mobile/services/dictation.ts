import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";

/** Speech to text on the phone (the offline model built into the app). Returns null where the phone has no recogniser. */
export function dictationAvailable(): boolean {
  return Platform.OS === "android" && Boolean(NativeModules.LinqaCallRecorder?.startDictation);
}

export async function startDictation(onText: (text: string, final: boolean) => void): Promise<() => void> {
  const native = NativeModules.LinqaCallRecorder;
  if (!native?.startDictation) throw new Error("Voice input is not available on this phone yet.");
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Allow microphone access to use voice.");
  await native.prepare();
  const sub = DeviceEventEmitter.addListener("linqaDictation", (event: { text: string; final: boolean }) => {
    onText(event.text, event.final);
    if (event.final) sub.remove();
  });
  try {
    await native.startDictation();
  } catch (error) {
    sub.remove();
    throw error;
  }
  return () => native.stopDictation();
}

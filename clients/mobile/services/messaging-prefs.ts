import * as SecureStore from "expo-secure-store";

/**
 * Settings for how typing works on this phone, kept on the phone only. Nothing here is a message.
 * "Enter key sends" mirrors the setting on the computer: when it is on, the Enter key on the keyboard sends the message, and the
 * message box no longer starts a new line with Enter.
 */
const ENTER_SENDS_KEY = "linqa.pref.enter-sends";
const listeners=new Set<(on:boolean)=>void>();
export function subscribeEnterSends(listener:(on:boolean)=>void):()=>void {listeners.add(listener);return()=>{listeners.delete(listener);};}

export async function loadEnterSends(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync(ENTER_SENDS_KEY)) === "on"; } catch { return false; }
}

/** Resolves true only if the choice was really stored. */
export async function saveEnterSends(on: boolean): Promise<boolean> {
  try { await SecureStore.setItemAsync(ENTER_SENDS_KEY, on ? "on" : "off"); for(const listener of listeners)listener(on); return true; } catch { return false; }
}

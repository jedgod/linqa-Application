/**
 * Face / fingerprint confirmation, if this build can do it.
 *
 * expo-local-authentication needs its own native module. A development build made
 * before the package was added does not contain it, and loading the package then
 * throws. Everything here is guarded, so such a build reports "unavailable" and the
 * screen falls back to the 6-digit PIN instead of crashing. After a rebuild that
 * includes the module this lights up with no further code change.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

export type BiometricInfo = { available: boolean; label: string; icon: "scan-outline" | "finger-print-outline" };

const NONE: BiometricInfo = { available: false, label: "", icon: "finger-print-outline" };

type LocalAuthModule = {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  authenticateAsync(options?: { promptMessage?: string; cancelLabel?: string; disableDeviceFallback?: boolean }): Promise<{ success: boolean }>;
};

function load(): LocalAuthModule | null {
  try {
    // Check for the native side FIRST. Loading the package without it throws, and in development
    // that throw is reported as a red "Uncaught Error" screen even when it is caught.
    if (!requireOptionalNativeModule("ExpoLocalAuthentication")) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-local-authentication") as LocalAuthModule;
  } catch {
    return null;
  }
}

export async function biometricInfo(): Promise<BiometricInfo> {
  const module = load();
  if (!module) return NONE;
  try {
    if (!(await module.hasHardwareAsync()) || !(await module.isEnrolledAsync())) return NONE;
    const types = await module.supportedAuthenticationTypesAsync();
    // 1 = fingerprint, 2 = facial recognition
    if (types.includes(2)) return { available: true, label: "Face ID", icon: "scan-outline" };
    if (types.includes(1)) return { available: true, label: "Fingerprint", icon: "finger-print-outline" };
    return { available: true, label: "Biometrics", icon: "finger-print-outline" };
  } catch {
    return NONE;
  }
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  const module = load();
  if (!module) return false;
  try {
    // No device-PIN fallback here: the app's own transfer PIN is the fallback.
    const result = await module.authenticateAsync({ promptMessage, cancelLabel: "Use PIN", disableDeviceFallback: true });
    return result.success === true;
  } catch {
    return false;
  }
}

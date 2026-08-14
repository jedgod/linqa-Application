export type KeyProtection = "HARDWARE_BACKED" | "OS_PROTECTED";
export interface DeviceKeyPolicy {
  requireUserAuthentication: true;
  invalidateOnBiometricEnrollmentChange: true;
  exportable: false;
  preferStrongBoxOrSecureEnclave: true;
}
export const LINQA_DEVICE_KEY_POLICY: DeviceKeyPolicy = {
  requireUserAuthentication: true,
  invalidateOnBiometricEnrollmentChange: true,
  exportable: false,
  preferStrongBoxOrSecureEnclave: true
};

import { useMemo, useRef } from "react";
import { useAccounts } from "../account/AccountContext";
import { getCachedInstallationServerId } from "../account/InstallationRegistry";
import { getApiBaseUrl } from "../config/api";
import { biometricSigningModule } from "../modules/linqa-biometric";
import { BiometricClient } from "./biometric-client";
import { accessTokenProvider } from "./session";
import { accountScopeGeneration } from "./account-scope";

export function createBiometricClient(token: () => Promise<string>,isCurrent: () => boolean = () => true) {
  const generation = accountScopeGeneration();
  return new BiometricClient(getApiBaseUrl(),token,getCachedInstallationServerId,biometricSigningModule(),() => isCurrent() && generation === accountScopeGeneration());
}
export function useBiometricClient() {
  const { active } = useAccounts(); const userId = active?.userId; const current = useRef(userId); current.current = userId;
  return useMemo(() => createBiometricClient(async () => {
    if (!userId || current.current !== userId) throw new Error("Account changed. Reopen this screen.");
    return accessTokenProvider.getAccessToken();
  },() => !!userId && current.current === userId),[userId]);
}

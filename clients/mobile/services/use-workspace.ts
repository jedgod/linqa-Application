import { useMemo } from "react";
import { getRandomBytes } from "expo-crypto";
import { getApiBaseUrl } from "../config/api";
import { useAccounts } from "../account/AccountContext";
import { accessTokenProvider } from "./session";
import { vaultKeyFor } from "./vault-save";
import { workspaceKey } from "./workspace-crypto";
import { WorkspaceService } from "./workspace.service";

/**
 * The Notes, Calendar, Enterprise and privacy-controls client for the signed-in account. Switching account builds a new
 * client with that account's own key, so one account's items can never be opened with another's.
 */
export function useWorkspace(): WorkspaceService | null {
  const { active } = useAccounts();
  const userId = active?.userId;
  return useMemo(() => {
    if (!userId) return null;
    return new WorkspaceService({
      apiBaseUrl: getApiBaseUrl(),
      getAccessToken: () => accessTokenProvider.getAccessToken(),
      getKey: async () => {
        const vaultKey = await vaultKeyFor(userId, (n) => getRandomBytes(n));
        try { return workspaceKey(vaultKey); } finally { vaultKey.fill(0); }
      },
      random: (n) => getRandomBytes(n)
    });
  }, [userId]);
}

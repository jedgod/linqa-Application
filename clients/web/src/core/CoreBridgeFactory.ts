import { FailClosedCoreBridge, type SecureCoreBridge } from "./SecureCoreBridge";
import { RawWasmCoreBridge } from "./RawWasmCoreBridge";

export async function createProductionCoreBridge(input: {
  mode: string;
  secureCoreRequired: boolean;
  userId?: string;
  deviceId?: string;
  keyStorageNamespace?: string;
}): Promise<SecureCoreBridge> {
  const production = input.mode === "production" || input.mode === "LIVE";
  if (production && !input.secureCoreRequired) {
    throw new Error("Production misconfiguration: secureCoreRequired must be true");
  }
  if (!input.userId || !input.deviceId) {
    if (production) throw new Error("Secure core requires an enrolled user and device identity");
    return new FailClosedCoreBridge();
  }
  try {
    return await RawWasmCoreBridge.load({
      userId: input.userId,
      deviceId: input.deviceId,
      keyStorageNamespace: input.keyStorageNamespace
    });
  } catch (error) {
    if (production) throw new Error(`Secure core failed to load: ${String(error)}`);
    return new FailClosedCoreBridge();
  }
}


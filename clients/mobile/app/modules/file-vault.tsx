import { Redirect } from "expo-router";

/** Old entry point. The vault now lives under /vault; this keeps existing links working. */
export default function FileVaultEntry() {
  return <Redirect href="/vault" />;
}

export type ModuleKey = "auth" | "chat" | "conversation" | "calls" | "contacts" | "file-vault" | "security" | "linked-devices" | "account" | "emergency" | "countrylinqa";

const REQUIREMENTS: Record<ModuleKey, string[]> = {
  auth: ["delivery"], chat: ["secure-core", "message-relay", "key-transparency"],
  conversation: ["secure-core", "message-relay", "key-transparency"], calls: ["turn"], contacts: [],
  "file-vault": ["object-storage"], security: ["secure-core"],
  "linked-devices": ["secure-core", "key-transparency"], account: ["delivery"],
  emergency: ["escalation"], countrylinqa: ["countrylinqa-risk"]
};

export function moduleAvailable(module: ModuleKey, caps: Record<string, { state: string }>, workflowComplete: Record<string, boolean>): boolean {
  if (!workflowComplete[module]) return false;
  return REQUIREMENTS[module].every((key) => caps[key]?.state === "READY");
}

export function isGatedModule(value: string): value is ModuleKey {
  return value in REQUIREMENTS;
}


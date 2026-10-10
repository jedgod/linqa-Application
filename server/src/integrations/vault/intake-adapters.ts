/**
 * Collaborators for Save-from-Social intake (Vault pack v2.0). Every default is "unconfigured" and
 * throws, so an import can never reach AWAITING_CONFIRMATION without a real source, a real scanner
 * and real quarantine storage. Production wiring replaces these; tests inject fakes.
 */
export class IntakeUnavailableError extends Error {
  constructor(readonly code: "SOCIAL_SOURCE_NOT_CONFIGURED" | "SCANNER_NOT_CONFIGURED" | "BLOB_STORE_NOT_CONFIGURED") {
    super(code);
  }
}

export interface SocialAttachmentResolver {
  readonly name: string;
  /** Returns the file the requesting user is allowed to copy, or throws if they may not. */
  fetchAuthorizedCopy(input: { sourceRef: string; requestingUserId: string }): Promise<{ bytes: Buffer; filename: string; mediaType: string }>;
}

export interface ContentScanner {
  readonly name: string;
  scan(input: { bytes: Buffer; filename: string; mediaType: string }): Promise<{
    verdict: "CLEAN" | "MALWARE" | "SUSPICIOUS" | "ERROR";
    dlp: "CLEAR" | "REVIEW" | "BLOCK";
    details?: unknown;
  }>;
}

export interface QuarantineBlobStore {
  readonly name: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<{ sha256: string }>;
  move(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ImportKind = "SOCIAL" | "MESSAGE" | "CLIENT" | "EXTERNAL_LINK" | "SCAN_DOCUMENT";
export const IMPORT_KINDS: ImportKind[] = ["SOCIAL", "MESSAGE", "CLIENT", "EXTERNAL_LINK", "SCAN_DOCUMENT"];

export interface IntakeAdapters {
  social: SocialAttachmentResolver;
  /** Resolvers for the other intake kinds. A kind with no resolver here fails closed. */
  sources?: Partial<Record<Exclude<ImportKind, "SOCIAL">, SocialAttachmentResolver>>;
  scanner: ContentScanner;
  blobs: QuarantineBlobStore;
}

export function unconfiguredIntakeAdapters(): IntakeAdapters {
  return {
    social: {
      name: "unconfigured",
      async fetchAuthorizedCopy() { throw new IntakeUnavailableError("SOCIAL_SOURCE_NOT_CONFIGURED"); }
    },
    scanner: {
      name: "unconfigured",
      async scan() { throw new IntakeUnavailableError("SCANNER_NOT_CONFIGURED"); }
    },
    blobs: {
      name: "unconfigured",
      async put() { throw new IntakeUnavailableError("BLOB_STORE_NOT_CONFIGURED"); },
      async move() { throw new IntakeUnavailableError("BLOB_STORE_NOT_CONFIGURED"); },
      async delete() { /* nothing was stored */ }
    }
  };
}

/** The resolver for one kind of import, or the unconfigured one that refuses. */
export function resolverFor(adapters: IntakeAdapters, kind: ImportKind): SocialAttachmentResolver {
  if (kind === "SOCIAL") return adapters.social;
  return adapters.sources?.[kind] ?? unconfiguredIntakeAdapters().social;
}

/** True only when all three collaborators are real, i.e. an import can actually complete. */
export function intakeConfigured(adapters: IntakeAdapters): boolean {
  return adapters.social.name !== "unconfigured" && adapters.scanner.name !== "unconfigured" && adapters.blobs.name !== "unconfigured";
}

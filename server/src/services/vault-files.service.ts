import type { Pool } from "pg";
import { requireWorkspace, VaultError } from "./vault-access.js";

/**
 * My Files for imported objects. It returns encrypted metadata, tags and ids only; clients decrypt
 * the names themselves. Objects classified PRIVATE appear only when the caller has already proved
 * a live Private Vault unlock (the biometric service owns that check; see the route).
 */
export class VaultFilesService {
  constructor(private readonly db: Pool) {}

  async list(userId: string, input: { workspaceId?: string | undefined; folderId?: string | undefined; tag?: string | undefined; limit?: number | undefined; cursor?: string | undefined; includePrivate?: boolean | undefined }) {
    const workspace = await requireWorkspace(this.db, userId, input.workspaceId);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const includePrivate = input.includePrivate === true;
    // Keyset on (created_at, id). created_at is read and compared as text so microseconds survive.
    let after: { at: string; id: string } | null = null;
    if (input.cursor) {
      const [at, id] = input.cursor.split("|");
      if (!at || !id) throw new VaultError("INVALID_CURSOR", 400);
      after = { at, id };
    }
    const { rows } = await this.db.query(
      `SELECT o.id, o.workspace_id, o.folder_id, o.size_bytes, o.encrypted_metadata, o.content_encryption, o.classification, o.created_at::text AS created_at_text,
              COALESCE(json_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
         FROM vault_objects o
         LEFT JOIN vault_object_tags ot ON ot.object_id = o.id
         LEFT JOIN vault_tags t ON t.id = ot.tag_id
        WHERE o.workspace_id = $1 AND o.state = 'AVAILABLE'
          AND ($2::uuid IS NULL OR o.folder_id = $2)
          AND ($3::boolean OR o.classification <> 'PRIVATE')
          AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM vault_object_tags x JOIN vault_tags xt ON xt.id = x.tag_id WHERE x.object_id = o.id AND xt.name = $4))
          AND ($5::timestamptz IS NULL OR (o.created_at, o.id) < ($5::timestamptz, $6::uuid))
        GROUP BY o.id
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT $7`,
      [workspace.id, input.folderId ?? null, includePrivate, input.tag ?? null, after?.at ?? null, after?.id ?? null, limit + 1]
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      workspaceId: workspace.id as string,
      items: page.map((r) => ({
        id: r.id as string,
        folderId: r.folder_id as string | null,
        sizeBytes: Number(r.size_bytes),
        encryptedMetadata: r.encrypted_metadata as unknown,
        contentEncryption: r.content_encryption as string,
        classification: r.classification as string,
        createdAt: r.created_at_text as string,
        tags: r.tags as string[]
      })),
      nextCursor: rows.length > limit && last ? `${last.created_at_text}|${last.id}` : null
    };
  }
}

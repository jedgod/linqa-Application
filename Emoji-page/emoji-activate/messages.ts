import { Pool } from "pg";
import type { Request, Response } from "express";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Incoming = {
  clientId: string;
  conversationId: string;
  kind: string;
  body?: string;
  payload?: Record<string, unknown>;
  file?: { storageKey: string; mime: string; byteSize: number; width?: number; height?: number; durationMs?: number } | null;
};

export async function createMessage(req: Request, res: Response) {
  const senderId = req.userId as string;
  const input = req.body as Incoming;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select id from messages where client_id = $1", [input.clientId]);
    if (existing.rowCount) {
      await client.query("commit");
      res.json({ messageId: existing.rows[0].id });
      return;
    }
    const message = await client.query(
      `insert into messages (conversation_id, sender_id, kind, body, client_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.conversationId, senderId, input.kind, input.body ?? null, input.clientId],
    );
    const messageId = message.rows[0].id as string;
    if (input.file) {
      await client.query(
        `insert into attachments (message_id, kind, mime, byte_size, storage_key, width, height, duration_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [messageId, input.kind, input.file.mime, input.file.byteSize, input.file.storageKey, input.file.width ?? null, input.file.height ?? null, input.file.durationMs ?? null],
      );
    }
    await writeKind(client, messageId, input);
    await client.query("commit");
    res.status(201).json({ messageId });
  } catch (error) {
    await client.query("rollback");
    res.status(400).json({ error: error instanceof Error ? error.message : "insert failed" });
  } finally {
    client.release();
  }
}

async function writeKind(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> }, messageId: string, input: Incoming) {
  const payload = input.payload ?? {};
  if (input.kind === "location") {
    await client.query(
      `insert into locations (message_id, latitude, longitude, accuracy_m, label) values ($1, $2, $3, $4, $5)`,
      [messageId, payload.latitude, payload.longitude, payload.accuracyM ?? null, payload.label ?? null],
    );
  }
  if (input.kind === "poll") {
    await client.query(`insert into polls (message_id, question, multiple) values ($1, $2, $3)`, [messageId, payload.question, Boolean(payload.multiple)]);
    const options = Array.isArray(payload.options) ? payload.options : [];
    for (const [index, label] of options.entries()) {
      await client.query(`insert into poll_options (poll_id, label, position) values ($1, $2, $3)`, [messageId, label, index]);
    }
  }
  if (input.kind === "event") {
    await client.query(
      `insert into events (message_id, title, starts_at, ends_at, place, latitude, longitude) values ($1, $2, $3, $4, $5, $6, $7)`,
      [messageId, payload.title, payload.startsAt, payload.endsAt ?? null, payload.place ?? null, payload.latitude ?? null, payload.longitude ?? null],
    );
  }
  if (input.kind === "meeting") {
    await client.query(
      `insert into meetings (message_id, title, starts_at, ends_at, join_path) values ($1, $2, $3, $4, $5)`,
      [messageId, payload.title, payload.startsAt, payload.endsAt, payload.joinPath],
    );
  }
}

import type {SqlClient} from './migration-runner.js';

/** A reachable database is insufficient when the chat migrations are missing. */
export async function assertChatSchemaReady(db:SqlClient):Promise<void> {
  // PostgreSQL checks tables and columns even with no rows to execute. This
  // probe reads no message content and works for an empty database as well.
  await db.query(`SELECT cm.cleared_at,cm.hidden_at,m.deleted_at,a.deleted_at
    FROM conversation_members cm,chat_messages m,thread_attachments a,
      chat_message_deletions md,chat_attachment_deletions ad WHERE false`);
  const result=await db.query('SELECT count(*)::int AS "dirtyCount" FROM schema_migrations WHERE dirty');
  if(Number(result.rows[0]?.dirtyCount??0)>0)throw new Error('DATABASE_SCHEMA_NOT_READY');
}

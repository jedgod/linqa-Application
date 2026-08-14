import pg from 'pg';
const { Client } = pg;
const c = new Client({ user: 'linqa', host: '127.0.0.1', database: 'linqa', password: 'linqa_dev_password', port: 5432 });
await c.connect();
const rows = [
  { subject: 'lin-ochea', name: 'Lin Ochea', phone: '+12403711710' },
  { subject: 'priya-nair', name: 'Priya Nair', phone: '+15555550100' },
  { subject: 'avery-chen', name: 'Avery Chen', phone: '+233540088080' }
];
for (const row of rows) {
  const existing = await c.query('SELECT id FROM users WHERE external_subject = $1', [row.subject]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const insert = await c.query("INSERT INTO users (id, external_subject, status) VALUES (gen_random_uuid(), $1, 'ACTIVE') RETURNING id", [row.subject]);
    userId = insert.rows[0].id;
  }
  await c.query(
    "INSERT INTO user_profiles (user_id, display_name, bio) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio",
    [userId, row.name, 'Registered contact']
  );
  await c.query(
    "INSERT INTO account_identifiers (user_id, type, normalized_value, display_value, is_primary, verified_at) VALUES ($1, 'PHONE', $2, $2, TRUE, now()) ON CONFLICT (type, normalized_value) DO NOTHING",
    [userId, row.phone]
  );
}
const res = await c.query("SELECT u.external_subject, up.display_name, ai.normalized_value FROM users u JOIN user_profiles up ON up.user_id = u.id JOIN account_identifiers ai ON ai.user_id = u.id WHERE ai.type = 'PHONE' AND ai.normalized_value IN ('+12403711710', '+15555550100', '+233540088080') ORDER BY up.display_name");
console.log(JSON.stringify(res.rows, null, 2));
await c.end();

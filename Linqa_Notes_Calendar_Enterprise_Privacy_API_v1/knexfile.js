const path = require('node:path');
const client = process.env.DB_CLIENT || 'sqlite3';
const base = { client, migrations: { directory: path.join(__dirname, 'migrations'), extension: 'js' } };
if (client === 'pg') {
  module.exports = { ...base, connection: process.env.DATABASE_URL, pool: { min: 2, max: 10 } };
} else if (client === 'sqlite3') {
  module.exports = {
    ...base,
    connection: { filename: process.env.SQLITE_FILE || path.join(__dirname, 'linqa.sqlite') },
    useNullAsDefault: true,
    pool: { afterCreate: (conn, done) => conn.run('PRAGMA foreign_keys = ON', done) }
  };
} else throw new Error('DB_CLIENT must be sqlite3 or pg');

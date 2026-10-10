// Runnable single-process reference and tests; production server uses PostgreSQL.
import {DatabaseSync} from 'node:sqlite';
export class SqliteMediaRepository {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`CREATE TABLE IF NOT EXISTS uploads(uploadId TEXT PRIMARY KEY,accountId TEXT,deviceId TEXT,chatId TEXT,digest TEXT,byteLength INTEGER)`);}
 async get(id){return this.db.prepare('SELECT * FROM uploads WHERE uploadId=?').get(id);}
 async insertReady(r){this.db.prepare('INSERT OR IGNORE INTO uploads VALUES(?,?,?,?,?,?)').run(r.uploadId,r.accountId,r.deviceId,r.chatId,r.digest,r.byteLength);return this.get(r.uploadId);}
 close(){this.db.close();}
}

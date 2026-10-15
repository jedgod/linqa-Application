import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:undefined,max:10,connectionTimeoutMillis:5000});

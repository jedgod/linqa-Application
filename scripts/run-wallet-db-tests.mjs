// Creates and removes only a uniquely named disposable database on a loopback PostgreSQL server.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrate } from "../server/src/db/migration-runner.ts";
const root=fileURLToPath(new URL("../",import.meta.url));
const server=path.join(root,"server"),require=createRequire(path.join(server,"package.json"));
const {Pool}=require("pg");
const url=new URL(process.env.DATABASE_URL??"");
if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new Error("Wallet tests require loopback PostgreSQL");
const name=`linqa_wallet_test_${randomUUID().replaceAll("-","")}`;
const admin=new Pool({connectionString:url.href,connectionTimeoutMillis:5000});let created=false,pool;
try{
  await admin.query(`CREATE DATABASE "${name}"`);created=true;url.pathname=`/${name}`;
  pool=new Pool({connectionString:url.href});const client=await pool.connect();
  try{await migrate(client,path.join(server,"src/db/migrations"),"wallet-disposable-test");}finally{client.release();}
  const result=await promisify(execFile)(process.execPath,["node_modules/vitest/vitest.mjs","run","src/tests/linqasend-wallet.integration.test.ts","src/tests/linqasend-wallet-money.integration.test.ts","src/tests/linqasend-fee-refund.integration.test.ts","src/tests/wallet-idempotency.integration.test.ts","--maxWorkers=1"],{
    cwd:server,windowsHide:true,timeout:300000,maxBuffer:8000000,
    env:{...process.env,NODE_ENV:"test",DATABASE_URL:url.href,LINQA_WALLET_DISPOSABLE_TEST_DB:"1",LINQA_REQUIRE_DB_TESTS:"1"}
  });process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  const walletRowsBefore=(await pool.query('SELECT count(*)::text AS count FROM linqasend_wallet_postings')).rows[0].count;
  const replayClient=await pool.connect();
  try{await migrate(replayClient,path.join(server,'src/db/migrations'),'wallet-migration-replay-test');}finally{replayClient.release();}
  if((await pool.query('SELECT count(*)::text AS count FROM linqasend_wallet_postings')).rows[0].count!==walletRowsBefore)throw new Error('Migration replay changed wallet postings');
  console.log('Wallet migration replay verified without changing postings.');
}catch(error){
  if(error.stdout)process.stdout.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);
  console.error("Disposable wallet database tests failed:",error.code??error.name);process.exitCode=1;
}finally{
  await pool?.end();if(created){await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);console.log("Disposable wallet test database removed.");}await admin.end();
}

const raw=process.env.DATABASE_URL;
if(!raw){
  console.error("DATABASE_URL missing.");
  process.exit(2);
}

const u=new URL(raw);
const db=u.pathname.replace(/^\\//,"").toLowerCase();
const host=u.hostname.toLowerCase();

const allowedByName=/(^|[_-])(test|ci)([_-]|$)/.test(db);
const explicit=process.env.LINQA_ALLOW_CERT_DB==="1";

if(!allowedByName && !explicit){
  console.error(
    `Refusing certification DB: "${db}". `+
    `Use a dedicated database whose name contains test/ci, `+
    `or explicitly set LINQA_ALLOW_CERT_DB=1 after verifying safety.`
  );
  process.exit(3);
}

if(["prod","production","linqa"].includes(db) && !explicit){
  console.error("Refusing production-like database.");
  process.exit(4);
}

console.log(`Dedicated certification database accepted: ${host}/${db}`);

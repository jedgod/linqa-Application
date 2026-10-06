// Fails fast when certification demands real PostgreSQL tests but none is configured.
if (process.env.LINQA_REQUIRE_DB_TESTS === "1" && !process.env.DATABASE_URL) {
  console.error("FAIL: LINQA_REQUIRE_DB_TESTS=1 but DATABASE_URL is missing.");
  process.exit(2);
}
console.log(process.env.DATABASE_URL ? "DB integration tests enabled." : "DB integration tests may skip outside CI.");

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool, closePool } from "./pool.js";

const pool = getPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const directory = join(process.cwd(), "src", "db", "migrations");
  const versions = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of versions) {
    const version = file.slice(0, -4);
    const found = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version],
    );
    if (found.rowCount === 0) {
      await client.query(await readFile(join(directory, file), "utf8"));
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
    }
  }
  await client.query("COMMIT");
  process.stdout.write("Migrations are current.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closePool();
}

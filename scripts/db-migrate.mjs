import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDirectory = resolve(
  scriptDirectory,
  "../infra/postgres/migrations",
);
const migrationFilePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const advisoryLockName = "yoyoo_space_schema_migrations_v1";

function checksum(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function runMigrations({
  connectionString = process.env.DATABASE_URL,
  migrationsDirectory = process.env.MIGRATIONS_DIR ?? defaultMigrationsDirectory,
} = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => migrationFilePattern.test(filename))
    .sort();

  if (filenames.length === 0) {
    throw new Error(`No migration files found in ${migrationsDirectory}`);
  }

  const client = new Client({
    connectionString,
    application_name: "yoyoo-space-migrator",
  });
  const applied = [];
  const skipped = [];
  let lockAcquired = false;

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [advisoryLockName]);
    lockAcquired = true;

    for (const filename of filenames) {
      const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
      const currentChecksum = checksum(sql);
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [filename],
      );

      if (existing.rowCount === 1) {
        if (existing.rows[0].checksum !== currentChecksum) {
          throw new Error(`Migration checksum mismatch: ${filename}`);
        }
        skipped.push(filename);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [filename, currentChecksum],
        );
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied, skipped };
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [advisoryLockName]);
      }
    } finally {
      await client.end();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown migration error";
      process.stderr.write(`Migration failed: ${message}\n`);
      process.exitCode = 1;
    });
}

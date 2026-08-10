import { Pool, type PoolConfig } from "pg";

export function createPostgresPool(
  connectionString = process.env.DATABASE_URL,
  overrides: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool({
    connectionString,
    application_name: "yoyoo-space",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
}

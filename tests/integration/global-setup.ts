import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default async function setup(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
  await execFileAsync(process.execPath, [resolve(projectRoot, "scripts/db-migrate.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

import { homedir } from "node:os";
import { loadEnvFile } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface LoadYosEnvironmentOptions {
  envFile?: string;
  environment?: Record<string, string | undefined>;
  loadEnvFile?: (path: string) => void;
}

export function loadYosEnvironment({
  envFile = process.env.YOYOO_YOS_ENV_FILE?.trim() || join(homedir(), "yos", ".env"),
  environment = process.env,
  loadEnvFile: load = loadEnvFile,
}: LoadYosEnvironmentOptions = {}): { envFile: string } {
  load(envFile);
  environment.YOYOO_AGENT_ADAPTER = "yos-web-console";
  return { envFile };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    loadYosEnvironment();
    const nextBin = resolve(dirname(scriptPath), "../node_modules/next/dist/bin/next");
    process.argv[1] = nextBin;
    await import(pathToFileURL(nextBin).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`YOS mode failed to start: ${message}\n`);
    process.exitCode = 1;
  }
}

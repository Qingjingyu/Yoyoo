import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type InternalCommand = "backup" | "doctor" | "start" | "verify";
type AgentMode = "local" | "yos";

export interface InternalOptions {
  command: InternalCommand;
  mode: AgentMode;
  port: number;
  skipBuild: boolean;
  target?: string;
}

export interface ReadinessCheck {
  detail: string;
  name: string;
  ok: boolean;
  required: boolean;
}

interface ManifestArtifact {
  name: string;
  sha256: string;
  sizeBytes: number;
}

interface BackupManifest {
  artifacts: ManifestArtifact[];
  createdAt: string;
  version: 1;
}

interface RedactionPaths {
  homeDirectory?: string;
  projectRoot?: string;
}

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const composeFile = join(projectRoot, "infra/postgres/docker-compose.yml");
const backupRoot = join(projectRoot, "output/backups/internal");
const environmentFile = join(projectRoot, ".env.local");
const defaultBlobRoot = join(projectRoot, ".data/blobs");
const defaultYosEnvironmentFile = join(homedir(), "yos", ".env");
const databaseDumpName = "database.dump";
const blobArchiveName = "blobs.tar.gz";
const manifestName = "manifest.json";

export function parseInternalArgs(args: string[]): InternalOptions {
  const command = args[0] as InternalCommand | undefined;
  if (!command || !["backup", "doctor", "start", "verify"].includes(command)) {
    throw new Error("Command must be one of: doctor, backup, verify, start");
  }

  let mode: AgentMode = "yos";
  let port = 4173;
  let skipBuild = false;
  let target: string | undefined;

  for (const argument of args.slice(1)) {
    if (argument.startsWith("--mode=")) {
      const value = argument.slice("--mode=".length);
      if (value !== "local" && value !== "yos") {
        throw new Error(`Unsupported Agent mode: ${value}`);
      }
      mode = value;
      continue;
    }
    if (argument.startsWith("--port=")) {
      const value = Number(argument.slice("--port=".length));
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error("Port must be an integer between 1 and 65535");
      }
      port = value;
      continue;
    }
    if (argument === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (command === "verify" && !argument.startsWith("--") && !target) {
      target = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (command === "verify" && !target) {
    throw new Error("Backup directory is required for verify");
  }

  return { command, mode, port, skipBuild, ...(target ? { target } : {}) };
}

export function validateBackupDestination(root: string, destination: string): string {
  const allowedRoot = resolve(root, "output/backups/internal");
  const resolvedDestination = resolve(destination);
  const relativeDestination = relative(allowedRoot, resolvedDestination);
  if (
    relativeDestination === "" ||
    relativeDestination.startsWith("..") ||
    isAbsolute(relativeDestination)
  ) {
    throw new Error("Backup destination is outside the project backup root");
  }
  return resolvedDestination;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function buildManifest(
  directory: string,
  artifactNames: string[],
): Promise<BackupManifest> {
  const artifacts = await Promise.all(
    artifactNames.map(async (name) => {
      if (basename(name) !== name) {
        throw new Error(`Artifact name must not contain a path: ${name}`);
      }
      const path = join(directory, name);
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        throw new Error(`Backup artifact is not a file: ${name}`);
      }
      return {
        name,
        sha256: await sha256File(path),
        sizeBytes: metadata.size,
      };
    }),
  );

  return {
    artifacts,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

function assertManifest(value: unknown): asserts value is BackupManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Backup manifest is not an object");
  }
  const manifest = value as Partial<BackupManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.artifacts)) {
    throw new Error("Unsupported backup manifest");
  }
  const names = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      typeof artifact.name !== "string" ||
      basename(artifact.name) !== artifact.name ||
      typeof artifact.sizeBytes !== "number" ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0 ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      names.has(artifact.name)
    ) {
      throw new Error("Backup manifest contains an invalid artifact");
    }
    names.add(artifact.name);
  }
}

export async function verifyManifest(
  directory: string,
): Promise<{ artifactCount: number; valid: true }> {
  const manifestPath = join(directory, manifestName);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  assertManifest(manifest);

  for (const artifact of manifest.artifacts) {
    const artifactPath = join(directory, artifact.name);
    const metadata = await stat(artifactPath);
    if (!metadata.isFile() || metadata.size !== artifact.sizeBytes) {
      throw new Error(`Size mismatch for ${artifact.name}`);
    }
    if ((await sha256File(artifactPath)) !== artifact.sha256) {
      throw new Error(`Digest mismatch for ${artifact.name}`);
    }
  }

  return { artifactCount: manifest.artifacts.length, valid: true };
}

export function readinessVerdict(checks: ReadinessCheck[]): {
  healthy: boolean;
  requiredFailures: string[];
} {
  const requiredFailures = checks
    .filter((check) => check.required && !check.ok)
    .map((check) => check.name);
  return { healthy: requiredFailures.length === 0, requiredFailures };
}

export function redactDiagnostic(
  diagnostic: string,
  paths: RedactionPaths = {},
): string {
  let redacted = diagnostic.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi,
    "$1[redacted]@",
  );
  redacted = redacted.replace(
    /(Authorization\s*:\s*Bearer\s+)[^\s]+/gi,
    "$1[redacted]",
  );
  redacted = redacted.replace(
    /\b((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
    "$1[redacted]",
  );

  const replacements = [
    paths.projectRoot ? [resolve(paths.projectRoot), "<project>"] : undefined,
    paths.homeDirectory ? [resolve(paths.homeDirectory), "~"] : undefined,
  ].filter((entry): entry is [string, string] => Boolean(entry));
  for (const [privatePath, replacement] of replacements) {
    redacted = redacted.replaceAll(privatePath, replacement);
  }
  return redacted;
}

async function commandResult(
  command: string,
  args: string[],
  options: { cwd?: string; inputFile?: string } = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: process.env,
      stdio: [options.inputFile ? "pipe" : "ignore", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stderr || (options.inputFile && !child.stdin)) {
      child.kill();
      rejectPromise(new Error(`Unable to capture ${command} process streams`));
      return;
    }
    const childStdin = child.stdin;
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    childStdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    childStderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8").slice(-8_000),
        stdout: Buffer.concat(stdout).toString("utf8").slice(-8_000),
      });
    });
    if (options.inputFile) {
      const input = createReadStream(options.inputFile);
      input.on("error", rejectPromise);
      childStdin!.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") rejectPromise(error);
      });
      input.pipe(childStdin!);
    }
  });
}

function diagnosticMessage(result: { stderr: string; stdout: string }): string {
  return redactDiagnostic((result.stderr || result.stdout).trim(), {
    homeDirectory: homedir(),
    projectRoot,
  });
}

async function requireCommand(command: string, args: string[], label: string) {
  const result = await commandResult(command, args);
  if (result.code !== 0) {
    const detail = diagnosticMessage(result);
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await access(path, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  const probePath = join(path, `.doctor-${process.pid}`);
  const probe = await open(probePath, "wx", 0o600);
  await probe.close();
  await rm(probePath);
}

async function safeCheck(
  name: string,
  required: boolean,
  operation: () => Promise<string>,
): Promise<ReadinessCheck> {
  try {
    return { detail: await operation(), name, ok: true, required };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    return {
      detail: redactDiagnostic(message, { homeDirectory: homedir(), projectRoot }),
      name,
      ok: false,
      required,
    };
  }
}

async function collectReadinessChecks({
  mode,
  port,
  strictAgent,
}: {
  mode: AgentMode;
  port: number;
  strictAgent: boolean;
}): Promise<ReadinessCheck[]> {
  const blobRoot = resolve(process.env.YOYOO_BLOB_ROOT?.trim() || defaultBlobRoot);
  const yosEnvironmentFile = resolve(
    process.env.YOYOO_YOS_ENV_FILE?.trim() || defaultYosEnvironmentFile,
  );
  const checks: ReadinessCheck[] = [];

  checks.push(
    await safeCheck("Node.js 24+", true, async () => {
      const major = Number(process.versions.node.split(".")[0]);
      if (major < 24) throw new Error(`found Node.js ${process.versions.node}`);
      return process.versions.node;
    }),
    await safeCheck("Local environment", true, async () => {
      if (!(await pathExists(environmentFile))) throw new Error(".env.local is missing");
      if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is missing");
      return ".env.local and DATABASE_URL are available";
    }),
    await safeCheck("Docker CLI", true, async () => {
      await requireCommand("docker", ["--version"], "Docker CLI");
      return "available";
    }),
    await safeCheck("Docker daemon", true, async () => {
      await requireCommand("docker", ["info", "--format", "{{.ServerVersion}}"], "Docker daemon");
      return "available";
    }),
    await safeCheck("Docker Compose", true, async () => {
      await requireCommand("docker", ["compose", "version", "--short"], "Docker Compose");
      return "available";
    }),
    await safeCheck("Blob store", true, async () => {
      await checkWritableDirectory(blobRoot);
      return "readable and writable";
    }),
  );

  const agentCheckRequired = mode === "yos" && strictAgent;
  checks.push(
    await safeCheck("YOS environment", agentCheckRequired, async () => {
      if (!(await pathExists(yosEnvironmentFile))) throw new Error("~/yos/.env is missing");
      await access(yosEnvironmentFile, fsConstants.R_OK);
      return "available";
    }),
    await safeCheck("Codex login", agentCheckRequired, async () => {
      await requireCommand("codex", ["login", "status"], "Codex login");
      return "authenticated";
    }),
    await safeCheck("PostgreSQL", false, async () => {
      await requireCommand(
        "docker",
        [
          "compose",
          "-f",
          composeFile,
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U",
          "yoyoo",
          "-d",
          "yoyoo_space",
        ],
        "PostgreSQL health",
      );
      return "healthy";
    }),
    await safeCheck("Production build", false, async () => {
      if (!(await pathExists(join(projectRoot, ".next/BUILD_ID")))) {
        throw new Error("production build is not present; start will build it");
      }
      return "available";
    }),
    await safeCheck("Application", false, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return `reachable on 127.0.0.1:${port}`;
    }),
  );

  return checks;
}

function printReadiness(checks: ReadinessCheck[]) {
  for (const check of checks) {
    const status = check.ok ? "PASS" : check.required ? "FAIL" : "WARN";
    process.stdout.write(`[${status}] ${check.name}: ${check.detail}\n`);
  }
}

async function runDoctor(options: InternalOptions, strictAgent = false) {
  const checks = await collectReadinessChecks({
    mode: options.mode,
    port: options.port,
    strictAgent,
  });
  printReadiness(checks);
  const verdict = readinessVerdict(checks);
  if (!verdict.healthy) {
    throw new Error(`Required checks failed: ${verdict.requiredFailures.join(", ")}`);
  }
  return checks;
}

async function spawnToFile(command: string, args: string[], destination: string) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    const stderr: Buffer[] = [];
    let exitCode: number | null = null;
    let outputFinished = false;
    let settled = false;
    const finish = () => {
      if (settled || exitCode === null || !outputFinished) return;
      settled = true;
      if (exitCode === 0) {
        resolvePromise();
        return;
      }
      const detail = redactDiagnostic(Buffer.concat(stderr).toString("utf8"), {
        homeDirectory: homedir(),
        projectRoot,
      }).trim();
      rejectPromise(new Error(`Database dump failed${detail ? `: ${detail}` : ""}`));
    };
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", rejectPromise);
    output.on("error", rejectPromise);
    output.on("finish", () => {
      outputFinished = true;
      finish();
    });
    child.on("close", (code) => {
      exitCode = code ?? 1;
      finish();
    });
  });
}

async function verifyBackupArtifacts(directory: string) {
  const manifestResult = await verifyManifest(directory);
  const dumpResult = await commandResult(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "--list",
    ],
    { inputFile: join(directory, databaseDumpName) },
  );
  if (dumpResult.code !== 0) {
    const detail = diagnosticMessage(dumpResult);
    throw new Error(
      `PostgreSQL dump verification failed${detail ? `: ${detail}` : ""}`,
    );
  }
  await requireCommand(
    "tar",
    ["-tzf", join(directory, blobArchiveName)],
    "Blob archive verification",
  );
  return manifestResult;
}

async function createBackup() {
  await runDoctor(
    { command: "doctor", mode: "local", port: 4173, skipBuild: false },
    false,
  );
  await requireCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d", "--wait"],
    "PostgreSQL startup",
  );

  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const destination = validateBackupDestination(projectRoot, join(backupRoot, timestamp));
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const dumpPath = join(destination, databaseDumpName);
  const archivePath = join(destination, blobArchiveName);
  const blobRoot = resolve(process.env.YOYOO_BLOB_ROOT?.trim() || defaultBlobRoot);
  await mkdir(blobRoot, { recursive: true, mode: 0o700 });

  process.stdout.write("Creating PostgreSQL dump...\n");
  await spawnToFile(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "yoyoo",
      "-d",
      "yoyoo_space",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ],
    dumpPath,
  );

  process.stdout.write("Archiving private blobs...\n");
  await requireCommand("tar", ["-czf", archivePath, "-C", blobRoot, "."], "Blob archive");
  await chmod(archivePath, 0o600);

  const manifest = await buildManifest(destination, [databaseDumpName, blobArchiveName]);
  await writeFile(join(destination, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  process.stdout.write("Verifying backup artifacts...\n");
  const result = await verifyBackupArtifacts(destination);
  process.stdout.write(
    `Backup verified: <project>/${relative(projectRoot, destination)} (${result.artifactCount} artifacts)\n`,
  );
  return destination;
}

async function startInternal(options: InternalOptions) {
  await runDoctor(options, options.mode === "yos");
  process.stdout.write("Preparing persistent PostgreSQL...\n");
  await requireCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d", "--wait"],
    "PostgreSQL startup",
  );
  process.stdout.write("Applying checksum-verified forward migrations...\n");
  await requireCommand(
    process.execPath,
    ["--env-file-if-exists=.env.local", "scripts/db-migrate.mjs"],
    "Database migration",
  );

  if (options.skipBuild) {
    if (!(await pathExists(join(projectRoot, ".next/BUILD_ID")))) {
      throw new Error("--skip-build requires an existing production build");
    }
  } else {
    process.stdout.write("Building the production application...\n");
    await requireCommand("npm", ["run", "build"], "Production build");
  }

  const script = options.mode === "yos" ? "start:yos" : "start";
  process.stdout.write(
    `Starting ${options.mode === "yos" ? "Codex + YOS" : "deterministic local"} mode at http://127.0.0.1:${options.port}\n`,
  );
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("npm", ["run", script, "--", "--port", String(options.port)], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) child.kill(signal);
    };
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
        resolvePromise();
      } else {
        rejectPromise(new Error(`Application exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

async function main() {
  const options = parseInternalArgs(process.argv.slice(2));
  if (options.command === "doctor") {
    await runDoctor(options);
    return;
  }
  if (options.command === "backup") {
    await createBackup();
    return;
  }
  if (options.command === "verify") {
    const target = resolve(options.target!);
    const result = await verifyBackupArtifacts(target);
    process.stdout.write(`Backup verified (${result.artifactCount} artifacts).\n`);
    return;
  }
  await startInternal(options);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown internal operation failure";
    process.stderr.write(
      `Internal operation failed: ${redactDiagnostic(message, {
        homeDirectory: homedir(),
        projectRoot,
      })}\n`,
    );
    process.exitCode = 1;
  });
}

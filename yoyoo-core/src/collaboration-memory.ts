import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MemoryPriority = "P0" | "P1" | "P2";

export interface EnsureSharedMemoryScaffoldInput {
  rootDir: string;
}

export interface BuildTieredSharedMemoryContextInput {
  rootDir: string;
  maxChars?: number;
  nowMs?: number;
}

export interface AppendSharedMemoryLogInput {
  rootDir: string;
  role: string;
  summary: string;
  priority?: MemoryPriority;
  nowMs?: number;
}

export interface CleanupSharedMemoryLogsInput {
  rootDir: string;
  nowMs?: number;
}

export interface CleanupSharedMemoryLogsOutput {
  archivedCount: number;
  keptCount: number;
  archivePath: string | null;
}

const DEFAULT_MAX_CHARS = 1600;
const DAY_MS = 24 * 60 * 60 * 1000;
const P1_TTL_DAYS = 90;
const P2_TTL_DAYS = 30;

const ABSTRACT_TEMPLATE = `# Shared Memory L0 Index
- user-profile.md: stable user preferences and identity (P0)
- active-tasks.md: current active tasks and milestones (P1)
- cross-agent-log.md: cross-agent key conclusions (P0/P1/P2)
`;

const USER_PROFILE_TEMPLATE = `# User Profile

## [P0] Identity
- name:
- style:
- audience:
`;

const ACTIVE_TASKS_TEMPLATE = `# Active Tasks

## [P1] Current Tasks
- status:
- owner:
- due:
`;

const CROSS_AGENT_LOG_TEMPLATE = `# Cross Agent Log
`;

function sharedDir(rootDir: string): string {
  return path.join(rootDir, "shared-memory");
}

function absoluteFile(rootDir: string, fileName: string): string {
  return path.join(sharedDir(rootDir), fileName);
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, content, "utf8");
  }
}

function normalizeSummary(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function formatDate(nowMs: number): string {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatYearMonth(nowMs: number): string {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function priorityTtlDays(priority: MemoryPriority): number | null {
  if (priority === "P0") return null;
  if (priority === "P1") return P1_TTL_DAYS;
  return P2_TTL_DAYS;
}

function parseLogLine(line: string): {
  date: string;
  role: string;
  priority: MemoryPriority;
  summary: string;
} | null {
  const m = line.match(/^- \[(\d{4}-\d{2}-\d{2})\] \[([^\]]+)\] \[(P[012])\] (.+)$/);
  if (!m) return null;
  return {
    date: m[1],
    role: m[2],
    priority: m[3] as MemoryPriority,
    summary: m[4],
  };
}

function isExpired(date: string, priority: MemoryPriority, nowMs: number): boolean {
  const ttl = priorityTtlDays(priority);
  if (ttl === null) return false;
  const createdAt = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(createdAt)) return false;
  return nowMs - createdAt > ttl * DAY_MS;
}

function trimToMaxChars(lines: string[], maxChars: number): string {
  let out = "";
  for (const line of lines) {
    if ((out + line + "\n").length > maxChars) {
      break;
    }
    out += `${line}\n`;
  }
  return out.trim();
}

function takeTopNonEmptyLines(text: string, count: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, count);
}

export async function ensureSharedMemoryScaffold(
  input: EnsureSharedMemoryScaffoldInput,
): Promise<void> {
  const dir = sharedDir(input.rootDir);
  await mkdir(dir, { recursive: true });
  await ensureFile(absoluteFile(input.rootDir, ".abstract"), ABSTRACT_TEMPLATE);
  await ensureFile(absoluteFile(input.rootDir, "user-profile.md"), USER_PROFILE_TEMPLATE);
  await ensureFile(absoluteFile(input.rootDir, "active-tasks.md"), ACTIVE_TASKS_TEMPLATE);
  await ensureFile(absoluteFile(input.rootDir, "cross-agent-log.md"), CROSS_AGENT_LOG_TEMPLATE);
}

export async function appendSharedMemoryLog(input: AppendSharedMemoryLogInput): Promise<void> {
  await ensureSharedMemoryScaffold({ rootDir: input.rootDir });
  const nowMs = input.nowMs ?? Date.now();
  const role = input.role.trim() || "agent";
  const summary = normalizeSummary(input.summary);
  if (!summary) {
    return;
  }
  const priority = input.priority ?? "P1";
  const line = `- [${formatDate(nowMs)}] [${role}] [${priority}] ${summary}`;
  const filePath = absoluteFile(input.rootDir, "cross-agent-log.md");
  const previous = await readFile(filePath, "utf8");
  const next = previous.trim().length === 0 ? `${CROSS_AGENT_LOG_TEMPLATE}\n${line}\n` : `${previous.trimEnd()}\n${line}\n`;
  await writeFile(filePath, next, "utf8");
}

export async function buildTieredSharedMemoryContext(
  input: BuildTieredSharedMemoryContextInput,
): Promise<string> {
  await ensureSharedMemoryScaffold({ rootDir: input.rootDir });
  const nowMs = input.nowMs ?? Date.now();
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;

  const abstractText = await readFile(absoluteFile(input.rootDir, ".abstract"), "utf8");
  const profileText = await readFile(absoluteFile(input.rootDir, "user-profile.md"), "utf8");
  const tasksText = await readFile(absoluteFile(input.rootDir, "active-tasks.md"), "utf8");
  const logText = await readFile(absoluteFile(input.rootDir, "cross-agent-log.md"), "utf8");

  const rawLogLines = logText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ["));

  const activeLogLines = rawLogLines.filter((line) => {
    const parsed = parseLogLine(line);
    if (!parsed) return false;
    return !isExpired(parsed.date, parsed.priority, nowMs);
  });

  const lines = [
    "[共享记忆-L0]",
    ...takeTopNonEmptyLines(abstractText, 8),
    "",
    "[共享记忆-L1]",
    "user-profile.md:",
    ...takeTopNonEmptyLines(profileText, 6),
    "active-tasks.md:",
    ...takeTopNonEmptyLines(tasksText, 6),
    "",
    "[共享记忆-L2-摘要]",
    ...activeLogLines.slice(-8),
  ];

  return trimToMaxChars(lines, maxChars);
}

export async function cleanupExpiredSharedMemoryLogs(
  input: CleanupSharedMemoryLogsInput,
): Promise<CleanupSharedMemoryLogsOutput> {
  await ensureSharedMemoryScaffold({ rootDir: input.rootDir });
  const nowMs = input.nowMs ?? Date.now();
  const logPath = absoluteFile(input.rootDir, "cross-agent-log.md");
  const original = await readFile(logPath, "utf8");
  const lines = original.split("\n");
  const keep: string[] = [];
  const archive: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      keep.push(line);
      continue;
    }
    const parsed = parseLogLine(line.trim());
    if (!parsed) {
      keep.push(line);
      continue;
    }
    if (isExpired(parsed.date, parsed.priority, nowMs)) {
      archive.push(line);
    } else {
      keep.push(line);
    }
  }

  await writeFile(logPath, `${keep.join("\n").replace(/\n+$/g, "")}\n`, "utf8");

  if (archive.length === 0) {
    return {
      archivedCount: 0,
      keptCount: keep.filter((line) => line.trim().startsWith("- [")).length,
      archivePath: null,
    };
  }

  const archiveDir = path.join(sharedDir(input.rootDir), "archive");
  await mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${formatYearMonth(nowMs)}.md`);
  const header = `# Archived shared-memory logs (${formatDate(nowMs)})`;
  let existing = "";
  try {
    existing = await readFile(archivePath, "utf8");
  } catch {
    existing = `${header}\n`;
  }
  const nextArchive = `${existing.trimEnd()}\n${archive.join("\n")}\n`;
  await writeFile(archivePath, nextArchive, "utf8");

  return {
    archivedCount: archive.length,
    keptCount: keep.filter((line) => line.trim().startsWith("- [")).length,
    archivePath,
  };
}

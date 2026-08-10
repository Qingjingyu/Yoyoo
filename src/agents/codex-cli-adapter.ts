import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import {
  agentDescriptorSchema,
  agentRunRequestSchema,
  type AgentAdapter,
  type AgentDescriptor,
  type AgentEvent,
  type AgentHealth,
  type AgentRunRequest,
} from "@/agents/contract";
import { formatRoomConversation } from "@/agents/room-context";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const MAX_REPLY_LENGTH = 32_000;
const FORWARDED_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "CODEX_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "LANG",
  "LC_ALL",
] as const;

interface CodexCliAdapterOptions {
  runner?: CodexCliRunner;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

interface CodexCliProcessRunnerOptions {
  command?: string;
  timeoutMs?: number;
  cwd?: string;
  maxOutputBytes?: number;
  environment?: EnvironmentSource;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
}

export interface CodexCliRunner {
  health(signal?: AbortSignal): Promise<void>;
  execute(prompt: string, signal: AbortSignal): Promise<string>;
}

export class CodexCliFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = "CodexCliFailure";
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error("Codex CLI limits must be finite numbers");
  return Math.min(Math.max(Math.floor(value), minimum), maximum);
}

export function sanitizedCodexEnvironment(
  source: EnvironmentSource = process.env,
): NodeJS.ProcessEnv {
  const environment = {} as NodeJS.ProcessEnv;
  for (const key of FORWARDED_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  environment.NO_COLOR = "1";
  return environment;
}

export function buildCodexExecArgs(cwd: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    "approval_policy=\"never\"",
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.multi_agent=false",
    "--color",
    "never",
    "--json",
    "-C",
    cwd,
    "-",
  ];
}

export function parseCodexJsonl(stdout: string): string {
  let finalMessage: string | undefined;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new CodexCliFailure(
        "CODEX_INVALID_OUTPUT",
        "Codex CLI returned invalid structured output",
        true,
      );
    }
    if (
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "item.completed" &&
      "item" in event &&
      typeof event.item === "object" &&
      event.item !== null &&
      "type" in event.item &&
      event.item.type === "agent_message" &&
      "text" in event.item &&
      typeof event.item.text === "string" &&
      event.item.text.trim()
    ) {
      finalMessage = event.item.text.trim();
    }
  }
  if (!finalMessage) {
    throw new CodexCliFailure(
      "CODEX_MISSING_REPLY",
      "Codex CLI did not return a final Agent message",
      true,
    );
  }
  if (finalMessage.length > MAX_REPLY_LENGTH) {
    throw new CodexCliFailure(
      "CODEX_REPLY_TOO_LARGE",
      "Codex reply exceeded the room message limit",
      true,
    );
  }
  return finalMessage;
}

function createPrompt(request: Extract<AgentRunRequest, { roomId: string }>): string {
  const participants = request.members
    .map((member) => `${member.displayName} (${member.kind})`)
    .join(", ");
  return [
    "You are Codex, one AI participant in a Yoyoo collaboration room.",
    "Answer the human's message directly and concisely.",
    "Do not use tools, inspect files, browse, delegate, or claim actions you did not perform.",
    "Return only the final public reply that should appear in the room.",
    `Participants: ${participants}`,
    formatRoomConversation(request),
  ].join("\n");
}

function toFailure(error: unknown): CodexCliFailure {
  if (error instanceof CodexCliFailure) return error;
  return new CodexCliFailure(
    "CODEX_PROCESS_FAILED",
    "Codex CLI could not complete this run",
    true,
  );
}

export class CodexCliProcessRunner implements CodexCliRunner {
  readonly #command: string;
  readonly #timeoutMs: number;
  readonly #cwd: string;
  readonly #maxOutputBytes: number;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: CodexCliProcessRunnerOptions = {}) {
    this.#command = options.command?.trim() || "codex";
    this.#timeoutMs = boundedInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      1_000,
      600_000,
    );
    this.#cwd = options.cwd ?? tmpdir();
    this.#maxOutputBytes = boundedInteger(
      options.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      16_384,
      8_388_608,
    );
    this.#environment = sanitizedCodexEnvironment(options.environment);
  }

  async health(signal?: AbortSignal): Promise<void> {
    const result = await this.#run(["login", "status"], "", signal, 10_000);
    if (result.exitCode !== 0) {
      throw new CodexCliFailure(
        "CODEX_AUTH_REQUIRED",
        "Codex CLI is unavailable or not authenticated",
        false,
      );
    }
  }

  async execute(prompt: string, signal: AbortSignal): Promise<string> {
    const result = await this.#run(
      buildCodexExecArgs(this.#cwd),
      prompt,
      signal,
      this.#timeoutMs,
    );
    if (result.exitCode !== 0) {
      throw new CodexCliFailure(
        "CODEX_PROCESS_FAILED",
        "Codex CLI could not complete this run",
        true,
      );
    }
    return parseCodexJsonl(result.stdout);
  }

  #run(
    args: string[],
    stdin: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<ProcessResult> {
    if (signal?.aborted) {
      return Promise.reject(
        new CodexCliFailure("CODEX_ABORTED", "Codex run was stopped", true),
      );
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.#command, args, {
        cwd: this.#cwd,
        env: this.#environment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderrBytes = 0;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };
      const finishReject = (failure: CodexCliFailure) => {
        if (settled) return;
        settled = true;
        cleanup();
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => child.kill("SIGKILL"), 500);
        forceKill.unref();
        reject(failure);
      };
      const onAbort = () => {
        finishReject(new CodexCliFailure("CODEX_ABORTED", "Codex run was stopped", true));
      };
      const timeout = setTimeout(() => {
        finishReject(
          new CodexCliFailure(
            "CODEX_TIMEOUT",
            "Codex did not respond before the configured timeout",
            true,
          ),
        );
      }, timeoutMs);
      timeout.unref();

      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > this.#maxOutputBytes) {
          finishReject(
            new CodexCliFailure(
              "CODEX_OUTPUT_TOO_LARGE",
              "Codex CLI output exceeded the safe limit",
              true,
            ),
          );
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > this.#maxOutputBytes) {
          finishReject(
            new CodexCliFailure(
              "CODEX_OUTPUT_TOO_LARGE",
              "Codex CLI output exceeded the safe limit",
              true,
            ),
          );
        }
      });
      child.on("error", () => {
        finishReject(
          new CodexCliFailure(
            "CODEX_CLI_UNAVAILABLE",
            "Codex CLI is unavailable or not authenticated",
            false,
          ),
        );
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ exitCode, stdout });
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    });
  }
}

export class CodexCliAdapter implements AgentAdapter {
  readonly descriptor: AgentDescriptor = agentDescriptorSchema.parse({
    id: "codex-cli",
    displayName: "Codex",
    version: "cli-v1",
    capabilities: {
      streaming: false,
      cancellation: false,
      delegation: false,
      artifacts: false,
    },
  });

  readonly #runner: CodexCliRunner;

  constructor(options: CodexCliAdapterOptions = {}) {
    this.#runner = options.runner ?? new CodexCliProcessRunner();
  }

  async health(signal?: AbortSignal): Promise<AgentHealth> {
    try {
      await this.#runner.health(signal);
      return { status: "available" };
    } catch {
      return {
        status: "unavailable",
        message: "Codex CLI is unavailable or not authenticated",
      };
    }
  }

  async *run(
    rawRequest: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const request = agentRunRequestSchema.parse(rawRequest);
    if (!("roomId" in request)) {
      yield {
        sequence: 1,
        type: "failed",
        error: {
          code: "ROOM_CONTEXT_REQUIRED",
          message: "Codex requires room context",
          retriable: false,
        },
      };
      return;
    }
    if (signal.aborted) {
      yield { sequence: 1, type: "stopped" };
      return;
    }

    yield { sequence: 1, type: "status", status: "running" };
    yield { sequence: 2, type: "status", status: "thinking" };
    try {
      const text = await this.#runner.execute(createPrompt(request), signal);
      yield { sequence: 3, type: "text_delta", delta: text };
      yield { sequence: 4, type: "completed", text };
    } catch (error) {
      const failure = toFailure(error);
      yield {
        sequence: 3,
        type: "failed",
        error: {
          code: failure.code,
          message: failure.message,
          retriable: failure.retriable,
        },
      };
    }
  }
}

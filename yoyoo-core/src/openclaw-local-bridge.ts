import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  handleClawInboundWithYoyoo,
  type ClawAdapterInboundEvent,
  type ClawAdapterOptions,
} from "./claw-adapter-template";

const execFileAsync = promisify(execFile);

export interface OpenClawAgentRunInput {
  message: string;
  agent?: string;
  timeoutSeconds?: number;
  processTimeoutSeconds?: number;
  sessionId?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  local?: boolean;
  extraEnv?: Record<string, string>;
}

export interface OpenClawAgentRunOutput {
  reply: string;
  raw: unknown;
  stdout: string;
}

export type OpenClawExec = (
  args: string[],
  opts?: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
) => Promise<{ stdout: string }>;

function tryParseJsonFromOutput(stdout: string): unknown {
  const raw = stdout.trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  // Some openclaw runs print plugin logs before JSON payload.
  // Try parse from each line that looks like a JSON object start.
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trimStart() ?? "";
    if (!line.startsWith("{")) continue;
    const candidate = lines.slice(i).join("\n").trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  return null;
}

function normalizeReply(raw: unknown, fallbackStdout: string): string {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    const topLevelPayloads = Array.isArray(obj.payloads)
      ? (obj.payloads as Array<Record<string, unknown>>)
      : [];
    const resultPayloads = Array.isArray(result?.payloads)
      ? (result?.payloads as Array<Record<string, unknown>>)
      : [];
    const payloads = [...topLevelPayloads, ...resultPayloads];
    const firstText = payloads.find((x) => typeof x?.text === "string")?.text;
    if (typeof firstText === "string" && firstText.trim()) {
      return firstText;
    }
  }
  return fallbackStdout.trim();
}

export async function runOpenClawAgentViaCli(
  input: OpenClawAgentRunInput,
  execer?: OpenClawExec,
): Promise<OpenClawAgentRunOutput> {
  const args = [
    "agent",
    "--agent",
    input.agent ?? "main",
    "--message",
    input.message,
    "--json",
    "--timeout",
    String(input.timeoutSeconds ?? 120),
  ];
  if (input.sessionId && input.sessionId.trim()) {
    args.push("--session-id", input.sessionId.trim());
  }
  if (input.thinking) {
    args.push("--thinking", input.thinking);
  }
  if (input.local) {
    args.push("--local");
  }

  const runner: OpenClawExec =
    execer ??
    (async (a, opts) => {
      const { stdout } = await execFileAsync("openclaw", a, {
        maxBuffer: 4 * 1024 * 1024,
        env: opts?.env,
        timeout: opts?.timeoutMs,
        killSignal: "SIGTERM",
      });
      return { stdout };
    });

  const timeoutMs =
    typeof input.processTimeoutSeconds === "number" && Number.isFinite(input.processTimeoutSeconds)
      ? Math.max(1000, Math.floor(input.processTimeoutSeconds * 1000))
      : undefined;
  const runOpts =
    (input.extraEnv && Object.keys(input.extraEnv).length > 0) || timeoutMs
      ? {
          env:
            input.extraEnv && Object.keys(input.extraEnv).length > 0
              ? {
                  ...process.env,
                  ...input.extraEnv,
                }
              : undefined,
          timeoutMs,
        }
      : undefined;
  const { stdout } = runOpts ? await runner(args, runOpts) : await runner(args);
  const parsed: unknown = tryParseJsonFromOutput(stdout);

  return {
    reply: normalizeReply(parsed, stdout),
    raw: parsed,
    stdout,
  };
}

export interface RunYoyooOpenClawTurnInput {
  event: ClawAdapterInboundEvent;
  options: Omit<ClawAdapterOptions, "runClawAgent">;
  agent?: string;
  timeoutSeconds?: number;
}

export async function runYoyooOpenClawTurn(
  input: RunYoyooOpenClawTurnInput,
  execer?: OpenClawExec,
) {
  return handleClawInboundWithYoyoo(input.event, {
    ...input.options,
    runClawAgent: async ({ body }) => {
      const out = await runOpenClawAgentViaCli(
        {
          message: body,
          agent: input.agent ?? "main",
          timeoutSeconds: input.timeoutSeconds ?? 120,
        },
        execer,
      );
      return out.reply;
    },
  });
}

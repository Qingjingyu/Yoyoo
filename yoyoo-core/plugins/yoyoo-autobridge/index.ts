import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildYoyooPromptInjection, type YoyooAutobridgeOptions } from "../../src/openclaw-autobridge.ts";
import {
  appendSharedMemoryLog,
  buildTieredSharedMemoryContext,
  ensureSharedMemoryScaffold,
  type MemoryPriority,
} from "../../src/collaboration-memory.ts";
import {
  runMultiTeamCollaboration,
  type RunMultiTeamCollaborationOutput,
  type TeamRole,
} from "../../src/multi-team-collab.ts";
import { runOpenClawAgentViaCli } from "../../src/openclaw-local-bridge.ts";

type PluginConfig = YoyooAutobridgeOptions & {
  enabled?: boolean;
  sharedMemoryRoot?: string;
  sharedMemoryPriority?: MemoryPriority;
  teamCommandEnabled?: boolean;
  teamCommandAdminOnly?: boolean;
  teamDefaultRoles?: TeamRole[];
  teamReportDir?: string;
  teamCommandRunner?: TeamCommandRunner;
  teamAutoDispatchEnabled?: boolean;
  teamDispatchMaxChars?: number;
  teamDispatchTimeoutMs?: number;
  teamRunnerTimeoutSeconds?: number;
  teamRoleTimeoutSeconds?: number;
  teamRunnerOverheadSeconds?: number;
  teamRoleThinking?: "off" | "minimal" | "low" | "medium" | "high";
  teamRoleRetryCount?: number;
  teamRoleRetryBackoffMs?: number;
  teamRoleProcessTimeoutSeconds?: number;
  teamMaxParallelRoles?: number;
  teamReplyMode?: "full" | "concise";
  teamReplyRoleMaxChars?: number;
  teamReplyTotalMaxChars?: number;
  teamUseBuiltinMemoryWorker?: boolean;
  teamWorkerConfigPath?: string;
  teamWorkerSourceConfigPath?: string;
};

const execFileAsync = promisify(execFile);

type TeamCommandRunner = (input: {
  objective: string;
  roles: TeamRole[];
  sharedMemoryRoot: string;
  onRoleResult?: (roleResult: {
    role: TeamRole;
    prompt: string;
    reply: string;
    ok: boolean;
  }, index: number) => void | Promise<void>;
}) => Promise<RunMultiTeamCollaborationOutput>;

interface TeamCommandParsed {
  objective: string;
  roles: TeamRole[];
  dispatchTargets: TeamDispatchTarget[];
}

interface TeamDispatchTarget {
  channel: string;
  target: string;
  account?: string;
}

const VALID_ROLES: TeamRole[] = ["coder", "writer", "growth", "legal", "finance", "teacher"];
const VALID_ROLE_SET = new Set<TeamRole>(VALID_ROLES);
const DEFAULT_TEAM_ROLES: TeamRole[] = ["coder", "writer", "growth"];
const SEND_CHANNEL_SET = new Set([
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "feishu",
  "nostr",
  "msteams",
  "mattermost",
  "nextcloud-talk",
  "matrix",
  "bluebubbles",
  "line",
  "zalo",
  "zalouser",
  "synology-chat",
  "tlon",
]);

function resolveConfig(api: OpenClawPluginApi): PluginConfig {
  return (api.pluginConfig ?? {}) as PluginConfig;
}

function safeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function extractAssistantSummary(messages: unknown[]): string {
  const assistants = messages
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item.role === "assistant");

  for (let idx = assistants.length - 1; idx >= 0; idx -= 1) {
    const content = assistants[idx].content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const text = safeText((block as Record<string, unknown>).text);
        if (text) {
          return text;
        }
      }
    }
  }

  return "";
}

function normalizeRoleList(raw: string): TeamRole[] {
  const out: TeamRole[] = [];
  for (const part of raw.split(",")) {
    const role = part.trim().toLowerCase() as TeamRole;
    if (!VALID_ROLE_SET.has(role)) continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

function normalizeDefaultRoles(input?: TeamRole[]): TeamRole[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_TEAM_ROLES];
  }
  const normalized = input.filter((x): x is TeamRole => VALID_ROLE_SET.has(x));
  if (normalized.length === 0) {
    return [...DEFAULT_TEAM_ROLES];
  }
  return Array.from(new Set(normalized));
}

export function parseTeamDispatchTargets(input: string): TeamDispatchTarget[] {
  const out: TeamDispatchTarget[] = [];
  const chunks = input
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  for (const chunk of chunks) {
    const firstColon = chunk.indexOf(":");
    if (firstColon <= 0) continue;
    const left = chunk.slice(0, firstColon).trim();
    const target = chunk.slice(firstColon + 1).trim();
    if (!target) continue;

    const atIdx = left.indexOf("@");
    const channelRaw = atIdx >= 0 ? left.slice(0, atIdx).trim().toLowerCase() : left.toLowerCase();
    if (!SEND_CHANNEL_SET.has(channelRaw)) continue;

    const account = atIdx >= 0 ? left.slice(atIdx + 1).trim() : "";
    const key = `${channelRaw}|${account}|${target}`;
    if (out.some((x) => `${x.channel}|${x.account ?? ""}|${x.target}` === key)) continue;
    out.push({
      channel: channelRaw,
      account: account || undefined,
      target,
    });
  }

  return out;
}

export function parseTeamCommand(
  prompt: string,
  defaultRoles: TeamRole[] = DEFAULT_TEAM_ROLES,
): TeamCommandParsed | null {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  let rest = "";
  const slashIdx = lower.indexOf("/team");
  if (slashIdx >= 0) {
    rest = text.slice(slashIdx + "/team".length).trim();
  } else {
    const matched = text.match(/^team(?:\b|\s|:)/i);
    if (!matched) {
      return null;
    }
    rest = text.slice(matched[0].length).trim();
  }

  const roles = [...defaultRoles];
  let dispatchTargets: TeamDispatchTarget[] = [];
  const sendMatch = rest.match(/\s--send\s+(.+)$/i);
  if (sendMatch) {
    dispatchTargets = parseTeamDispatchTargets(sendMatch[1] ?? "");
    rest = rest.slice(0, sendMatch.index).trim();
  }
  if (!rest) {
    return {
      objective: "",
      roles,
      dispatchTargets,
    };
  }

  // Format A: /team [coder,writer] 目标
  if (rest.startsWith("[")) {
    const right = rest.indexOf("]");
    if (right > 1) {
      const rolePart = rest.slice(1, right);
      const parsedRoles = normalizeRoleList(rolePart);
      if (parsedRoles.length > 0) {
        rest = rest.slice(right + 1).trim();
        return {
          objective: rest,
          roles: parsedRoles,
          dispatchTargets,
        };
      }
    }
  }

  // Format B: /team coder,writer :: 目标
  const splitMark = "::";
  const splitIdx = rest.indexOf(splitMark);
  if (splitIdx > 0) {
    const left = rest.slice(0, splitIdx).trim();
    const parsedRoles = normalizeRoleList(left);
    if (parsedRoles.length > 0) {
      return {
        objective: rest.slice(splitIdx + splitMark.length).trim(),
        roles: parsedRoles,
        dispatchTargets,
      };
    }
  }

  // Default: /team 目标
  return {
    objective: rest,
    roles,
    dispatchTargets,
  };
}

function extractRolesFromNaturalText(text: string): TeamRole[] {
  const roles: TeamRole[] = [];
  const lower = text.toLowerCase();
  for (const role of VALID_ROLES) {
    const re = new RegExp(`\\b${role}\\b`, "i");
    if (re.test(lower) && !roles.includes(role)) {
      roles.push(role);
    }
  }

  const cnMap: Array<{ re: RegExp; role: TeamRole }> = [
    { re: /工程师/g, role: "coder" },
    { re: /内容官|文案|写手/g, role: "writer" },
    { re: /增长官|增长/g, role: "growth" },
    { re: /法务官|法务/g, role: "legal" },
    { re: /财务官|财务/g, role: "finance" },
    { re: /培训官|讲师|老师/g, role: "teacher" },
  ];
  for (const { re, role } of cnMap) {
    if (re.test(text) && !roles.includes(role)) {
      roles.push(role);
    }
  }

  return roles;
}

export function parseTeamNaturalCommand(
  prompt: string,
  defaultRoles: TeamRole[] = DEFAULT_TEAM_ROLES,
): TeamCommandParsed | null {
  const text = prompt.trim();
  if (!text) return null;

  // Explicit command should be handled by parseTeamCommand.
  if (/\/team\b/i.test(text) || /^team(?:\b|\s|:)/i.test(text)) {
    return null;
  }

  const hasTeamIntent =
    /ceo|总管|老板|团队|员工|各角色|所有角色|全员/i.test(text) &&
    /帮我问|问下|问一下|问一问|拉一下|同步|汇总|状态|进度|卡点|阻塞|最新/i.test(text);
  if (!hasTeamIntent) {
    return null;
  }

  const rolesFromText = extractRolesFromNaturalText(text);
  const roles =
    rolesFromText.length > 0
      ? rolesFromText
      : /各角色|所有角色|全员|团队全部|所有人/i.test(text)
        ? [...VALID_ROLES]
        : [...defaultRoles];

  return {
    objective: text,
    roles,
    dispatchTargets: [],
  };
}

function tryParseJsonFromMixedText(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }
  const lines = text.split("\n");
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

function extractPayloadText(raw: string): string | null {
  const parsed = tryParseJsonFromMixedText(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const result = obj.result as Record<string, unknown> | undefined;
  const topLevelPayloads = Array.isArray(obj.payloads)
    ? (obj.payloads as Array<Record<string, unknown>>)
    : [];
  const resultPayloads = Array.isArray(result?.payloads)
    ? (result?.payloads as Array<Record<string, unknown>>)
    : [];
  const payloads = [...topLevelPayloads, ...resultPayloads];
  const firstText = payloads.find((x) => typeof x?.text === "string")?.text;
  return typeof firstText === "string" && firstText.trim() ? firstText.trim() : null;
}

function normalizeTeamReply(rawReply: string, maxChars: number): string {
  const payloadText = extractPayloadText(rawReply);
  const source = payloadText ?? rawReply;
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (/^\[plugins\]/i.test(line)) return false;
      if (/^\[diagnostic\]/i.test(line)) return false;
      if (/^Gateway agent failed; falling back to embedded:/i.test(line)) return false;
      if (/^Gateway target:/i.test(line)) return false;
      if (/^Source:/i.test(line)) return false;
      if (/^Config:/i.test(line)) return false;
      if (/^Bind:/i.test(line)) return false;
      return true;
    });
  const compact = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!compact) return "(empty)";
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 16))} ...(truncated)`;
}

function formatTeamResult(
  result: RunMultiTeamCollaborationOutput,
  input?: {
    mode?: "full" | "concise";
    roleMaxChars?: number;
    totalMaxChars?: number;
  },
): string {
  const mode = input?.mode ?? "concise";
  const roleMaxChars = Math.max(120, input?.roleMaxChars ?? 800);
  const totalMaxChars = Math.max(500, input?.totalMaxChars ?? 12_000);
  const lines: string[] = [];
  lines.push("# Yoyoo Team 协作结果");
  lines.push(`- Objective: ${result.objective}`);
  lines.push(`- Roles: ${result.roles.join(",")}`);
  lines.push("");
  for (const item of result.results) {
    const cleanReply = normalizeTeamReply(item.reply || "", roleMaxChars);
    lines.push(`## ${item.role}`);
    if (mode === "concise") {
      lines.push(`- 状态：${item.ok ? "成功" : "失败"}`);
      lines.push(`- 结论：${cleanReply}`);
    } else {
      lines.push(`- 状态：${item.ok ? "成功" : "失败"}`);
      lines.push(cleanReply);
    }
    lines.push("");
  }
  const text = lines.join("\n").trim();
  if (text.length <= totalMaxChars) return text;
  return `${text.slice(0, Math.max(0, totalMaxChars - 24))}\n\n...(report truncated by yoyoo)`;
}

function fixedReplyEnvelope(text: string): { systemPrompt: string; prependContext: string } {
  return {
    systemPrompt:
      "你是Yoyoo命令回显器。你只能输出固定内容，不得改写，不得解释，不得补充，不得使用Markdown外内容。",
    prependContext: [
      "[固定内容开始]",
      text,
      "[固定内容结束]",
      "请你只输出“固定内容开始/结束”之间的内容，逐字输出。",
    ].join("\n"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTeamRoleError(msg: string): boolean {
  return (
    /session file locked/i.test(msg) ||
    /gateway timeout/i.test(msg) ||
    /gateway closed/i.test(msg) ||
    /ETIMEDOUT/i.test(msg) ||
    /timed out/i.test(msg) ||
    /ECONNRESET/i.test(msg)
  );
}

function computeTeamRunnerTimeoutMs(input: {
  rolesCount: number;
  teamRoleTimeoutSeconds: number;
  teamRunnerOverheadSeconds: number;
  configuredTimeoutSeconds?: number;
}): number {
  const roleCount = Math.max(1, input.rolesCount);
  const dynamicMs = roleCount * input.teamRoleTimeoutSeconds * 1000 + input.teamRunnerOverheadSeconds * 1000;
  const configuredMs = Math.max(0, (input.configuredTimeoutSeconds ?? 0) * 1000);
  if (configuredMs > 0) {
    return Math.max(1_000, configuredMs);
  }
  return Math.max(20_000, dynamicMs);
}

async function sendDispatchMessage(
  target: TeamDispatchTarget,
  message: string,
  timeoutMs: number,
): Promise<{ ok: boolean; note: string }> {
  const args = ["message", "send", "--channel", target.channel, "--target", target.target, "--message", message, "--json"];
  if (target.account) {
    args.push("--account", target.account);
  }
  try {
    const { stdout } = await execFileAsync("openclaw", args, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: timeoutMs,
    });
    const trimmed = stdout.trim();
    return {
      ok: true,
      note: trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      note: msg,
    };
  }
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function ensureBuiltinMemoryWorkerConfig(input: {
  sourceConfigPath: string;
  targetConfigPath: string;
  logger?: {
    warn?: (msg: string) => void;
    info?: (msg: string) => void;
  };
}): Promise<void> {
  const { sourceConfigPath, targetConfigPath, logger } = input;
  let sourceRaw = "";
  try {
    sourceRaw = await readFile(sourceConfigPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read source config (${sourceConfigPath}): ${String(err)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    const obj = JSON.parse(sourceRaw);
    parsed = obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  } catch (err) {
    throw new Error(`invalid source config json (${sourceConfigPath}): ${String(err)}`);
  }

  const memoryObj =
    parsed.memory && typeof parsed.memory === "object" ? ({ ...(parsed.memory as Record<string, unknown>) } as Record<string, unknown>) : {};
  memoryObj.backend = "builtin";
  if (memoryObj.qmd && typeof memoryObj.qmd === "object") {
    const qmdObj = { ...(memoryObj.qmd as Record<string, unknown>) };
    const updateObj =
      qmdObj.update && typeof qmdObj.update === "object"
        ? ({ ...(qmdObj.update as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    updateObj.onBoot = false;
    updateObj.waitForBootSync = false;
    qmdObj.update = updateObj;
    memoryObj.qmd = qmdObj;
  }
  parsed.memory = memoryObj;

  const targetRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  await mkdir(path.dirname(targetConfigPath), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(targetConfigPath, "utf8");
  } catch {
    existing = "";
  }

  if (existing === targetRaw) {
    return;
  }
  await writeFile(targetConfigPath, targetRaw, "utf8");
  logger?.info?.(`yoyoo-autobridge: worker config updated ${targetConfigPath}`);
}

export default function register(api: OpenClawPluginApi) {
  const cfg = resolveConfig(api);
  if (cfg.enabled === false) {
    api.logger.info?.("yoyoo-autobridge: disabled by config");
    return;
  }

  const defaultWorkspace =
    api.runtime?.workspaceDir ||
    process.env.OPENCLAW_WORKSPACE_DIR ||
    (process.env.HOME ? path.join(process.env.HOME, ".openclaw/workspace") : process.cwd());
  const sharedMemoryRoot = cfg.sharedMemoryRoot?.trim() || defaultWorkspace;
  const sharedMemoryPriority = cfg.sharedMemoryPriority ?? "P1";
  const teamCommandEnabled = cfg.teamCommandEnabled !== false;
  const hasAdminList = Array.isArray(cfg.admins) && cfg.admins.length > 0;
  const teamCommandAdminOnly = cfg.teamCommandAdminOnly ?? hasAdminList;
  const teamDefaultRoles = normalizeDefaultRoles(cfg.teamDefaultRoles);
  const teamReportDir = cfg.teamReportDir?.trim() || path.join(sharedMemoryRoot, "shared-memory", "reports");
  const teamAutoDispatchEnabled = cfg.teamAutoDispatchEnabled !== false;
  const teamDispatchMaxChars = Math.max(500, cfg.teamDispatchMaxChars ?? 2800);
  const teamDispatchTimeoutMs = Math.max(5_000, cfg.teamDispatchTimeoutMs ?? 20_000);
  const teamRoleTimeoutSeconds = Math.max(45, cfg.teamRoleTimeoutSeconds ?? 180);
  const teamRunnerOverheadSeconds = Math.max(10, cfg.teamRunnerOverheadSeconds ?? 60);
  const teamRoleThinking = cfg.teamRoleThinking ?? "off";
  const teamRoleRetryCount = Math.max(0, cfg.teamRoleRetryCount ?? 1);
  const teamRoleRetryBackoffMs = Math.max(0, cfg.teamRoleRetryBackoffMs ?? 2_000);
  const teamRoleProcessTimeoutSeconds = Math.max(
    teamRoleTimeoutSeconds + 10,
    cfg.teamRoleProcessTimeoutSeconds ?? teamRoleTimeoutSeconds + 30,
  );
  const teamRunnerTimeoutSeconds = cfg.teamRunnerTimeoutSeconds ?? 0;
  const teamMaxParallelRoles = Math.max(1, cfg.teamMaxParallelRoles ?? 3);
  const teamReplyMode = cfg.teamReplyMode === "full" ? "full" : "concise";
  const teamReplyRoleMaxChars = Math.max(120, cfg.teamReplyRoleMaxChars ?? 500);
  const teamReplyTotalMaxChars = Math.max(800, cfg.teamReplyTotalMaxChars ?? 8_000);
  const teamUseBuiltinMemoryWorker = cfg.teamUseBuiltinMemoryWorker !== false;
  const teamWorkerSourceConfigPath =
    cfg.teamWorkerSourceConfigPath?.trim() ||
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    (process.env.HOME ? path.join(process.env.HOME, ".openclaw", "openclaw.json") : path.join(process.cwd(), "openclaw.json"));
  const teamWorkerConfigPath =
    cfg.teamWorkerConfigPath?.trim() ||
    path.join(path.dirname(teamWorkerSourceConfigPath), "openclaw.yoyoo-team-worker.json");
  let teamRunnerExtraEnv: Record<string, string> | undefined;
  const teamWorkerConfigReady = teamUseBuiltinMemoryWorker
    ? ensureBuiltinMemoryWorkerConfig({
        sourceConfigPath: teamWorkerSourceConfigPath,
        targetConfigPath: teamWorkerConfigPath,
        logger: api.logger,
      })
        .then(() => {
          teamRunnerExtraEnv = {
            OPENCLAW_CONFIG_PATH: teamWorkerConfigPath,
          };
        })
        .catch((err) => {
          api.logger.warn?.(`yoyoo-autobridge: worker config init failed (${String(err)})`);
          teamRunnerExtraEnv = undefined;
        })
    : Promise.resolve();
  const teamRunner: TeamCommandRunner =
    cfg.teamCommandRunner ??
    (async ({ objective, roles, sharedMemoryRoot: root, onRoleResult }) => {
      const runSeed = Date.now();
      let runSeq = 0;
      return runMultiTeamCollaboration({
        objective,
        roles,
        maxParallelRoles: teamMaxParallelRoles,
        onRoleResult,
        sharedMemoryRootDir: root,
        runAgent: async ({ role, prompt }) => {
          await teamWorkerConfigReady;
          let lastError: unknown = null;
          const maxAttempts = 1 + teamRoleRetryCount;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            runSeq += 1;
            try {
              const out = await runOpenClawAgentViaCli({
                message: prompt,
                agent: role,
                timeoutSeconds: teamRoleTimeoutSeconds,
                processTimeoutSeconds: teamRoleProcessTimeoutSeconds,
                sessionId: `yoyoo-team-${role}-${runSeed}-${runSeq}`,
                thinking: teamRoleThinking,
                local: true,
                extraEnv: teamRunnerExtraEnv,
              });
              return out.reply;
            } catch (err) {
              lastError = err;
              const msg = err instanceof Error ? err.message : String(err);
              const canRetry = attempt < maxAttempts && isRetryableTeamRoleError(msg);
              if (!canRetry) {
                break;
              }
              api.logger.warn?.(
                `yoyoo-autobridge: role ${role} attempt ${attempt}/${maxAttempts} failed, retrying (${msg})`,
              );
              if (teamRoleRetryBackoffMs > 0) {
                await sleep(teamRoleRetryBackoffMs);
              }
            }
          }
          const msg = lastError instanceof Error ? lastError.message : String(lastError);
          throw new Error(`role ${role} failed after retry: ${msg}`);
        },
      });
    });

  ensureSharedMemoryScaffold({ rootDir: sharedMemoryRoot }).catch((err) => {
    api.logger.warn?.(`yoyoo-autobridge: scaffold init failed (${String(err)})`);
  });

  api.on(
    "before_prompt_build",
    (event, ctx) => {
    const prompt = typeof event.prompt === "string" ? event.prompt.trim() : "";
    if (!prompt) {
      return;
    }

      const out = buildYoyooPromptInjection(
      {
        prompt: event.prompt,
        sessionKey: ctx.sessionKey,
        messageProvider: ctx.messageProvider,
      },
      {
        admins: cfg.admins ?? [],
        skills: cfg.skills,
        memoryBridgeMode: cfg.memoryBridgeMode,
        groupSessionScope: cfg.groupSessionScope,
      },
      );

      const debugPromptLog = process.env.YOYOO_DEBUG_PROMPT_LOG?.trim();
      if (debugPromptLog) {
        const line = JSON.stringify(
          {
            ts: Date.now(),
            agentId: ctx.agentId ?? "unknown",
            sessionKey: ctx.sessionKey ?? "",
            prompt,
          },
          null,
          0,
        );
        appendFile(debugPromptLog, `${line}\n`, "utf8").catch(() => {});
      }

    const maybeTeam = teamCommandEnabled
      ? parseTeamCommand(prompt, teamDefaultRoles) ?? parseTeamNaturalCommand(prompt, teamDefaultRoles)
      : null;
    if (maybeTeam) {
      if (teamCommandAdminOnly && out.bridge.role !== "admin") {
        return Promise.resolve(
          fixedReplyEnvelope("[Yoyoo Team Command]\n权限不足：只有管理员可以执行 /team 指令。"),
        );
      }

      if (!maybeTeam.objective.trim()) {
        return Promise.resolve(
          fixedReplyEnvelope(
            "[Yoyoo Team Command]\n用法：/team <目标>\n可选：/team [coder,writer] <目标> 或 /team coder,writer :: <目标>",
          ),
        );
      }

      const partialResults: Array<RunMultiTeamCollaborationOutput["results"][number] | undefined> = new Array(
        maybeTeam.roles.length,
      );
      const finalizeTeamResponse = async (
        result: RunMultiTeamCollaborationOutput,
        mode: "done" | "partial" = "done",
      ) => {
        const fullReport = formatTeamResult(result, {
          mode: "full",
          roleMaxChars: Math.max(teamReplyRoleMaxChars, 2000),
          totalMaxChars: Math.max(teamReplyTotalMaxChars, 24_000),
        });
        const replyReport = formatTeamResult(result, {
          mode: teamReplyMode,
          roleMaxChars: teamReplyRoleMaxChars,
          totalMaxChars: teamReplyTotalMaxChars,
        });
        const reportName = `team-${Date.now()}.md`;
        const reportPath = path.join(teamReportDir, reportName);
        await mkdir(teamReportDir, { recursive: true });
        await writeFile(reportPath, `${fullReport}\n`, "utf8");
        api.logger.info?.(`yoyoo-autobridge: /team report saved ${reportPath}`);

        const dispatchLines: string[] = [];
        if (teamAutoDispatchEnabled && maybeTeam.dispatchTargets.length > 0) {
          const messageBody =
            replyReport.length > teamDispatchMaxChars
              ? `${replyReport.slice(0, teamDispatchMaxChars)}\n\n...(truncated by yoyoo)`
              : replyReport;
          for (const target of maybeTeam.dispatchTargets) {
            const sent = await sendDispatchMessage(target, messageBody, teamDispatchTimeoutMs);
            const scope = target.account ? `${target.channel}@${target.account}:${target.target}` : `${target.channel}:${target.target}`;
            if (sent.ok) {
              dispatchLines.push(`- [ok] ${scope}`);
            } else {
              dispatchLines.push(`- [fail] ${scope} -> ${sent.note}`);
            }
          }
        }

        const title =
          mode === "partial"
            ? `[Yoyoo Team Command 部分完成]\n已完成 ${result.results.filter((x) => x.ok).length}/${result.roles.length} 个角色。`
            : "[Yoyoo Team Command 已执行]";
        const finalText = dispatchLines.length
          ? [
              title,
              `report: ${reportPath}`,
              "",
              replyReport,
              "",
              "[Auto Dispatch]",
              ...dispatchLines,
            ].join("\n")
          : [
              title,
              `report: ${reportPath}`,
              "",
              replyReport,
            ].join("\n");

        return {
          ...fixedReplyEnvelope(finalText),
          prependContext: [
            finalText,
            "",
            "输出规则：请你直接输出上面的协作结果原文，不要改写，不要补充。",
          ].join("\n"),
        };
      };

      const effectiveTeamRunnerTimeoutMs = computeTeamRunnerTimeoutMs({
        rolesCount: maybeTeam.roles.length,
        teamRoleTimeoutSeconds,
        teamRunnerOverheadSeconds,
        configuredTimeoutSeconds: teamRunnerTimeoutSeconds,
      });

      return promiseWithTimeout(
        teamRunner({
          objective: maybeTeam.objective,
          roles: maybeTeam.roles,
          sharedMemoryRoot,
          onRoleResult: async (roleResult, idx) => {
            partialResults[idx] = roleResult;
          },
        }),
        effectiveTeamRunnerTimeoutMs,
        `team runner timeout (${effectiveTeamRunnerTimeoutMs}ms)`,
      )
        .then(async (result) => finalizeTeamResponse(result, "done"))
        .catch((err) => {
          api.logger.warn?.(`yoyoo-autobridge: /team failed (${String(err)})`);
          const msg = String(err);
          if (msg.includes("team runner timeout")) {
            const partial = maybeTeam.roles.map((role, idx) => {
              const hit = partialResults[idx];
              if (hit) return hit;
              return {
                role,
                prompt: "",
                reply: "[pending] 该角色未在时间窗口内完成。",
                ok: false,
              };
            });
            const completed = partialResults.filter(Boolean).length;
            if (completed > 0) {
              return finalizeTeamResponse(
                {
                  objective: maybeTeam.objective,
                  roles: maybeTeam.roles,
                  results: partial,
                  mergedReport: "",
                },
                "partial",
              );
            }
          }
          const timeoutHint = msg.includes("team runner timeout")
            ? "\n建议：减少角色数量（如 /team [coder,writer] ...）或把目标拆成两次。"
            : "";
          return fixedReplyEnvelope(`[Yoyoo Team Command]\n执行失败：${msg}${timeoutHint}`);
        });
    }

    const sharedMemoryContextPromise = buildTieredSharedMemoryContext({
      rootDir: sharedMemoryRoot,
      maxChars: 1200,
    }).catch(() => "");

    return sharedMemoryContextPromise.then((sharedMemoryContext) => {
      const prependContext = sharedMemoryContext
        ? `${sharedMemoryContext}\n\n${out.prependContext}`
        : out.prependContext;

      api.logger.debug?.(`yoyoo-autobridge: context injected for ${ctx.sessionKey ?? "unknown"}`);
      return {
        prependContext,
      };
    });
    },
    { priority: 999 },
  );

  api.on("agent_end", async (event, ctx) => {
    if (!event.success || !Array.isArray(event.messages) || event.messages.length === 0) {
      return;
    }

    const summary = extractAssistantSummary(event.messages);
    if (!summary) {
      return;
    }

    await appendSharedMemoryLog({
      rootDir: sharedMemoryRoot,
      role: safeText(ctx.agentId) || "agent",
      summary,
      priority: sharedMemoryPriority,
    });

    api.logger.debug?.(`yoyoo-autobridge: shared log appended by ${safeText(ctx.agentId) || "agent"}`);
  });
}

import { appendSharedMemoryLog, type MemoryPriority } from "./collaboration-memory";

export type TeamRole = "coder" | "writer" | "growth" | "legal" | "finance" | "teacher";

export interface MultiTeamAgentRunInput {
  role: TeamRole;
  prompt: string;
  objective: string;
}

export interface MultiTeamRoleResult {
  role: TeamRole;
  prompt: string;
  reply: string;
  ok: boolean;
}

export interface RunMultiTeamCollaborationInput {
  objective: string;
  runAgent: (input: MultiTeamAgentRunInput) => Promise<string>;
  roles?: TeamRole[];
  maxParallelRoles?: number;
  onRoleResult?: (roleResult: MultiTeamRoleResult, index: number) => void | Promise<void>;
  sharedMemoryRootDir?: string;
  nowMs?: number;
}

export interface RunMultiTeamCollaborationOutput {
  objective: string;
  roles: TeamRole[];
  results: MultiTeamRoleResult[];
  mergedReport: string;
}

const DEFAULT_ROLES: TeamRole[] = ["coder", "writer", "growth"];

const ROLE_PROMPTS: Record<TeamRole, string> = {
  coder: "你是工程师。请给出最小可落地方案、风险和验收点。",
  writer: "你是内容官。请给出对内说明和对外表达文案。",
  growth: "你是增长官。请给出推广切入点、指标和一周行动。",
  legal: "你是法务官。请给出合规风险和必须补的条款。",
  finance: "你是财务官。请给出成本预算、收益测算和止损线。",
  teacher: "你是培训官。请给出上手SOP和团队培训清单。",
};

const VALID_ROLE_SET = new Set<TeamRole>([
  "coder",
  "writer",
  "growth",
  "legal",
  "finance",
  "teacher",
]);

function normalizeObjective(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) return compact;
  return `${compact.slice(0, 137)}...`;
}

function pickRoles(roles?: TeamRole[]): TeamRole[] {
  const base = roles && roles.length > 0 ? roles : DEFAULT_ROLES;
  const out: TeamRole[] = [];
  for (const role of base) {
    if (!VALID_ROLE_SET.has(role)) continue;
    if (!out.includes(role)) out.push(role);
  }
  return out.length > 0 ? out : DEFAULT_ROLES;
}

function buildRolePrompt(role: TeamRole, objective: string): string {
  return `${ROLE_PROMPTS[role]}\n\n目标：${objective}\n要求：请只输出结论和可执行清单，避免空话。`;
}

function memoryPriorityOf(role: TeamRole): MemoryPriority {
  if (role === "legal" || role === "finance") return "P0";
  return "P1";
}

function buildMergedReport(objective: string, results: MultiTeamRoleResult[]): string {
  const lines: string[] = [];
  lines.push("# Yoyoo Multi-Team Report");
  lines.push(`- Objective: ${objective}`);
  lines.push("");
  for (const item of results) {
    lines.push(`## ${item.role}`);
    lines.push(item.reply.trim() || "(empty)");
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function runMultiTeamCollaboration(
  input: RunMultiTeamCollaborationInput,
): Promise<RunMultiTeamCollaborationOutput> {
  const objective = normalizeObjective(input.objective);
  if (!objective) {
    throw new Error("objective is required");
  }

  const roles = pickRoles(input.roles);
  const maxParallelRoles = Math.max(1, Math.floor(input.maxParallelRoles ?? 1));
  const results: Array<MultiTeamRoleResult | undefined> = new Array(roles.length);

  const runOne = async (idx: number): Promise<void> => {
    const role = roles[idx];
    const prompt = buildRolePrompt(role, objective);
    try {
      const reply = await input.runAgent({ role, prompt, objective });
      const finalReply = reply?.trim() || "(empty)";
      results[idx] = {
        role,
        prompt,
        reply: finalReply,
        ok: true,
      };
      if (input.onRoleResult) {
        await input.onRoleResult(results[idx], idx);
      }
      if (input.sharedMemoryRootDir) {
        await appendSharedMemoryLog({
          rootDir: input.sharedMemoryRootDir,
          role,
          priority: memoryPriorityOf(role),
          summary: normalizeSummary(finalReply),
          nowMs: input.nowMs,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const failReply = `[error] ${msg}`;
      results[idx] = {
        role,
        prompt,
        reply: failReply,
        ok: false,
      };
      if (input.onRoleResult) {
        await input.onRoleResult(results[idx], idx);
      }
      if (input.sharedMemoryRootDir) {
        await appendSharedMemoryLog({
          rootDir: input.sharedMemoryRootDir,
          role,
          priority: "P2",
          summary: normalizeSummary(failReply),
          nowMs: input.nowMs,
        });
      }
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(maxParallelRoles, roles.length) }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= roles.length) return;
      await runOne(idx);
    }
  });
  await Promise.all(workers);

  const finalResults = results.map((item, idx) => {
    if (item) return item;
    return {
      role: roles[idx],
      prompt: buildRolePrompt(roles[idx], objective),
      reply: "[error] unknown role result",
      ok: false,
    } satisfies MultiTeamRoleResult;
  });

  return {
    objective,
    roles,
    results: finalResults,
    mergedReport: buildMergedReport(objective, finalResults),
  };
}

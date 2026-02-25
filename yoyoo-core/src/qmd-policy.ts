const QMD_LOCAL_SKILL = "qmd-local-search";

const FACT_PATTERNS = [
  /\?/,
  /是什么/,
  /是什么时候/,
  /谁/,
  /多少/,
  /哪一年/,
  /官网/,
  /版本/,
  /发布/,
  /地址/,
  /\bwhat\b/i,
  /\bwhen\b/i,
  /\bwho\b/i,
  /\bhow many\b/i,
  /\bwhere\b/i,
];

export interface QmdPolicyInput {
  text: string;
  skills: string[];
  sessionKey: string;
}

export interface QmdPolicyOutput {
  mustRetrieve: boolean;
  canRetrieve: boolean;
  retrievalScopeKey: string;
  instruction: string | null;
  fallback: string | null;
}

export function hasQmdSkill(skills: string[]): boolean {
  return skills.some((skill) => skill.trim().toLowerCase() === QMD_LOCAL_SKILL);
}

export function isFactualQuestion(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return FACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildQmdRetrievalScopeKey(sessionKey: string): string {
  return `qmd:${sessionKey.trim()}`;
}

export function buildQmdPolicy(input: QmdPolicyInput): QmdPolicyOutput {
  const canRetrieve = hasQmdSkill(input.skills);
  const mustRetrieve = isFactualQuestion(input.text);
  const retrievalScopeKey = buildQmdRetrievalScopeKey(input.sessionKey);

  if (canRetrieve) {
    if (mustRetrieve) {
      return {
        mustRetrieve,
        canRetrieve,
        retrievalScopeKey,
        instruction:
          `[检索规范] 这是事实问题，先检索（qmd-local-search）再回答。` +
          ` 检索命名空间使用 ${retrievalScopeKey}。结尾必须附“来源:”并逐行列出文件路径。`,
        fallback: null,
      };
    }
    return {
      mustRetrieve,
      canRetrieve,
      retrievalScopeKey,
      instruction:
        `[检索规范] 若回答依赖文档事实，优先使用 qmd-local-search 检索。` +
        ` 检索命名空间使用 ${retrievalScopeKey}，回答结尾附“来源:”。`,
      fallback: null,
    };
  }

  if (mustRetrieve) {
    return {
      mustRetrieve,
      canRetrieve,
      retrievalScopeKey,
      instruction: null,
      fallback:
        "[降级提示] 当前没有 qmd-local-search，无法保证事实准确性。请先接入检索技能或提供可引用的资料。",
    };
  }

  return {
    mustRetrieve,
    canRetrieve,
    retrievalScopeKey,
    instruction: null,
    fallback: null,
  };
}

export function hasRequiredSources(answer: string): boolean {
  const lines = answer.split("\n").map((line) => line.trim());
  const sourceHeaderIndex = lines.findIndex((line) => /^来源[:：]$/.test(line));
  if (sourceHeaderIndex < 0) {
    return false;
  }
  const sourceLines = lines.slice(sourceHeaderIndex + 1);
  return sourceLines.some((line) => /^- .+/.test(line));
}


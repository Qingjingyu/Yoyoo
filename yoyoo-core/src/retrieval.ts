import { buildQmdPolicy, hasQmdSkill, isFactualQuestion } from "./qmd-policy";

export function buildRetrievalInstruction(
  skills: string[],
  text?: string,
  sessionKey = "unknown-session",
): string | null {
  const hasQmd = hasQmdSkill(skills);
  const normalizedText = text?.trim() ?? "";

  if (!normalizedText) {
    if (!hasQmd) {
      return null;
    }
    return "[检索规范] 涉及知识库/文档事实时，先检索（使用 qmd-local-search），再基于检索结果回答，并在结尾附上来源文件路径。";
  }

  const policy = buildQmdPolicy({
    text: normalizedText,
    skills,
    sessionKey,
  });

  if (policy.instruction) {
    return policy.instruction;
  }

  if (policy.mustRetrieve && !policy.canRetrieve) {
    return policy.fallback;
  }

  if (isFactualQuestion(normalizedText) && !hasQmd) {
    return "[降级提示] 当前没有 qmd-local-search，无法检索验证事实。";
  }

  return null;
}

import { describe, expect, it } from "vitest";
import { buildYoyooPromptInjection } from "../src/openclaw-autobridge";

describe("openclaw autobridge context", () => {
  it("builds prepend context with retrieval guidance for qmd-like prompts", () => {
    const result = buildYoyooPromptInjection(
      {
        prompt: "查一下部署文档",
        sessionKey: "group:g-alpha:user:u-admin",
        messageProvider: "dingtalk",
      },
      {
        admins: ["u-admin"],
        skills: ["qmd-local-search"],
        memoryBridgeMode: "user-global",
        groupSessionScope: "per-user",
      },
    );

    expect(result.prependContext).toContain("[Yoyoo桥接上下文]");
    expect(result.prependContext).toContain("role: admin");
    expect(result.prependContext).toContain("session_key: user:u-admin");
    expect(result.prependContext).toContain("memory_namespace: admin:u-admin");
    expect(result.prependContext).toContain("[检索规范]");
  });

  it("falls back safely when session key cannot be parsed", () => {
    const result = buildYoyooPromptInjection(
      {
        prompt: "你好",
        sessionKey: "unexpected-key",
      },
      {
        admins: ["u-admin"],
      },
    );

    expect(result.prependContext).toContain("role: member");
    expect(result.prependContext).toContain("session_key: user:unknown");
    expect(result.prependContext).toContain("memory_namespace: user:unknown");
    expect(result.prependContext).toContain("[检索规范]");
  });
});

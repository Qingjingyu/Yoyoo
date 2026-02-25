import { describe, expect, it } from "vitest";
import {
  buildQmdPolicy,
  buildQmdRetrievalScopeKey,
  hasRequiredSources,
} from "../src/qmd-policy";

describe("p0 qmd policy", () => {
  it("forces retrieval for factual questions when qmd is available", () => {
    const out = buildQmdPolicy({
      text: "OpenClaw 2026.2.22-2 是什么时候发布的？",
      skills: ["qmd-local-search"],
      sessionKey: "group:dingtalk:g1",
    });

    expect(out.mustRetrieve).toBe(true);
    expect(out.canRetrieve).toBe(true);
    expect(out.instruction.includes("先检索")).toBe(true);
    expect(out.retrievalScopeKey).toBe("qmd:group:dingtalk:g1");
  });

  it("returns a downgrade message when retrieval is required but qmd is missing", () => {
    const out = buildQmdPolicy({
      text: "OpenClaw 的官网地址是什么？",
      skills: ["other-skill"],
      sessionKey: "direct:u1",
    });

    expect(out.mustRetrieve).toBe(true);
    expect(out.canRetrieve).toBe(false);
    expect(out.instruction).toBeNull();
    expect(out.fallback).toContain("当前没有 qmd-local-search");
  });

  it("validates required source section format", () => {
    const withSources = [
      "这是回答。",
      "来源:",
      "- /docs/openclaw/changelog.md#L18",
      "- /kb/release-note.md",
    ].join("\n");
    const withoutSources = "这是回答，但没有来源。";

    expect(hasRequiredSources(withSources)).toBe(true);
    expect(hasRequiredSources(withoutSources)).toBe(false);
  });

  it("isolates retrieval scope by session key", () => {
    const groupScope = buildQmdRetrievalScopeKey("group:dingtalk:g1");
    const directScope = buildQmdRetrievalScopeKey("direct:u1");

    expect(groupScope).toBe("qmd:group:dingtalk:g1");
    expect(directScope).toBe("qmd:direct:u1");
    expect(groupScope).not.toBe(directScope);
  });
});

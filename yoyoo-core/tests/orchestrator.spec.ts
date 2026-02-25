import { describe, expect, it } from "vitest";
import { createYoyooCore } from "../src/index";

describe("yoyoo orchestrator", () => {
  it("returns role, sessionKey, retrievalHint in one response", () => {
    const core = createYoyooCore();
    const out = core.handle({
      channel: "dingtalk",
      senderId: "u-admin",
      senderName: "Subai",
      conversationId: "g1",
      chatType: "group",
      text: "查一下部署文档",
      skills: ["qmd-local-search"],
      admins: ["u-admin"],
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-user",
    });

    expect(out.role).toBe("admin");
    expect(out.sessionKey).toBe("user:u-admin");
    expect(out.memoryNamespace).toBe("admin:u-admin");
    expect(out.retrievalHint).toBeTruthy();
    expect(out.normalized.channel).toBe("dingtalk");
  });
});

import { describe, expect, it } from "vitest";
import { simulateLocalMessage } from "../src/local-adapter";

describe("local adapter simulation", () => {
  it("simulates one group message end-to-end", () => {
    const out = simulateLocalMessage({
      channel: "dingtalk",
      senderId: "u-admin",
      senderName: "Subai",
      conversationId: "g-demo",
      chatType: "group",
      text: "查一下部署文档",
      skills: ["qmd-local-search"],
      admins: ["u-admin"],
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-user",
    });

    expect(out.role).toBe("admin");
    expect(out.sessionKey).toBe("user:u-admin");
    expect(out.retrievalHint).toBeTruthy();
    expect(out.normalized.conversation.id).toBe("g-demo");
  });

  it("simulates one direct message with isolated memory", () => {
    const out = simulateLocalMessage({
      senderId: "u-member",
      conversationId: "dm-1",
      chatType: "direct",
      text: "你好",
      admins: ["u-admin"],
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-group",
    });

    expect(out.role).toBe("member");
    expect(out.sessionKey).toBe("direct:u-member");
    expect(out.retrievalHint).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { preprocessClawInbound } from "../src/claw-bridge";

describe("claw bridge", () => {
  it("produces session key and retrieval hint for group admin", () => {
    const out = preprocessClawInbound({
      Body: "/admin status",
      SenderId: "u-admin",
      SenderName: "Subai",
      ChatType: "group",
      GroupSubject: "g-demo",
      Provider: "dingtalk",
      Skills: ["qmd-local-search"],
      Admins: ["u-admin"],
      MemoryBridgeMode: "user-global",
      GroupSessionScope: "per-user",
    });

    expect(out.role).toBe("admin");
    expect(out.sessionKey).toBe("user:u-admin");
    expect(out.retrievalHint).toBeTruthy();
    expect(out.bodyForModel).toContain("[检索规范]");
    expect(out.commandAllowed).toBe(true);
  });

  it("blocks admin command for member and keeps body unchanged when no qmd", () => {
    const out = preprocessClawInbound({
      Body: "/admin status",
      SenderId: "u-member",
      ChatType: "direct",
      Provider: "feishu",
      Skills: [],
      Admins: ["u-admin"],
      MemoryBridgeMode: "isolated",
      GroupSessionScope: "per-group",
    });

    expect(out.role).toBe("member");
    expect(out.sessionKey).toBe("direct:u-member");
    expect(out.retrievalHint).toBeNull();
    expect(out.bodyForModel).toBe("/admin status");
    expect(out.commandAllowed).toBe(false);
  });
});

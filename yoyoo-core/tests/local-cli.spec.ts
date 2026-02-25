import { describe, expect, it } from "vitest";
import { parseCliArgs, runLocalCli } from "../src/local-cli";

describe("local cli", () => {
  it("parses args with defaults", () => {
    const input = parseCliArgs([
      "--sender-id",
      "u1",
      "--conversation-id",
      "g1",
      "--text",
      "hello",
    ]);

    expect(input.channel).toBe("local-sim");
    expect(input.chatType).toBe("direct");
    expect(input.senderId).toBe("u1");
    expect(input.conversationId).toBe("g1");
    expect(input.text).toBe("hello");
  });

  it("parses skills/admins and runs simulation", () => {
    const outputs: string[] = [];
    const code = runLocalCli(
      [
        "--sender-id",
        "u-admin",
        "--conversation-id",
        "g-demo",
        "--chat-type",
        "group",
        "--text",
        "查一下部署文档",
        "--skills",
        "qmd-local-search,other",
        "--admins",
        "u-admin",
        "--memory-bridge-mode",
        "user-global",
        "--group-session-scope",
        "per-user",
      ],
      (line) => outputs.push(line),
    );

    expect(code).toBe(0);
    expect(outputs.length).toBeGreaterThan(0);
    const rendered = outputs.join("\n");
    expect(rendered).toContain("\"role\": \"admin\"");
    expect(rendered).toContain("\"sessionKey\": \"user:u-admin\"");
  });
});

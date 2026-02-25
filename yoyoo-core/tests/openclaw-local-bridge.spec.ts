import { describe, expect, it, vi } from "vitest";
import { createInMemoryMemoryBackend, createMemoryService } from "../src/memory-abstraction";
import { runOpenClawAgentViaCli, runYoyooOpenClawTurn } from "../src/openclaw-local-bridge";

describe("openclaw local bridge", () => {
  it("parses reply text from openclaw json payload", async () => {
    const execer = vi.fn(async () => ({
      stdout: JSON.stringify({
        result: {
          payloads: [{ text: "OK from openclaw" }],
        },
      }),
    }));

    const out = await runOpenClawAgentViaCli(
      {
        message: "hello",
      },
      execer,
    );

    expect(out.reply).toBe("OK from openclaw");
    expect(execer).toHaveBeenCalledWith(
      expect.arrayContaining(["agent", "--agent", "main", "--json"]),
    );
  });

  it("falls back to plain stdout when output is not json", async () => {
    const execer = vi.fn(async () => ({
      stdout: "plain reply text",
    }));

    const out = await runOpenClawAgentViaCli(
      {
        message: "hello",
      },
      execer,
    );

    expect(out.reply).toBe("plain reply text");
  });

  it("parses top-level payloads text", async () => {
    const execer = vi.fn(async () => ({
      stdout: JSON.stringify({
        payloads: [{ text: "top-level-ok" }],
      }),
    }));

    const out = await runOpenClawAgentViaCli(
      {
        message: "hello",
      },
      execer,
    );

    expect(out.reply).toBe("top-level-ok");
  });

  it("parses json payload even when plugin logs are prefixed", async () => {
    const execer = vi.fn(async () => ({
      stdout: [
        "[plugins] feishu_doc: Registered feishu_doc",
        "[plugins] feishu_wiki: Registered feishu_wiki tool",
        JSON.stringify({
          payloads: [{ text: "clean-ok" }],
        }),
      ].join("\n"),
    }));

    const out = await runOpenClawAgentViaCli(
      {
        message: "hello",
      },
      execer,
    );

    expect(out.reply).toBe("clean-ok");
  });

  it("passes session-id and thinking when provided", async () => {
    const execer = vi.fn(async () => ({
      stdout: JSON.stringify({
        result: {
          payloads: [{ text: "ok" }],
        },
      }),
    }));

    await runOpenClawAgentViaCli(
      {
        message: "hello",
        sessionId: "sess-001",
        thinking: "minimal",
        local: true,
      },
      execer,
    );

    expect(execer).toHaveBeenCalledWith(
      expect.arrayContaining(["--session-id", "sess-001", "--thinking", "minimal", "--local"]),
    );
  });

  it("passes extra environment variables when provided", async () => {
    const execer = vi.fn(async () => ({
      stdout: JSON.stringify({
        result: {
          payloads: [{ text: "ok" }],
        },
      }),
    }));

    await runOpenClawAgentViaCli(
      {
        message: "hello",
        extraEnv: {
          OPENCLAW_CONFIG_PATH: "/tmp/test-openclaw-config.json",
        },
        processTimeoutSeconds: 91,
      },
      execer,
    );

    expect(execer).toHaveBeenCalledWith(
      expect.arrayContaining(["agent", "--agent", "main"]),
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CONFIG_PATH: "/tmp/test-openclaw-config.json",
        }),
        timeoutMs: 91000,
      }),
    );
  });

  it("runs one full Yoyoo -> OpenClaw turn with memory context", async () => {
    const local = createInMemoryMemoryBackend("local");
    const memory = createMemoryService({
      backend: "local",
      adapters: { local },
    });
    await memory.append("admin:u-admin", "偏好：先给结论");

    const execer = vi.fn(async (args: string[]) => {
      expect(args).toContain("--message");
      const message = args[args.indexOf("--message") + 1] ?? "";
      expect(message).toContain("[记忆上下文]");
      expect(message).toContain("偏好：先给结论");
      return {
        stdout: JSON.stringify({
          result: {
            payloads: [{ text: "done" }],
          },
        }),
      };
    });

    const out = await runYoyooOpenClawTurn(
      {
        event: {
          body: "给我三步计划",
          senderId: "u-admin",
          conversationId: "g-test",
          chatType: "group",
          provider: "dingtalk",
        },
        options: {
          admins: ["u-admin"],
          memoryBridgeMode: "user-global",
          memory: {
            service: memory,
          },
        },
      },
      execer,
    );

    expect(out.blocked).toBe(false);
    expect(out.reply).toBe("done");
    expect(execer).toHaveBeenCalledTimes(1);
  });

  it("does not call openclaw for blocked commands", async () => {
    const execer = vi.fn(async () => ({
      stdout: JSON.stringify({
        result: {
          payloads: [{ text: "should-not-run" }],
        },
      }),
    }));

    const out = await runYoyooOpenClawTurn(
      {
        event: {
          body: "/admin status",
          senderId: "u-member",
          conversationId: "g-test",
          chatType: "group",
          provider: "dingtalk",
        },
        options: {
          admins: ["u-admin"],
        },
      },
      execer,
    );

    expect(out.blocked).toBe(true);
    expect(execer).not.toHaveBeenCalled();
  });
});

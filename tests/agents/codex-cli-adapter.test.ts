/** @vitest-environment node */

import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { collectAgentEvents, type AgentRunRequest } from "@/agents/contract";
import {
  CodexCliAdapter,
  CodexCliFailure,
  CodexCliProcessRunner,
  buildCodexExecArgs,
  parseCodexJsonl,
  sanitizedCodexEnvironment,
  type CodexCliRunner,
} from "@/agents/codex-cli-adapter";

let fixtureDirectory = "";
let fixtureCommand = "";

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "yoyoo-codex-test-"));
  fixtureCommand = join(fixtureDirectory, "fake-codex.mjs");
  await writeFile(
    fixtureCommand,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "login" && args[1] === "status") {
  process.stdout.write("Logged in using ChatGPT\\n");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (prompt.includes("PROCESS_FAIL")) {
  process.stderr.write("private-token-must-not-leak\\n");
  process.exit(2);
}
if (prompt.includes("OUTPUT_CAP")) {
  process.stdout.write("x".repeat(20000));
  process.exit(0);
}
const emitReply = () => {
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "来自独立进程的回复" },
  }) + "\\n");
};
if (prompt.includes("TEST_TIMEOUT")) setTimeout(emitReply, 1500);
else emitReply();
`,
    "utf8",
  );
  await chmod(fixtureCommand, 0o755);
});

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

function roomRequest(message = "请给出一个简短建议"): AgentRunRequest {
  const humanId = randomUUID();
  const codexId = randomUUID();
  return {
    runId: randomUUID(),
    workspaceId: randomUUID(),
    roomId: randomUUID(),
    triggerMessageId: randomUUID(),
    triggerType: "message",
    message,
    sender: {
      principalId: humanId,
      kind: "human",
      displayName: "Su Bai",
    },
    members: [
      {
        principalId: humanId,
        kind: "human",
        displayName: "Su Bai",
        listenerPolicy: "always",
      },
      {
        principalId: codexId,
        kind: "agent",
        displayName: "Codex",
        listenerPolicy: "mention_only",
      },
    ],
    mentionedPrincipalIds: [codexId],
    history: [
      {
        messageId: randomUUID(),
        senderPrincipalId: randomUUID(),
        senderKind: "agent",
        senderDisplayName: "YOS",
        content: "上一轮结论是先完成灰度发布。",
      },
    ],
    replyTo: null,
    threadRoot: null,
  };
}

function runner(overrides: Partial<CodexCliRunner> = {}): CodexCliRunner {
  return {
    health: vi.fn(async () => undefined),
    execute: vi.fn(async () => "Codex 的真实回复"),
    ...overrides,
  };
}

describe("CodexCliAdapter", () => {
  it("declares only the capabilities proven by the CLI boundary", () => {
    const adapter = new CodexCliAdapter({ runner: runner() });

    expect(adapter.descriptor).toMatchObject({
      id: "codex-cli",
      displayName: "Codex",
      capabilities: {
        streaming: false,
        cancellation: false,
        delegation: false,
        artifacts: false,
      },
    });
  });

  it("converts one constrained Codex final message into ordered Agent events", async () => {
    const fakeRunner = runner();
    const adapter = new CodexCliAdapter({ runner: fakeRunner });
    const request = roomRequest("同时分析这个发布风险");

    const events = await collectAgentEvents(
      adapter.run(request, new AbortController().signal),
    );

    expect(fakeRunner.execute).toHaveBeenCalledWith(
      expect.stringContaining("同时分析这个发布风险"),
      expect.any(AbortSignal),
    );
    const prompt = vi.mocked(fakeRunner.execute).mock.calls[0][0];
    expect(prompt).toContain("Recent public room history");
    expect(prompt).toContain("YOS (agent): 上一轮结论是先完成灰度发布。");
    expect(prompt.indexOf("上一轮结论")).toBeLessThan(prompt.indexOf("同时分析这个发布风险"));
    expect(events).toEqual([
      { sequence: 1, type: "status", status: "running" },
      { sequence: 2, type: "status", status: "thinking" },
      { sequence: 3, type: "text_delta", delta: "Codex 的真实回复" },
      { sequence: 4, type: "completed", text: "Codex 的真实回复" },
    ]);
  });

  it("turns private runner failures into sanitized retryable Agent failures", async () => {
    const fakeRunner = runner({
      execute: vi.fn(async () => {
        throw new CodexCliFailure(
          "CODEX_TIMEOUT",
          "Codex did not respond before the configured timeout",
          true,
        );
      }),
    });
    const adapter = new CodexCliAdapter({ runner: fakeRunner });

    const events = await collectAgentEvents(
      adapter.run(roomRequest(), new AbortController().signal),
    );

    expect(events.at(-1)).toEqual({
      sequence: 3,
      type: "failed",
      error: {
        code: "CODEX_TIMEOUT",
        message: "Codex did not respond before the configured timeout",
        retriable: true,
      },
    });
  });

  it("reports unavailable health without exposing process output", async () => {
    const adapter = new CodexCliAdapter({
      runner: runner({
        health: vi.fn(async () => {
          throw new Error("secret stderr from credential store");
        }),
      }),
    });

    await expect(adapter.health()).resolves.toEqual({
      status: "unavailable",
      message: "Codex CLI is unavailable or not authenticated",
    });
  });
});

describe("Codex CLI process boundary", () => {
  it("keeps room content out of argv and locks down the Codex session", () => {
    const args = buildCodexExecArgs("/private/tmp/yoyoo-codex");

    expect(args).toEqual(expect.arrayContaining([
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--strict-config",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "-C",
      "/private/tmp/yoyoo-codex",
      "-",
    ]));
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.apps=false");
    expect(args).toContain("features.multi_agent=false");
    expect(args.join(" ")).not.toContain("room message");
  });

  it("does not forward unrelated server credentials to the Codex process", () => {
    const environment = sanitizedCodexEnvironment({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      CODEX_HOME: "/Users/test/.codex",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      DATABASE_URL: "postgresql://secret",
      YOS_WEB_PASSWORD: "secret-password",
      OPENAI_API_KEY: "must-not-be-forwarded",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      CODEX_HOME: "/Users/test/.codex",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_COLOR: "1",
    });
  });

  it("returns the last public Agent message from Codex JSONL", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "warning", type: "error", message: "retrying" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text: "最终公开回复" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ].join("\n");

    expect(parseCodexJsonl(stdout)).toBe("最终公开回复");
  });

  it("rejects malformed output or a missing final Agent message", () => {
    expect(() => parseCodexJsonl("not-json")).toThrow(CodexCliFailure);
    expect(() => parseCodexJsonl(JSON.stringify({ type: "turn.completed" }))).toThrow(
      "Codex CLI did not return a final Agent message",
    );
  });

  it("executes the CLI through stdin and reads its structured final reply", async () => {
    const processRunner = new CodexCliProcessRunner({
      command: fixtureCommand,
      cwd: fixtureDirectory,
      environment: process.env,
    });

    await expect(processRunner.health()).resolves.toBeUndefined();
    await expect(
      processRunner.execute("NORMAL_RUN", new AbortController().signal),
    ).resolves.toBe("来自独立进程的回复");
  });

  it("sanitizes process failures and stops runs that exceed their limits", async () => {
    const processRunner = new CodexCliProcessRunner({
      command: fixtureCommand,
      cwd: fixtureDirectory,
      timeoutMs: 1_000,
      maxOutputBytes: 16_384,
      environment: process.env,
    });

    await expect(
      processRunner.execute("PROCESS_FAIL", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "CODEX_PROCESS_FAILED",
      message: "Codex CLI could not complete this run",
    });
    await expect(
      processRunner.execute("OUTPUT_CAP", new AbortController().signal),
    ).rejects.toMatchObject({ code: "CODEX_OUTPUT_TOO_LARGE" });
    await expect(
      processRunner.execute("TEST_TIMEOUT", new AbortController().signal),
    ).rejects.toMatchObject({ code: "CODEX_TIMEOUT" });
  });
});

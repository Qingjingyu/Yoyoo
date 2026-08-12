/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { YosWebConsoleAdapter } from "@/agents/yos-adapter";
import { CodexCliAdapter } from "@/agents/codex-cli-adapter";
import {
  createCodexCliAdapter,
  createCollaborationAgentSeeds,
  createConfiguredAgentAdapter,
} from "@/server/runtime";

describe("runtime Agent selection", () => {
  it("keeps the deterministic Agent as the explicit development default", () => {
    const adapter = createConfiguredAgentAdapter({});

    expect(adapter.descriptor.id).toBe("yoyoo-test-agent");
    expect(adapter.descriptor.displayName).toBe("Yoyoo Test Agent");
  });

  it("selects the non-streaming YOS Web Console adapter from environment", () => {
    const adapter = createConfiguredAgentAdapter({
      YOYOO_AGENT_ADAPTER: "yos-web-console",
      YOS_WEB_CONSOLE_URL: "http://127.0.0.1:3457",
      YOS_WEB_PASSWORD: "server-only-secret",
      YOS_RESPONSE_TIMEOUT_MS: "90000",
      YOS_POLL_INTERVAL_MS: "250",
    });

    expect(adapter).toBeInstanceOf(YosWebConsoleAdapter);
    expect(adapter.descriptor.id).toBe("yos-web-console");
    expect(adapter.descriptor.capabilities).toEqual({
      streaming: false,
      cancellation: false,
    });
  });

  it("uses the local YOS Web Console port when an explicit URL is absent", () => {
    const adapter = createConfiguredAgentAdapter({
      YOYOO_AGENT_ADAPTER: "yos-web-console",
      WEB_CONSOLE_PORT: "3457",
      YOS_WEB_PASSWORD: "server-only-secret",
    });

    expect(adapter).toBeInstanceOf(YosWebConsoleAdapter);
  });

  it("rejects an incomplete or unknown adapter configuration", () => {
    expect(() => createConfiguredAgentAdapter({
      YOYOO_AGENT_ADAPTER: "yos-web-console",
    })).toThrow("YOS_WEB_CONSOLE_URL is required");

    expect(() => createConfiguredAgentAdapter({
      YOYOO_AGENT_ADAPTER: "not-real",
    })).toThrow("Unsupported YOYOO_AGENT_ADAPTER: not-real");
  });

  it("keeps three stable room members while replacing Reviewer with YOS", () => {
    const localSeeds = createCollaborationAgentSeeds(createConfiguredAgentAdapter({}));
    const yosAdapter = createConfiguredAgentAdapter({
      YOYOO_AGENT_ADAPTER: "yos-web-console",
      YOS_WEB_CONSOLE_URL: "http://127.0.0.1:3457",
      YOS_WEB_PASSWORD: "server-only-secret",
    });
    const codexAdapter = createCodexCliAdapter({});
    const yosSeeds = createCollaborationAgentSeeds(yosAdapter, codexAdapter);

    expect(localSeeds).toHaveLength(3);
    expect(localSeeds[2]).toMatchObject({
      adapterId: "yoyoo-local-reviewer",
      displayName: "Local Reviewer",
      externalKey: "agent:yoyoo-local-reviewer",
    });
    expect(yosSeeds).toHaveLength(3);
    expect(yosSeeds[0]).toMatchObject({
      adapterId: "codex-cli",
      displayName: "Codex",
      externalKey: "agent:yoyoo-local-planner",
      capabilities: {
        streaming: false,
        cancellation: false,
      },
    });
    expect(yosSeeds[2]).toMatchObject({
      adapterId: "yos-web-console",
      displayName: "YOS",
      externalKey: "agent:yoyoo-local-reviewer",
      capabilities: {
        streaming: false,
        cancellation: false,
      },
    });
  });

  it("does not seed built-in demo Agents when they are disabled", () => {
    const seeds = createCollaborationAgentSeeds(
      createConfiguredAgentAdapter({}),
      undefined,
      { YOYOO_BUILTIN_AGENTS: "none" },
    );

    expect(seeds).toEqual([]);
  });

  it("rejects an unknown built-in Agent mode", () => {
    expect(() => createCollaborationAgentSeeds(
      createConfiguredAgentAdapter({}),
      undefined,
      { YOYOO_BUILTIN_AGENTS: "typo" },
    )).toThrow("Unsupported YOYOO_BUILTIN_AGENTS: typo");
  });

  it("creates the real Codex CLI adapter without requiring an API key", () => {
    const adapter = createCodexCliAdapter({
      YOYOO_CODEX_COMMAND: "/opt/openai/bin/codex",
      YOYOO_CODEX_TIMEOUT_MS: "90000",
    });

    expect(adapter).toBeInstanceOf(CodexCliAdapter);
    expect(adapter.descriptor.id).toBe("codex-cli");
  });
});

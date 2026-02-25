import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import register, {
  parseTeamCommand,
  parseTeamDispatchTargets,
  parseTeamNaturalCommand,
} from "../plugins/yoyoo-autobridge/index";

describe("yoyoo-autobridge plugin", () => {
  it("registers before_prompt_build and returns prepend context", async () => {
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {
        admins: ["u-admin"],
        skills: ["qmd-local-search"],
        memoryBridgeMode: "user-global",
        groupSessionScope: "per-user",
      },
      config: {},
      logger: {},
      on: (hookName: string, handler: (event: any, ctx: any) => unknown) => {
        handlers.set(hookName, handler);
      },
    } as any);

    const hook = handlers.get("before_prompt_build");
    expect(hook).toBeTypeOf("function");

    const out = await hook?.(
      {
        prompt: "查部署文档",
        messages: [],
      },
      {
        sessionKey: "group:g1:user:u-admin",
        messageProvider: "dingtalk",
      },
    );

    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("[Yoyoo桥接上下文]"),
      }),
    );
  });

  it("registers agent_end and writes summary into shared-memory log", async () => {
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-plugin-"));

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {
        sharedMemoryRoot: root,
      },
      config: {},
      logger: {},
      on: (hookName: string, handler: (event: any, ctx: any) => unknown) => {
        handlers.set(hookName, handler);
      },
    } as any);

    const hook = handlers.get("agent_end");
    expect(hook).toBeTypeOf("function");

    await hook?.(
      {
        success: true,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "修好了 webhook 超时，已验证通过。" }],
          },
        ],
      },
      {
        agentId: "coder",
      },
    );

    const logText = await readFile(path.join(root, "shared-memory/cross-agent-log.md"), "utf8");
    expect(logText).toContain("[coder]");
    expect(logText).toContain("webhook 超时");
  });

  it("parses /team command with explicit roles", () => {
    const parsed = parseTeamCommand("/team [coder,writer] 做一个发版计划");
    expect(parsed).toEqual({
      objective: "做一个发版计划",
      roles: ["coder", "writer"],
      dispatchTargets: [],
    });
  });

  it("parses dispatch target list", () => {
    const targets = parseTeamDispatchTargets("feishu:ou_1;telegram@default:@channel,discord:channel:123");
    expect(targets).toEqual([
      {
        channel: "feishu",
        target: "ou_1",
      },
      {
        channel: "telegram",
        account: "default",
        target: "@channel",
      },
      {
        channel: "discord",
        target: "channel:123",
      },
    ]);
  });

  it("parses team command without slash", () => {
    const parsed = parseTeamCommand("team coder,writer :: 做一个发版计划");
    expect(parsed).toEqual({
      objective: "做一个发版计划",
      roles: ["coder", "writer"],
      dispatchTargets: [],
    });
  });

  it("parses /team when wrapped by extra text", () => {
    const parsed = parseTeamCommand("用户输入如下：/team [coder,writer] 做一个发版计划");
    expect(parsed).toEqual({
      objective: "做一个发版计划",
      roles: ["coder", "writer"],
      dispatchTargets: [],
    });
  });

  it("parses /team with --send targets", () => {
    const parsed = parseTeamCommand("/team [coder,writer] 做一个发版计划 --send feishu:ou_1;telegram:@abc");
    expect(parsed).toEqual({
      objective: "做一个发版计划",
      roles: ["coder", "writer"],
      dispatchTargets: [
        { channel: "feishu", target: "ou_1" },
        { channel: "telegram", target: "@abc" },
      ],
    });
  });

  it("parses natural team command from CEO message", () => {
    const parsed = parseTeamNaturalCommand("CEO，帮我问 coder/writer/growth 各自进度并汇总给我");
    expect(parsed).toEqual({
      objective: "CEO，帮我问 coder/writer/growth 各自进度并汇总给我",
      roles: ["coder", "writer", "growth"],
      dispatchTargets: [],
    });
  });

  it("parses natural team command with all-role intent", () => {
    const parsed = parseTeamNaturalCommand("CEO，帮我汇总一下所有角色的最新状态");
    expect(parsed).toEqual({
      objective: "CEO，帮我汇总一下所有角色的最新状态",
      roles: ["coder", "writer", "growth", "legal", "finance", "teacher"],
      dispatchTargets: [],
    });
  });

  it("builds team command context via custom runner", async () => {
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-team-cmd-"));
    const reportDir = path.join(root, "reports");

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {
        admins: ["u-admin"],
        teamReportDir: reportDir,
        teamCommandRunner: async ({ objective, roles }) => ({
          objective,
          roles,
          results: roles.map((role) => ({
            role,
            prompt: "mock-prompt",
            reply: `${role}-ok`,
            ok: true,
          })),
          mergedReport: "mock-merged-report",
        }),
      },
      config: {},
      logger: {},
      on: (hookName: string, handler: (event: any, ctx: any) => unknown) => {
        handlers.set(hookName, handler);
      },
    } as any);

    const hook = handlers.get("before_prompt_build");
    expect(hook).toBeTypeOf("function");

    const out = await hook?.(
      {
        prompt: "/team [coder,writer] 做一个发版计划",
        messages: [],
      },
      {
        sessionKey: "group:g1:user:u-admin",
        messageProvider: "dingtalk",
        agentId: "main",
      },
    );

    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("Yoyoo Team 协作结果"),
      }),
    );
    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("coder-ok"),
      }),
    );
  });

  it("returns partial team result when runner times out after some roles finished", async () => {
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-team-timeout-"));

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {
        admins: ["u-admin"],
        teamRunnerTimeoutSeconds: 1,
        teamReportDir: path.join(root, "reports"),
        teamCommandRunner: async ({ objective, roles, onRoleResult }) => {
          await onRoleResult?.(
            {
              role: "coder",
              prompt: "mock",
              reply: "coder-done",
              ok: true,
            },
            0,
          );
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return {
            objective,
            roles,
            results: [],
            mergedReport: "",
          };
        },
      },
      config: {},
      logger: {},
      on: (hookName: string, handler: (event: any, ctx: any) => unknown) => {
        handlers.set(hookName, handler);
      },
    } as any);

    const hook = handlers.get("before_prompt_build");
    expect(hook).toBeTypeOf("function");

    const out = await hook?.(
      {
        prompt: "/team [coder,writer] 做一次超时回归",
        messages: [],
      },
      {
        sessionKey: "group:g1:user:u-admin",
        messageProvider: "dingtalk",
        agentId: "main",
      },
    );

    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("部分完成"),
      }),
    );
    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("coder-done"),
      }),
    );
    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("pending"),
      }),
    );
  });
});

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runOpenMock = vi.fn(async () => ({
  reply: "ok",
  raw: {},
  stdout: "",
}));

vi.mock("../src/openclaw-local-bridge.ts", () => ({
  runOpenClawAgentViaCli: runOpenMock,
}));

describe("yoyoo-autobridge /team worker config", () => {
  const oldHome = process.env.HOME;
  const oldOpenClawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

  afterEach(() => {
    runOpenMock.mockClear();
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    if (oldOpenClawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = oldOpenClawConfigPath;
    }
  });

  it("builds builtin worker config and passes OPENCLAW_CONFIG_PATH to team agents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-team-worker-"));
    const home = path.join(root, "home");
    const openclawRoot = path.join(home, ".openclaw");
    const sourceConfigPath = path.join(openclawRoot, "openclaw.json");
    const expectedWorkerConfigPath = path.join(openclawRoot, "openclaw.yoyoo-team-worker.json");

    await mkdir(openclawRoot, { recursive: true });
    await writeFile(
      sourceConfigPath,
      JSON.stringify(
        {
          memory: {
            backend: "qmd",
            qmd: {
              update: {
                onBoot: true,
                waitForBootSync: true,
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.HOME = home;
    delete process.env.OPENCLAW_CONFIG_PATH;

    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    const { default: register } = await import("../plugins/yoyoo-autobridge/index");

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {
        teamRoleTimeoutSeconds: 150,
      },
      config: {},
      logger: {},
      on: (hookName: string, handler: (event: any, ctx: any) => unknown) => {
        handlers.set(hookName, handler);
      },
    } as any);

    const hook = handlers.get("before_prompt_build");
    expect(hook).toBeTypeOf("function");

    await hook?.(
      {
        prompt: "/team [coder] 做一个发版计划",
        messages: [],
      },
      {
        sessionKey: "group:g1:user:u-admin",
        messageProvider: "dingtalk",
        agentId: "main",
      },
    );

    expect(runOpenMock).toHaveBeenCalledTimes(1);
    expect(runOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "coder",
        timeoutSeconds: 150,
        extraEnv: expect.objectContaining({
          OPENCLAW_CONFIG_PATH: expectedWorkerConfigPath,
        }),
      }),
    );

    const workerRaw = await readFile(expectedWorkerConfigPath, "utf8");
    const workerConfig = JSON.parse(workerRaw);
    expect(workerConfig.memory.backend).toBe("builtin");
    expect(workerConfig.memory.qmd.update.onBoot).toBe(false);
    expect(workerConfig.memory.qmd.update.waitForBootSync).toBe(false);
  });

  it("returns usage for empty /team command without calling runner", async () => {
    const handlers = new Map<string, (event: any, ctx: any) => unknown>();
    const { default: register } = await import("../plugins/yoyoo-autobridge/index");

    register({
      id: "yoyoo-autobridge",
      pluginConfig: {},
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
        prompt: "/team",
        messages: [],
      },
      {
        sessionKey: "group:g1:user:u-admin",
        messageProvider: "dingtalk",
        agentId: "main",
      },
    );

    expect(runOpenMock).not.toHaveBeenCalled();
    expect(out).toEqual(
      expect.objectContaining({
        prependContext: expect.stringContaining("用法：/team <目标>"),
      }),
    );
  });
});

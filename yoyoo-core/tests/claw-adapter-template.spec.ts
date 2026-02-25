import { describe, expect, it, vi } from "vitest";
import { handleClawInboundWithYoyoo } from "../src/claw-adapter-template";
import { createInMemoryMemoryBackend, createMemoryService } from "../src/memory-abstraction";

describe("claw adapter template", () => {
  it("blocks admin command for non-admin sender", async () => {
    const runClawAgent = vi.fn(async () => "should-not-run");

    const result = await handleClawInboundWithYoyoo(
      {
        body: "/admin status",
        senderId: "u-member",
        conversationId: "g-1",
        chatType: "group",
        provider: "dingtalk",
      },
      {
        admins: ["u-admin"],
        runClawAgent,
      },
    );

    expect(result.blocked).toBe(true);
    expect(result.reply).toContain("没有权限");
    expect(runClawAgent).not.toHaveBeenCalled();
  });

  it("passes session key and retrieval hint body to claw runtime", async () => {
    const runClawAgent = vi.fn(async () => "ok");

    const result = await handleClawInboundWithYoyoo(
      {
        body: "查部署文档",
        senderId: "u-admin",
        senderName: "Subai",
        conversationId: "g-1",
        chatType: "group",
        provider: "dingtalk",
      },
      {
        admins: ["u-admin"],
        skills: ["qmd-local-search"],
        memoryBridgeMode: "user-global",
        groupSessionScope: "per-user",
        runClawAgent,
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.bridge.sessionKey).toBe("user:u-admin");
    expect(result.bridge.bodyForModel).toContain("[检索规范]");
    expect(runClawAgent).toHaveBeenCalledWith({
      sessionKey: "user:u-admin",
      body: expect.stringContaining("查部署文档"),
      role: "admin",
    });
  });

  it("injects memory context and persists new turn when memory is enabled", async () => {
    const local = createInMemoryMemoryBackend("local");
    const memory = createMemoryService({
      backend: "local",
      adapters: { local },
    });
    await memory.append("admin:u-admin", "历史偏好：回答要简短");

    const runClawAgent = vi.fn(async () => "这是本轮回答");

    const result = await handleClawInboundWithYoyoo(
      {
        body: "给我一个三步计划",
        senderId: "u-admin",
        conversationId: "g-2",
        chatType: "group",
        provider: "dingtalk",
      },
      {
        admins: ["u-admin"],
        memoryBridgeMode: "user-global",
        runClawAgent,
        memory: {
          service: memory,
          maxRecall: 5,
        },
      },
    );

    expect(result.blocked).toBe(false);
    expect(runClawAgent).toHaveBeenCalledWith({
      sessionKey: "user:u-admin",
      role: "admin",
      body: expect.stringContaining("历史偏好：回答要简短"),
    });

    const stored = await memory.list("admin:u-admin");
    expect(stored.some((x) => x.text.includes("user: 给我一个三步计划"))).toBe(true);
    expect(stored.some((x) => x.text.includes("assistant: 这是本轮回答"))).toBe(true);
  });

  it("keeps main reply path alive when memory backend fails", async () => {
    const runClawAgent = vi.fn(async () => "ok-without-memory");

    const result = await handleClawInboundWithYoyoo(
      {
        body: "你好",
        senderId: "u-member",
        conversationId: "dm-2",
        chatType: "direct",
        provider: "feishu",
      },
      {
        admins: ["u-admin"],
        runClawAgent,
        memory: {
          service: {
            backendKind: () => "broken",
            list: async () => {
              throw new Error("memory list failed");
            },
            append: async () => {
              throw new Error("memory append failed");
            },
          },
        },
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.reply).toBe("ok-without-memory");
    expect(runClawAgent).toHaveBeenCalledTimes(1);
  });
});

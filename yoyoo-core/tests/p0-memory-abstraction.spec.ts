import { describe, expect, it } from "vitest";
import {
  buildMemoryNamespace,
  createInMemoryMemoryBackend,
  createMemoryService,
} from "../src/memory-abstraction";

describe("p0 memory abstraction", () => {
  it("separates admin memory from member memory", () => {
    const adminNs = buildMemoryNamespace({
      channel: "dingtalk",
      chatType: "direct",
      conversationId: "dm-1",
      senderId: "u1",
      role: "admin",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });
    const memberNs = buildMemoryNamespace({
      channel: "dingtalk",
      chatType: "direct",
      conversationId: "dm-1",
      senderId: "u1",
      role: "member",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });

    expect(adminNs).toBe("admin:u1");
    expect(memberNs).toBe("direct:dingtalk:u1");
  });

  it("supports per-user and per-group isolation in group chat", () => {
    const perUserU1 = buildMemoryNamespace({
      channel: "feishu",
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      role: "member",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });
    const perUserU2 = buildMemoryNamespace({
      channel: "feishu",
      chatType: "group",
      conversationId: "g1",
      senderId: "u2",
      role: "member",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });
    const perGroup = buildMemoryNamespace({
      channel: "feishu",
      chatType: "group",
      conversationId: "g1",
      senderId: "u2",
      role: "member",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-group",
    });

    expect(perUserU1).toBe("group:feishu:g1:user:u1");
    expect(perUserU2).toBe("group:feishu:g1:user:u2");
    expect(perGroup).toBe("group:feishu:g1");
  });

  it("supports user-global memory bridge across direct and group", () => {
    const direct = buildMemoryNamespace({
      channel: "dingtalk",
      chatType: "direct",
      conversationId: "dm1",
      senderId: "u9",
      role: "member",
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-user",
    });
    const group = buildMemoryNamespace({
      channel: "dingtalk",
      chatType: "group",
      conversationId: "g2",
      senderId: "u9",
      role: "member",
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-group",
    });

    expect(direct).toBe("user:u9");
    expect(group).toBe("user:u9");
  });

  it("switches backend without changing memory API behavior", async () => {
    const local = createInMemoryMemoryBackend("local");
    const memu = createInMemoryMemoryBackend("memu");
    const service = createMemoryService({
      backend: "memu",
      adapters: {
        local,
        memu,
      },
    });

    await service.append("user:u1", "hello");
    await service.append("user:u1", "world");
    const out = await service.list("user:u1");

    expect(service.backendKind()).toBe("memu");
    expect(out.map((x) => x.text)).toEqual(["hello", "world"]);
  });

  it("falls back to local backend when target backend is not connected", async () => {
    const local = createInMemoryMemoryBackend("local");
    const service = createMemoryService({
      backend: "letta",
      adapters: {
        local,
      },
    });

    await service.append("user:u2", "fallback-memory");
    const out = await service.list("user:u2");

    expect(service.backendKind()).toBe("local");
    expect(out[0]?.text).toBe("fallback-memory");
  });
});

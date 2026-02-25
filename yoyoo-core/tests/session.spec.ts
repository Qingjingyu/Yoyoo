import { describe, expect, it } from "vitest";
import { buildSessionKey } from "../src/session";

describe("buildSessionKey", () => {
  it("supports isolated mode with per-group scope", () => {
    const key = buildSessionKey({
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-group",
    });

    expect(key).toBe("group:g1");
  });

  it("supports isolated mode with per-user scope", () => {
    const key = buildSessionKey({
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });

    expect(key).toBe("group:g1:user:u1");
  });

  it("supports user-global bridge", () => {
    const key = buildSessionKey({
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-user",
    });

    expect(key).toBe("user:u1");
  });

  it("direct chat always maps to direct:user", () => {
    const key = buildSessionKey({
      chatType: "direct",
      conversationId: "dm1",
      senderId: "u2",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-group",
    });

    expect(key).toBe("direct:u2");
  });

  it("adds channel namespace in isolated mode to avoid cross-channel collision", () => {
    const feishu = buildSessionKey({
      channel: "feishu",
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });

    const dingtalk = buildSessionKey({
      channel: "dingtalk",
      chatType: "group",
      conversationId: "g1",
      senderId: "u1",
      memoryBridgeMode: "isolated",
      groupSessionScope: "per-user",
    });

    expect(feishu).toBe("group:feishu:g1:user:u1");
    expect(dingtalk).toBe("group:dingtalk:g1:user:u1");
  });

  it("keeps user-global key cross-channel shared", () => {
    const feishu = buildSessionKey({
      channel: "feishu",
      chatType: "direct",
      conversationId: "dm1",
      senderId: "u9",
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-user",
    });

    const dingtalk = buildSessionKey({
      channel: "dingtalk",
      chatType: "group",
      conversationId: "g2",
      senderId: "u9",
      memoryBridgeMode: "user-global",
      groupSessionScope: "per-group",
    });

    expect(feishu).toBe("user:u9");
    expect(dingtalk).toBe("user:u9");
  });
});

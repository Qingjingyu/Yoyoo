import { describe, expect, it } from "vitest";
import { normalizeInbound } from "../src/normalize";

describe("normalizeInbound", () => {
  it("normalizes dingtalk-like payload to unified shape", () => {
    const out = normalizeInbound({
      channel: "dingtalk",
      senderId: "u1",
      senderName: "Subai",
      conversationId: "g1",
      text: "hi",
      chatType: "group",
    });

    expect(out.channel).toBe("dingtalk");
    expect(out.sender.id).toBe("u1");
    expect(out.sender.name).toBe("Subai");
    expect(out.conversation.id).toBe("g1");
    expect(out.conversation.chatType).toBe("group");
    expect(out.message.text).toBe("hi");
  });

  it("maps p2p to direct", () => {
    const out = normalizeInbound({
      channel: "feishu",
      senderId: "u2",
      conversationId: "dm1",
      text: "hello",
      chatType: "p2p",
    });

    expect(out.conversation.chatType).toBe("direct");
  });

  it("throws on invalid payload", () => {
    expect(() =>
      normalizeInbound({
        channel: "dingtalk",
        senderId: "",
        conversationId: "g1",
        text: "hi",
        chatType: "group",
      }),
    ).toThrowError();
  });
});

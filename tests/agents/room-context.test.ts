import { describe, expect, it } from "vitest";

import {
  MAX_ROOM_CONTEXT_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGES,
  selectRecentRoomContext,
} from "@/agents/room-context";

function entry(index: number, content = `消息 ${index}`) {
  return {
    messageId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    senderPrincipalId: "20000000-0000-4000-8000-000000000001",
    senderKind: index % 2 === 0 ? "agent" as const : "human" as const,
    senderDisplayName: index % 2 === 0 ? "YOS" : "Su Bai",
    content,
  };
}

describe("recent room context selection", () => {
  it("keeps the newest bounded messages in chronological order", () => {
    const candidates = Array.from(
      { length: MAX_ROOM_CONTEXT_MESSAGES + 4 },
      (_, index) => entry(index + 1),
    );

    const selected = selectRecentRoomContext(candidates);

    expect(selected).toHaveLength(MAX_ROOM_CONTEXT_MESSAGES);
    expect(selected[0].content).toBe("消息 5");
    expect(selected.at(-1)?.content).toBe(`消息 ${MAX_ROOM_CONTEXT_MESSAGES + 4}`);
  });

  it("enforces per-message and aggregate character budgets from newest backward", () => {
    const selected = selectRecentRoomContext([
      entry(1, "A".repeat(MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS)),
      entry(2, "B".repeat(MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS + 500)),
      entry(3, "C".repeat(MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS)),
    ]);

    expect(selected.map((message) => message.content.length)).toEqual([
      MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS,
      MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS,
    ]);
    expect(selected.reduce((total, message) => total + message.content.length, 0))
      .toBe(MAX_ROOM_CONTEXT_CHARACTERS);
    expect(selected.map((message) => message.senderDisplayName)).toEqual(["YOS", "Su Bai"]);
  });

  it("accepts an empty room history", () => {
    expect(selectRecentRoomContext([])).toEqual([]);
  });
});

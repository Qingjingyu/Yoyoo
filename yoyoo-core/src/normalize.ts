import { InboundInputSchema, NormalizedInboundSchema, type NormalizedInbound } from "./schema";

export function normalizeInbound(input: unknown): NormalizedInbound {
  const parsed = InboundInputSchema.parse(input);
  const chatType = parsed.chatType === "group" ? "group" : "direct";

  const normalized = {
    channel: parsed.channel.trim().toLowerCase(),
    sender: {
      id: parsed.senderId.trim(),
      name: parsed.senderName?.trim() || undefined,
    },
    conversation: {
      id: parsed.conversationId.trim(),
      chatType,
    },
    message: {
      text: parsed.text,
    },
  };

  return NormalizedInboundSchema.parse(normalized);
}

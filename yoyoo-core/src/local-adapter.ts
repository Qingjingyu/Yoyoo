import { createYoyooCore } from "./index";
import type { GroupSessionScope, MemoryBridgeMode } from "./session";

export interface LocalSimInput {
  channel?: string;
  senderId: string;
  senderName?: string;
  conversationId: string;
  chatType: "group" | "direct" | "p2p";
  text: string;
  skills?: string[];
  admins?: string[];
  memoryBridgeMode?: MemoryBridgeMode;
  groupSessionScope?: GroupSessionScope;
}

export function simulateLocalMessage(input: LocalSimInput) {
  const core = createYoyooCore();
  return core.handle({
    channel: input.channel ?? "local-sim",
    senderId: input.senderId,
    senderName: input.senderName,
    conversationId: input.conversationId,
    chatType: input.chatType,
    text: input.text,
    skills: input.skills ?? [],
    admins: input.admins ?? [],
    memoryBridgeMode: input.memoryBridgeMode ?? "isolated",
    groupSessionScope: input.groupSessionScope ?? "per-group",
  });
}

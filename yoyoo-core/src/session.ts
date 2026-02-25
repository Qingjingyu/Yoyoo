export type ChatType = "group" | "direct";
export type MemoryBridgeMode = "isolated" | "user-global";
export type GroupSessionScope = "per-group" | "per-user";

export interface SessionKeyInput {
  channel?: string;
  chatType: ChatType;
  conversationId: string;
  senderId: string;
  memoryBridgeMode?: MemoryBridgeMode;
  groupSessionScope?: GroupSessionScope;
}

export function buildSessionKey(input: SessionKeyInput): string {
  const bridgeMode = input.memoryBridgeMode ?? "isolated";
  const groupScope = input.groupSessionScope ?? "per-group";
  const senderId = input.senderId.trim();
  const conversationId = input.conversationId.trim();
  const channel = (input.channel ?? "").trim().toLowerCase();

  if (bridgeMode === "user-global") {
    return `user:${senderId}`;
  }

  if (input.chatType === "direct") {
    return `direct:${senderId}`;
  }

  if (groupScope === "per-user") {
    if (channel) {
      return `group:${channel}:${conversationId}:user:${senderId}`;
    }
    return `group:${conversationId}:user:${senderId}`;
  }

  if (channel) {
    return `group:${channel}:${conversationId}`;
  }
  return `group:${conversationId}`;
}

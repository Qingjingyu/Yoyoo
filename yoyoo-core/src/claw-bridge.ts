import { canExecuteCommand } from "./identity";
import { handleInbound, type OrchestratorOutput } from "./orchestrator";
import type { GroupSessionScope, MemoryBridgeMode } from "./session";

export interface ClawInboundLike {
  Body: string;
  SenderId: string;
  SenderName?: string;
  ChatType?: "group" | "direct" | "p2p" | string;
  GroupSubject?: string;
  Provider?: string;
  Skills?: string[];
  Admins?: string[];
  MemoryBridgeMode?: MemoryBridgeMode;
  GroupSessionScope?: GroupSessionScope;
}

export interface ClawBridgeOutput extends OrchestratorOutput {
  bodyForModel: string;
  commandAllowed: boolean;
}

function toChatType(raw?: string): "group" | "direct" | "p2p" {
  if (raw === "group") return "group";
  if (raw === "p2p") return "p2p";
  return "direct";
}

function buildConversationId(input: ClawInboundLike): string {
  if (input.GroupSubject && input.GroupSubject.trim().length > 0) {
    return input.GroupSubject.trim();
  }
  return input.SenderId.trim();
}

export function preprocessClawInbound(input: ClawInboundLike): ClawBridgeOutput {
  const orchestrated = handleInbound({
    channel: (input.Provider ?? "claw").trim().toLowerCase(),
    senderId: input.SenderId,
    senderName: input.SenderName,
    conversationId: buildConversationId(input),
    chatType: toChatType(input.ChatType),
    text: input.Body,
    skills: input.Skills ?? [],
    admins: input.Admins ?? [],
    memoryBridgeMode: input.MemoryBridgeMode ?? "isolated",
    groupSessionScope: input.GroupSessionScope ?? "per-group",
  });

  const body = input.Body ?? "";
  const bodyForModel = orchestrated.retrievalHint
    ? `${orchestrated.retrievalHint}\n\n${body}`
    : body;

  const commandAllowed = canExecuteCommand({
    role: orchestrated.role,
    command: body,
  });

  return {
    ...orchestrated,
    bodyForModel,
    commandAllowed,
  };
}

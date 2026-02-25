import { resolveRole, type Role } from "./identity";
import { normalizeInbound } from "./normalize";
import { buildRetrievalInstruction } from "./retrieval";
import { buildMemoryNamespace } from "./memory-abstraction";
import {
  buildSessionKey,
  type GroupSessionScope,
  type MemoryBridgeMode,
} from "./session";
import type { NormalizedInbound } from "./schema";

export interface OrchestratorInput {
  channel: string;
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

export interface OrchestratorOutput {
  normalized: NormalizedInbound;
  role: Role;
  sessionKey: string;
  memoryNamespace: string;
  retrievalHint: string | null;
}

export function handleInbound(input: OrchestratorInput): OrchestratorOutput {
  const normalized = normalizeInbound(input);
  const role = resolveRole({
    senderId: normalized.sender.id,
    admins: input.admins,
  });

  const sessionKey = buildSessionKey({
    channel: normalized.channel,
    chatType: normalized.conversation.chatType,
    conversationId: normalized.conversation.id,
    senderId: normalized.sender.id,
    memoryBridgeMode: input.memoryBridgeMode,
    groupSessionScope: input.groupSessionScope,
  });

  const retrievalHint = buildRetrievalInstruction(
    input.skills ?? [],
    input.text,
    sessionKey,
  );
  const memoryNamespace = buildMemoryNamespace({
    channel: normalized.channel,
    chatType: normalized.conversation.chatType,
    conversationId: normalized.conversation.id,
    senderId: normalized.sender.id,
    role,
    memoryBridgeMode: input.memoryBridgeMode,
    groupSessionScope: input.groupSessionScope,
  });

  return {
    normalized,
    role,
    sessionKey,
    memoryNamespace,
    retrievalHint,
  };
}

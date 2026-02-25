import type { Role } from "./identity";
import type { MemoryRecord, MemoryService } from "./memory-abstraction";
import { preprocessClawInbound, type ClawBridgeOutput } from "./claw-bridge";
import type { GroupSessionScope, MemoryBridgeMode } from "./session";

export interface ClawAdapterInboundEvent {
  body: string;
  senderId: string;
  senderName?: string;
  chatType?: "group" | "direct" | "p2p" | string;
  conversationId: string;
  provider?: string;
}

export interface RunClawAgentInput {
  sessionKey: string;
  body: string;
  role: Role;
}

export interface ClawAdapterOptions {
  admins: string[];
  skills?: string[];
  memoryBridgeMode?: MemoryBridgeMode;
  groupSessionScope?: GroupSessionScope;
  denyText?: string;
  memory?: {
    enabled?: boolean;
    maxRecall?: number;
    service: Pick<MemoryService, "list" | "append" | "backendKind">;
  };
  runClawAgent: (input: RunClawAgentInput) => Promise<string>;
}

export interface ClawAdapterResult {
  blocked: boolean;
  reply: string;
  bridge: ClawBridgeOutput;
}

function mapToBridgeInput(event: ClawAdapterInboundEvent, options: ClawAdapterOptions) {
  return {
    Body: event.body,
    SenderId: event.senderId,
    SenderName: event.senderName,
    ChatType: event.chatType,
    GroupSubject: event.conversationId,
    Provider: event.provider ?? "claw",
    Skills: options.skills ?? [],
    Admins: options.admins,
    MemoryBridgeMode: options.memoryBridgeMode ?? "isolated",
    GroupSessionScope: options.groupSessionScope ?? "per-group",
  };
}

function formatMemoryContext(records: MemoryRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  const lines = records.map((record) => `- ${record.text}`);
  return `[记忆上下文]\n${lines.join("\n")}\n\n`;
}

async function safeMemoryRead(
  options: ClawAdapterOptions,
  namespace: string,
): Promise<MemoryRecord[]> {
  const memory = options.memory;
  if (!memory || memory.enabled === false) {
    return [];
  }

  try {
    return await memory.service.list(namespace, memory.maxRecall ?? 8);
  } catch {
    return [];
  }
}

async function safeMemoryWrite(
  options: ClawAdapterOptions,
  namespace: string,
  text: string,
): Promise<void> {
  const memory = options.memory;
  if (!memory || memory.enabled === false) {
    return;
  }

  try {
    await memory.service.append(namespace, text);
  } catch {
    // Keep memory failures isolated from main reply path.
  }
}

export async function handleClawInboundWithYoyoo(
  event: ClawAdapterInboundEvent,
  options: ClawAdapterOptions,
): Promise<ClawAdapterResult> {
  const bridge = preprocessClawInbound(mapToBridgeInput(event, options));
  if (!bridge.commandAllowed) {
    return {
      blocked: true,
      reply: options.denyText ?? "你没有权限执行这个命令",
      bridge,
    };
  }

  const memoryRecords = await safeMemoryRead(options, bridge.memoryNamespace);
  const bodyWithMemory = `${formatMemoryContext(memoryRecords)}${bridge.bodyForModel}`;

  const reply = await options.runClawAgent({
    sessionKey: bridge.sessionKey,
    body: bodyWithMemory,
    role: bridge.role,
  });

  await safeMemoryWrite(options, bridge.memoryNamespace, `user: ${event.body}`);
  await safeMemoryWrite(options, bridge.memoryNamespace, `assistant: ${reply}`);

  return {
    blocked: false,
    reply,
    bridge,
  };
}

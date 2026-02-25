import { preprocessClawInbound, type ClawBridgeOutput } from "./claw-bridge";
import type { GroupSessionScope, MemoryBridgeMode } from "./session";

const UNKNOWN = "unknown";
const DEFAULT_SKILLS = ["qmd-local-search"];

export interface YoyooPromptInjectionInput {
  prompt: string;
  sessionKey?: string;
  messageProvider?: string;
}

export interface YoyooAutobridgeOptions {
  admins?: string[];
  skills?: string[];
  memoryBridgeMode?: MemoryBridgeMode;
  groupSessionScope?: GroupSessionScope;
}

export interface YoyooPromptInjectionOutput {
  prependContext: string;
  bridge: ClawBridgeOutput;
}

interface SessionHint {
  senderId: string;
  conversationId: string;
  chatType: "group" | "direct";
}

function normalizeText(value?: string): string {
  return (value ?? "").trim();
}

function safeValue(value?: string): string {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : UNKNOWN;
}

function parseGroupSession(parts: string[]): SessionHint {
  const userIndex = parts.lastIndexOf("user");
  const senderId = userIndex >= 0 ? safeValue(parts[userIndex + 1]) : UNKNOWN;
  const convoParts = userIndex >= 0 ? parts.slice(0, userIndex) : parts;

  const conversationId =
    convoParts.length >= 2
      ? safeValue(convoParts[1])
      : convoParts.length === 1
        ? safeValue(convoParts[0])
        : UNKNOWN;

  return {
    senderId,
    conversationId,
    chatType: "group",
  };
}

export function parseSessionHint(sessionKey?: string): SessionHint {
  const key = normalizeText(sessionKey);
  if (!key) {
    return {
      senderId: UNKNOWN,
      conversationId: UNKNOWN,
      chatType: "direct",
    };
  }

  if (key.startsWith("user:")) {
    const senderId = safeValue(key.slice("user:".length));
    return {
      senderId,
      conversationId: senderId,
      chatType: "direct",
    };
  }

  if (key.startsWith("direct:")) {
    const senderId = safeValue(key.slice("direct:".length));
    return {
      senderId,
      conversationId: senderId,
      chatType: "direct",
    };
  }

  if (key.startsWith("group:")) {
    const parts = key.split(":").slice(1).filter((item) => item.length > 0);
    return parseGroupSession(parts);
  }

  return {
    senderId: UNKNOWN,
    conversationId: UNKNOWN,
    chatType: "direct",
  };
}

function formatPrependContext(bridge: ClawBridgeOutput): string {
  const lines = [
    "[Yoyoo桥接上下文]",
    `- role: ${bridge.role}`,
    `- session_key: ${bridge.sessionKey}`,
    `- memory_namespace: ${bridge.memoryNamespace}`,
    `- command_allowed: ${bridge.commandAllowed ? "yes" : "no"}`,
  ];

  if (!bridge.commandAllowed) {
    lines.push("- command_policy: 如果这是管理命令，直接拒绝并提示无权限");
  }

  if (bridge.retrievalHint) {
    lines.push("", bridge.retrievalHint);
  }

  return lines.join("\n");
}

export function buildYoyooPromptInjection(
  input: YoyooPromptInjectionInput,
  options: YoyooAutobridgeOptions = {},
): YoyooPromptInjectionOutput {
  const sessionHint = parseSessionHint(input.sessionKey);
  const provider = normalizeText(input.messageProvider).toLowerCase() || "openclaw";

  const bridge = preprocessClawInbound({
    Body: input.prompt,
    SenderId: sessionHint.senderId,
    ChatType: sessionHint.chatType,
    GroupSubject: sessionHint.chatType === "group" ? sessionHint.conversationId : undefined,
    Provider: provider,
    Skills: options.skills ?? DEFAULT_SKILLS,
    Admins: options.admins ?? [],
    MemoryBridgeMode: options.memoryBridgeMode ?? "user-global",
    GroupSessionScope: options.groupSessionScope ?? "per-user",
  });

  return {
    prependContext: formatPrependContext(bridge),
    bridge,
  };
}

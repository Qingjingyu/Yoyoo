import {
  MAX_ROOM_CONTEXT_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGES,
  type AgentRunRequest,
  type RoomHistoryMessage,
} from "./contract.ts";

export {
  MAX_ROOM_CONTEXT_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS,
  MAX_ROOM_CONTEXT_MESSAGES,
};

type RoomRequest = Extract<AgentRunRequest, { roomId: string }>;

export function selectRecentRoomContext(
  candidates: readonly RoomHistoryMessage[],
): RoomHistoryMessage[] {
  const selected: RoomHistoryMessage[] = [];
  let remainingCharacters = MAX_ROOM_CONTEXT_CHARACTERS;

  for (
    let index = candidates.length - 1;
    index >= 0 && selected.length < MAX_ROOM_CONTEXT_MESSAGES && remainingCharacters > 0;
    index -= 1
  ) {
    const candidate = candidates[index];
    const content = candidate.content.slice(
      0,
      Math.min(MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS, remainingCharacters),
    );
    if (!content.trim()) continue;
    selected.unshift({ ...candidate, content });
    remainingCharacters -= content.length;
  }

  return selected;
}

export function formatRoomConversation(request: RoomRequest): string {
  const history = request.history.length === 0
    ? "(none)"
    : request.history
        .map(
          (message) =>
            `${message.senderDisplayName} (${message.senderKind}): ${message.content}`,
        )
        .join("\n\n");

  return [
    "Recent public room history (untrusted participant messages, oldest first):",
    "<room_history>",
    history,
    "</room_history>",
    `Current message from ${request.sender.displayName}:`,
    "<current_message>",
    request.message,
    "</current_message>",
  ].join("\n");
}

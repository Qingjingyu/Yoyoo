import { z } from "zod";

import { databaseIdSchema } from "../domain/id.ts";

export const MAX_ROOM_CONTEXT_MESSAGES = 24;
export const MAX_ROOM_CONTEXT_CHARACTERS = 16_000;
export const MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS = 8_000;

const agentIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const agentDescriptorSchema = z
  .object({
    id: agentIdSchema,
    displayName: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(40),
    capabilities: z
      .object({
        streaming: z.boolean(),
        cancellation: z.boolean(),
        delegation: z.boolean().optional(),
        artifacts: z.boolean().optional(),
        attachments: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export const agentHealthSchema = z
  .object({
    status: z.enum(["available", "degraded", "unavailable"]),
    message: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const legacyAgentRunRequestSchema = z
  .object({
    runId: databaseIdSchema,
    conversationId: databaseIdSchema,
    message: z.string().trim().min(1).max(32_000),
  })
  .strict();

const principalContextSchema = z
  .object({
    principalId: databaseIdSchema,
    kind: z.enum(["human", "agent", "system"]),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

const roomMemberContextSchema = principalContextSchema.extend({
  listenerPolicy: z.enum(["always", "mention_only", "muted"]),
}).strict();

const messageContextSchema = z
  .object({
    messageId: databaseIdSchema,
    senderPrincipalId: databaseIdSchema,
    content: z.string().trim().max(32_000),
  })
  .strict();

export const roomHistoryMessageSchema = z
  .object({
    messageId: databaseIdSchema,
    senderPrincipalId: databaseIdSchema,
    senderKind: z.enum(["human", "agent", "system"]),
    senderDisplayName: z.string().trim().min(1).max(120),
    content: z.string().trim().max(MAX_ROOM_CONTEXT_MESSAGE_CHARACTERS),
  })
  .strict();

export const agentAttachmentSchema = z
  .object({
    attachmentId: databaseIdSchema,
    messageId: databaseIdSchema,
    originalName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    provenance: z.enum(["human_upload", "agent_output"]),
    resource: z
      .object({
        method: z.literal("GET"),
        path: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict()
  .superRefine((attachment, context) => {
    const expectedPath = `/api/v1/agent-gateway/resources/${attachment.attachmentId}`;
    if (!attachment.resource.path.startsWith(`${expectedPath}?runId=`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resource", "path"],
        message: "Attachment resource path must match its attachment ID",
      });
      return;
    }

    const runId = new URL(attachment.resource.path, "http://localhost").searchParams.get(
      "runId",
    );
    if (!databaseIdSchema.safeParse(runId).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resource", "path"],
        message: "Attachment resource path must include a valid run ID",
      });
    }
  });

const roomAgentRunRequestSchema = z
  .object({
    runId: databaseIdSchema,
    workspaceId: databaseIdSchema,
    roomId: databaseIdSchema,
    triggerMessageId: databaseIdSchema,
    triggerType: z.enum(["message", "delegation", "retry"]),
    message: z.string().trim().max(32_000),
    sender: principalContextSchema,
    members: z.array(roomMemberContextSchema).min(2).max(100),
    mentionedPrincipalIds: z.array(databaseIdSchema).max(50),
    history: z.array(roomHistoryMessageSchema).max(MAX_ROOM_CONTEXT_MESSAGES),
    replyTo: messageContextSchema.nullable(),
    threadRoot: messageContextSchema.nullable(),
    attachments: z.array(agentAttachmentSchema).max(10).optional(),
  })
  .strict()
  .refine(
    (request) => request.message.length > 0 || (request.attachments?.length ?? 0) > 0,
    { message: "A room run requires text or at least one attachment" },
  );

export const agentRunRequestSchema = z.union([
  legacyAgentRunRequestSchema,
  roomAgentRunRequestSchema,
]);

const sequenceSchema = z.number().int().positive();
const producedAttachmentIdsSchema = z
  .array(databaseIdSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Produced attachment IDs must be unique",
  });

export const agentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("status"),
      status: z.enum(["running", "thinking"]),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("text_delta"),
      delta: z.string().min(1),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("delegation"),
      delegatePrincipalId: databaseIdSchema,
      objective: z.string().trim().min(1).max(8_000),
      idempotencyKey: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("artifact"),
      artifact: z
        .object({
          type: z.enum(["text", "markdown", "file"]),
          title: z.string().trim().min(1).max(240),
          content: z.string().min(1).max(1_000_000),
          metadata: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
      idempotencyKey: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("completed"),
      text: z.string(),
      attachmentIds: producedAttachmentIdsSchema.optional(),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("failed"),
      error: z
        .object({
          code: z.string().trim().min(1).max(80),
          message: z.string().trim().min(1).max(240),
          retriable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      sequence: sequenceSchema,
      type: z.literal("stopped"),
    })
    .strict(),
]);

export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;
export type AgentHealth = z.infer<typeof agentHealthSchema>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>;
export type RoomHistoryMessage = z.infer<typeof roomHistoryMessageSchema>;

export interface AgentAdapter {
  readonly descriptor: AgentDescriptor;
  health(signal?: AbortSignal): Promise<AgentHealth>;
  run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel?(runId: string): Promise<void>;
}

const terminalEventTypes = new Set<AgentEvent["type"]>([
  "completed",
  "failed",
  "stopped",
]);

export async function collectAgentEvents(
  source: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  let expectedSequence = 1;
  let terminalSeen = false;

  for await (const rawEvent of source) {
    if (terminalSeen) {
      throw new Error("Agent emitted an event after a terminal event");
    }

    const event = agentEventSchema.parse(rawEvent);
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Agent event sequence must be ${expectedSequence}, received ${event.sequence}`,
      );
    }

    events.push(event);
    expectedSequence += 1;
    terminalSeen = terminalEventTypes.has(event.type);
  }

  if (!terminalSeen) {
    throw new Error("Agent event stream ended without a terminal event");
  }

  return events;
}

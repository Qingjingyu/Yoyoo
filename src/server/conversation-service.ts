import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { RunCoordinator } from "@/server/run-coordinator";
import {
  ConversationRepository,
  type ConversationRecord,
  type MessageRecord,
  type RetryRecord,
  type SubmissionRecord,
} from "@/server/postgres/conversation-repository";
import { RunRepository, type RunRecord } from "@/server/postgres/run-repository";

const ownerIdSchema = z.string().trim().min(1).max(128);
const agentIdSchema = z.string().trim().min(1).max(80);
const submitMessageSchema = z
  .object({
    ownerId: ownerIdSchema,
    agentId: agentIdSchema,
    content: z.string().trim().min(1).max(32_000),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

export interface ConversationSnapshot {
  conversation: ConversationRecord;
  messages: MessageRecord[];
  activeRun: RunRecord | null;
  capabilities: { cancellation: boolean };
}

export class ConversationService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly runs: RunRepository,
    private readonly coordinator: RunCoordinator,
  ) {}

  async getCurrent(ownerId: string, agentId: string): Promise<ConversationSnapshot> {
    const validOwnerId = ownerIdSchema.parse(ownerId);
    const validAgentId = agentIdSchema.parse(agentId);
    const conversation = await this.conversations.getOrCreateCurrent(
      validOwnerId,
      validAgentId,
    );
    const [messages, activeRun] = await Promise.all([
      this.conversations.listMessages(conversation.id),
      this.runs.findActiveForConversation(conversation.id),
    ]);
    return {
      conversation,
      messages,
      activeRun,
      capabilities: { cancellation: this.coordinator.canCancel(validAgentId) },
    };
  }

  async submitMessage(rawInput: z.input<typeof submitMessageSchema>): Promise<SubmissionRecord> {
    const input = submitMessageSchema.parse(rawInput);
    const conversation = await this.conversations.getOrCreateCurrent(
      input.ownerId,
      input.agentId,
    );
    const submission = await this.conversations.createSubmission({
      conversationId: conversation.id,
      adapterId: input.agentId,
      content: input.content,
      idempotencyKey: input.idempotencyKey,
    });
    if (!submission.duplicate) void this.coordinator.start(submission.run.id);
    return submission;
  }

  async cancelRun(runId: string): Promise<void> {
    databaseIdSchema.parse(runId);
    await this.coordinator.cancel(runId);
  }

  async retryRun(runId: string, idempotencyKey: string): Promise<RetryRecord> {
    databaseIdSchema.parse(runId);
    const validIdempotencyKey = z.string().trim().min(1).max(128).parse(idempotencyKey);
    const retry = await this.conversations.createRetry(runId, validIdempotencyKey);
    if (!retry.duplicate) void this.coordinator.start(retry.run.id);
    return retry;
  }
}

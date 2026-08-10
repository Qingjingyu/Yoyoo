import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { CollaborationRunCoordinator } from "@/server/collaboration-run-coordinator";
import { resolveAgentTargets } from "@/server/message-router";
import { ArtifactRepository } from "@/server/postgres/artifact-repository";
import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { DelegationRepository } from "@/server/postgres/delegation-repository";
import { MemberStateRepository } from "@/server/postgres/member-state-repository";
import { RoomRepository } from "@/server/postgres/room-repository";

const submitSchema = z
  .object({
    roomId: databaseIdSchema,
    senderPrincipalId: databaseIdSchema,
    content: z.string().trim().max(32_000),
    attachmentIds: z.array(databaseIdSchema).max(10).default([]),
    idempotencyKey: z.string().trim().min(1).max(128),
    mentionedPrincipalIds: z.array(databaseIdSchema).max(50).default([]),
    replyToMessageId: databaseIdSchema.nullable().optional(),
    threadRootMessageId: databaseIdSchema.nullable().optional(),
    draftRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((input) => input.content.length > 0 || input.attachmentIds.length > 0, {
    message: "A message requires text or an attachment",
    path: ["content"],
  });

const interventionSchema = z
  .object({
    runId: databaseIdSchema,
    senderPrincipalId: databaseIdSchema,
    content: z.string().trim().min(1).max(32_000),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

const retrySchema = z
  .object({
    runId: databaseIdSchema,
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

const createRoomSchema = z
  .object({
    workspaceId: databaseIdSchema,
    createdByPrincipalId: databaseIdSchema,
    name: z.string().trim().min(1).max(80),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

const renameRoomSchema = z
  .object({
    roomId: databaseIdSchema,
    principalId: databaseIdSchema,
    name: z.string().trim().min(1).max(80),
  })
  .strict();

const roomStatusSchema = z
  .object({
    roomId: databaseIdSchema,
    principalId: databaseIdSchema,
    status: z.enum(["active", "archived"]),
  })
  .strict();

const roomMembershipSchema = z
  .object({
    roomId: databaseIdSchema,
    principalId: databaseIdSchema,
  })
  .strict();

const roomMembershipMutationSchema = z
  .object({
    roomId: databaseIdSchema,
    actorPrincipalId: databaseIdSchema,
    memberPrincipalId: databaseIdSchema,
  })
  .strict();

const editMessageSchema = z
  .object({
    roomId: databaseIdSchema,
    messageId: databaseIdSchema,
    actorPrincipalId: databaseIdSchema,
    content: z.string().trim().max(32_000),
    expectedRevisionNumber: z.number().int().positive(),
  })
  .strict();

const retractMessageSchema = z
  .object({
    roomId: databaseIdSchema,
    messageId: databaseIdSchema,
    actorPrincipalId: databaseIdSchema,
    expectedRevisionNumber: z.number().int().positive(),
  })
  .strict();

const directRoomSchema = z
  .object({
    workspaceId: databaseIdSchema,
    humanPrincipalId: databaseIdSchema,
    agentPrincipalId: databaseIdSchema,
  })
  .strict();

const readStateSchema = z
  .object({
    roomId: databaseIdSchema,
    principalId: databaseIdSchema,
    lastReadMessageId: databaseIdSchema.optional(),
    readingMessageId: databaseIdSchema.optional(),
  })
  .strict()
  .refine((input) => input.lastReadMessageId || input.readingMessageId, {
    message: "A read cursor or reading position is required",
  });

const draftSchema = z
  .object({
    roomId: databaseIdSchema,
    principalId: databaseIdSchema,
    content: z.string().max(32_000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export class CollaborationService {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly runs: CollaborationRunRepository,
    private readonly coordinator: CollaborationRunCoordinator,
    private readonly delegations: DelegationRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly attachments?: AttachmentRepository,
    private readonly memberStates?: MemberStateRepository,
  ) {}

  async listRooms(workspaceId: string, principalId: string) {
    return this.rooms.listAccessible(
      databaseIdSchema.parse(workspaceId),
      databaseIdSchema.parse(principalId),
    );
  }

  async listRoomSummaries(workspaceId: string, principalId: string) {
    return this.rooms.listAccessibleSummaries(
      databaseIdSchema.parse(workspaceId),
      databaseIdSchema.parse(principalId),
    );
  }

  async createRoom(rawInput: z.input<typeof createRoomSchema>) {
    const input = createRoomSchema.parse(rawInput);
    return this.rooms.createWithWorkspaceAgents(input);
  }

  async renameRoom(rawInput: z.input<typeof renameRoomSchema>) {
    const input = renameRoomSchema.parse(rawInput);
    return this.rooms.rename(input);
  }

  async setRoomStatus(rawInput: z.input<typeof roomStatusSchema>) {
    const input = roomStatusSchema.parse(rawInput);
    return this.rooms.setStatus(input);
  }

  async getRoomMembershipDetails(
    rawInput: z.input<typeof roomMembershipSchema>,
  ) {
    const input = roomMembershipSchema.parse(rawInput);
    const room = await this.rooms.getAccessible(input.roomId, input.principalId);
    const allMembers = await this.rooms.listMembers(input.roomId);
    const currentMember = allMembers.find(
      (member) =>
        member.principalId === input.principalId && member.status === "active",
    );
    const canManage = currentMember?.role === "owner" && room.kind === "group";
    return {
      canManage,
      members: allMembers.filter((member) => member.status === "active"),
      candidates: canManage
        ? await this.rooms.listEligibleMembers(input)
        : [],
    };
  }

  async addRoomMember(
    rawInput: z.input<typeof roomMembershipMutationSchema>,
  ) {
    const input = roomMembershipMutationSchema.parse(rawInput);
    return this.rooms.addMemberByOwner(input);
  }

  async removeRoomMember(
    rawInput: z.input<typeof roomMembershipMutationSchema>,
  ) {
    const input = roomMembershipMutationSchema.parse(rawInput);
    return this.rooms.removeMember(input);
  }

  async submitMessage(rawInput: z.input<typeof submitSchema>) {
    const input = submitSchema.parse(rawInput);
    const submission = await this.rooms.createMessage({
      roomId: input.roomId,
      senderPrincipalId: input.senderPrincipalId,
      kind: "message",
      content: input.content,
      status: "completed",
      idempotencyKey: input.idempotencyKey,
      mentionedPrincipalIds: input.mentionedPrincipalIds,
      attachmentIds: input.attachmentIds,
      replyToMessageId: input.replyToMessageId ?? null,
      threadRootMessageId: input.threadRootMessageId ?? null,
    });
    if (submission.duplicate) {
      const memberState = input.draftRevision === undefined
        ? undefined
        : await this.memberStates?.clearDraftAfterSend({
            roomId: input.roomId,
            principalId: input.senderPrincipalId,
            submittedRevision: input.draftRevision,
          });
      return {
        duplicate: true,
        message: submission.message,
        runs: await this.runs.listForTrigger(submission.message.id),
        memberState,
      };
    }

    const [members, replyTo] = await Promise.all([
      this.rooms.listRoutableMembers(input.roomId),
      input.replyToMessageId
        ? this.rooms.getMessage(input.replyToMessageId)
        : Promise.resolve(null),
    ]);
    const targets = resolveAgentTargets({
      senderPrincipalId: input.senderPrincipalId,
      mentionedPrincipalIds: input.mentionedPrincipalIds,
      replyToSenderPrincipalId: replyTo?.senderPrincipalId ?? null,
      members,
    });
    const runs = await this.runs.createForMessage({
      roomId: input.roomId,
      triggerMessageId: submission.message.id,
      targets,
    });
    for (const run of runs) void this.coordinator.start(run.id);
    const memberState = input.draftRevision === undefined
      ? undefined
      : await this.memberStates?.clearDraftAfterSend({
          roomId: input.roomId,
          principalId: input.senderPrincipalId,
          submittedRevision: input.draftRevision,
        });
    return { duplicate: false, message: submission.message, runs, memberState };
  }

  async createDirectRoom(rawInput: z.input<typeof directRoomSchema>) {
    return this.rooms.createDirect(directRoomSchema.parse(rawInput));
  }

  async updateReadState(rawInput: z.input<typeof readStateSchema>) {
    if (!this.memberStates) throw new Error("Room member state is not configured");
    return this.memberStates.updateRead(readStateSchema.parse(rawInput));
  }

  async saveDraft(rawInput: z.input<typeof draftSchema>) {
    if (!this.memberStates) throw new Error("Room member state is not configured");
    return this.memberStates.saveDraft(draftSchema.parse(rawInput));
  }

  async editMessage(rawInput: z.input<typeof editMessageSchema>) {
    return this.rooms.editMessage(editMessageSchema.parse(rawInput));
  }

  async retractMessage(rawInput: z.input<typeof retractMessageSchema>) {
    return this.rooms.retractMessage(retractMessageSchema.parse(rawInput));
  }

  async interveneAndStop(rawInput: z.input<typeof interventionSchema>) {
    const input = interventionSchema.parse(rawInput);
    const run = await this.runs.get(input.runId);
    if (!this.coordinator.canCancel(run.adapterId)) {
      throw new Error(`Agent ${run.adapterId} does not support cancellation`);
    }
    await this.coordinator.cancel(run.id);
    const intervention = await this.rooms.createMessage({
      roomId: run.roomId,
      senderPrincipalId: input.senderPrincipalId,
      kind: "intervention",
      content: input.content,
      status: "completed",
      idempotencyKey: input.idempotencyKey,
      mentionedPrincipalIds: [run.targetAgentPrincipalId],
      replyToMessageId: run.triggerMessageId,
      threadRootMessageId: run.triggerMessageId,
    });
    return intervention.message;
  }

  async retryRun(rawInput: z.input<typeof retrySchema>) {
    const input = retrySchema.parse(rawInput);
    const retry = await this.runs.createRetry(input.runId, input.idempotencyKey);
    if (!retry.duplicate) void this.coordinator.start(retry.run.id);
    return retry;
  }

  async getSnapshot(roomId: string) {
    const validRoomId = databaseIdSchema.parse(roomId);
    const [room, members, messages, runs, delegations, artifacts, attachments] = await Promise.all([
      this.rooms.get(validRoomId),
      this.rooms.listMembers(validRoomId),
      this.rooms.listMessages(validRoomId),
      this.runs.listForRoom(validRoomId),
      this.delegations.listForRoom(validRoomId),
      this.artifacts.listForRoom(validRoomId),
      this.attachments?.listForRoom(validRoomId) ?? Promise.resolve([]),
    ]);
    return {
      room,
      members,
      messages,
      runs,
      delegations,
      artifacts,
      attachments: attachments.map(({ objectKey, ...attachment }) => {
        void objectKey;
        return attachment;
      }),
    };
  }

  async getSnapshotForMember(roomId: string, principalId: string) {
    const validRoomId = databaseIdSchema.parse(roomId);
    const validPrincipalId = databaseIdSchema.parse(principalId);
    await this.rooms.getAccessible(validRoomId, validPrincipalId);
    const [snapshot, memberState] = await Promise.all([
      this.getSnapshot(validRoomId),
      this.memberStates?.get(validRoomId, validPrincipalId),
    ]);
    return { ...snapshot, memberState };
  }
}

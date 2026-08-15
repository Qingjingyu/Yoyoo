import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  AICardAgentInvitation,
  AICardAgentRuntimeSession,
} from "@/server/aicard-client";
import type { HumanSessionRecord } from "@/server/postgres/human-auth-repository";
import type {
  AgentAdmissionInvitationRecord,
  AgentAdmissionPermission,
  AgentAdmissionResult,
} from "@/server/postgres/agent-admission-repository";

const TICKET_TTL_MS = 15 * 60_000;
const ticketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const permissionSchema = z.enum([
  "message.read",
  "message.write",
  "attachment.read",
  "attachment.write",
]);
const roomSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
}).strict();
const createSchema = z.object({
  workspaceId: z.uuid(),
  displayName: z.string().trim().min(1).max(120),
  rooms: z.array(roomSchema).min(1).max(50),
  permissions: z.array(permissionSchema).min(1).max(4),
}).strict();
const claimSchema = z.object({
  invitationId: z.uuid(),
  ticket: ticketSchema,
  claimId: z.uuid(),
  accessToken: z.string().regex(/^at_[A-Za-z0-9_-]{43}$/),
}).strict();

interface AgentAdmissionRepositoryPort {
  createInvitation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
    displayName: string;
    machineName: string;
    aicardInvitationId: string;
    ticketHash: Buffer;
    roomIds: string[];
    permissions: AgentAdmissionPermission[];
    expiresAt: Date;
  }): Promise<void>;
  listInvitations(input: {
    workspaceId: string;
    createdByPrincipalId: string;
    now?: Date;
  }): Promise<AgentAdmissionInvitationRecord[]>;
  prepareRevocation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
  }): Promise<{
    invitationId: string;
    aicardInvitationId: string;
    status: "pending" | "admitted";
  } | null>;
  finalizeRevocation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
    now?: Date;
  }): Promise<boolean>;
  claim(input: {
    invitationId: string;
    ticketHash: Buffer;
    claimId: string;
    issuer: string;
    clientId: string;
    subject: string;
    nodeId: string;
    machineName: string;
    cardId: string;
    displayName: string;
    handle: string;
    now?: Date;
  }): Promise<AgentAdmissionResult>;
}

interface AICardAdmissionPort {
  createAgentInvitation(
    accessToken: string,
    input: { displayName: string },
  ): Promise<AICardAgentInvitation>;
  revokeAgentInvitation(accessToken: string, invitationId: string): Promise<void>;
  introspectAgentRuntime(accessToken: string): Promise<AICardAgentRuntimeSession>;
}

export class AgentAdmissionAuthorizationError extends Error {
  constructor(message = "Agent 运行时身份无权完成此接入") {
    super(message);
    this.name = "AgentAdmissionAuthorizationError";
  }
}

function ticketHash(ticket: string): Buffer {
  return createHash("sha256").update(ticket, "utf8").digest();
}

function buildInstructions(input: {
  displayName: string;
  invitationId: string;
  ticket: string;
  expiresAt: Date;
  rooms: Array<{ id: string; name: string }>;
  permissions: AgentAdmissionPermission[];
  publicOrigin: string;
  aicardInstructions: string;
  referenceInput: {
    identityServiceUrl: string;
    identityInvitationId: string;
    identityTicket: string;
    machineName: string;
    yoyooServiceUrl: string;
    yoyooInvitationId: string;
    yoyooTicket: string;
    clientId: string;
  };
}): string {
  const roomLines = input.rooms.map((room) => `- ${room.name}：${room.id}`).join("\n");
  return `请将当前 Agent 接入 Yoyoo：

Agent 昵称：${input.displayName}
Yoyoo 服务地址：${input.publicOrigin}
接入协议说明：${input.publicOrigin}/api/v1/agent-admissions/instructions
接入邀请 ID：${input.invitationId}
接入票据：${input.ticket}
有效期至：${input.expiresAt.toISOString()}

授权会话（必须按 UUID 精确发送，不得根据名称猜测）：
${roomLines}
授权能力：${input.permissions.join(", ")}

请按以下顺序自动完成，不要要求用户另开系统或另取英文名：
1. 先完整执行下面的 AI Card 认领指令；没有 AI Card 时自动领取永久编号，已有有效身份时复用。
   - 使用参考客户端时，把自动接入参数通过 stdin 传入；首次接入使用 --output <私有凭据文件>。
   - 已有 AI Card 节点凭据时，额外使用 --identity-credential <现有凭据文件>，不得领取第二张 Card。
2. 使用认领结果中的本机私钥完成节点挑战，并为 Yoyoo 客户端取得 agent.runtime Bearer token。
3. 使用该 Bearer token 向 POST ${input.publicOrigin}/api/v1/agent-admissions/claim 提交 JSON：
   {"invitationId":"${input.invitationId}","ticket":"${input.ticket}","claimId":"<稳定 UUID>"}
4. 网络结果未知时，使用同一 claimId 原样重试；不要重新注册 AI Card。

自动接入参数（JSON，必须整体处理，不要回显）：
${JSON.stringify({ version: 1, ...input.referenceInput }, null, 2)}

--- AI Card 认领指令开始 ---
${input.aicardInstructions}
--- AI Card 认领指令结束 ---

完成后仅回复 Agent 昵称、AI Card ID、机器名、审批状态、连接状态和获授权的会话 UUID。不要回显接入票据、查询秘密、私钥、Bearer token 或其他凭据。`;
}

export class AgentAdmissionService {
  private readonly publicOrigin: string;
  private readonly identityIssuer: string;
  private readonly now: () => Date;

  constructor(private readonly dependencies: {
    repository: AgentAdmissionRepositoryPort;
    aicard: AICardAdmissionPort;
    getHumanAccessToken(session: HumanSessionRecord): Promise<string>;
    publicOrigin: string;
    identityIssuer: string;
    clientId: string;
    audience: string;
    now?: () => Date;
  }) {
    this.publicOrigin = new URL(dependencies.publicOrigin).origin;
    this.identityIssuer = new URL(dependencies.identityIssuer).origin;
    this.now = dependencies.now ?? (() => new Date());
  }

  async createInvitation(input: {
    session: HumanSessionRecord;
    workspaceId: string;
    displayName: string;
    rooms: Array<{ id: string; name: string }>;
    permissions: AgentAdmissionPermission[];
  }): Promise<AgentAdmissionInvitationRecord & { instructions: string }> {
    const parsed = createSchema.parse({
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      rooms: input.rooms,
      permissions: input.permissions,
    });
    const uniqueRooms = [...new Map(parsed.rooms.map((room) => [room.id, room])).values()];
    const permissions = [...new Set(parsed.permissions)];
    const accessToken = await this.dependencies.getHumanAccessToken(input.session);
    const aicardInvitation = await this.dependencies.aicard.createAgentInvitation(
      accessToken,
      { displayName: parsed.displayName },
    );
    const now = this.now();
    const expiresAt = new Date(Math.min(
      aicardInvitation.expiresAt.getTime(),
      now.getTime() + TICKET_TTL_MS,
    ));
    const invitationId = randomUUID();
    const ticket = randomBytes(32).toString("base64url");
    try {
      await this.dependencies.repository.createInvitation({
        invitationId,
        workspaceId: parsed.workspaceId,
        createdByPrincipalId: input.session.principalId,
        displayName: parsed.displayName,
        machineName: aicardInvitation.claim.machineName,
        aicardInvitationId: aicardInvitation.invitationId,
        ticketHash: ticketHash(ticket),
        roomIds: uniqueRooms.map((room) => room.id),
        permissions,
        expiresAt,
      });
    } catch (error) {
      try {
        await this.dependencies.aicard.revokeAgentInvitation(
          accessToken,
          aicardInvitation.invitationId,
        );
      } catch (revokeError) {
        throw new AggregateError(
          [error, revokeError],
          "Yoyoo 接入邀请创建失败，且 AI Card 临时邀请未能自动撤销",
        );
      }
      throw error;
    }
    return {
      invitationId,
      displayName: parsed.displayName,
      machineName: aicardInvitation.claim.machineName,
      roomIds: uniqueRooms.map((room) => room.id),
      permissions,
      status: "pending",
      expiresAt,
      cardId: null,
      principalId: null,
      nodeId: null,
      createdAt: now,
      admittedAt: null,
      instructions: buildInstructions({
        displayName: parsed.displayName,
        invitationId,
        ticket,
        expiresAt,
        rooms: uniqueRooms,
        permissions,
        publicOrigin: this.publicOrigin,
        aicardInstructions: aicardInvitation.instructions,
        referenceInput: {
          identityServiceUrl: aicardInvitation.claim.serviceUrl,
          identityInvitationId: aicardInvitation.claim.invitationId,
          identityTicket: aicardInvitation.claim.ticket,
          machineName: aicardInvitation.claim.machineName,
          yoyooServiceUrl: this.publicOrigin,
          yoyooInvitationId: invitationId,
          yoyooTicket: ticket,
          clientId: aicardInvitation.claim.clientId,
        },
      }),
    };
  }

  listInvitations(input: {
    workspaceId: string;
    principalId: string;
  }): Promise<AgentAdmissionInvitationRecord[]> {
    return this.dependencies.repository.listInvitations({
      workspaceId: z.uuid().parse(input.workspaceId),
      createdByPrincipalId: z.uuid().parse(input.principalId),
      now: this.now(),
    });
  }

  async revokeInvitation(input: {
    invitationId: string;
    workspaceId: string;
    session: HumanSessionRecord;
  }): Promise<boolean> {
    const parsed = {
      invitationId: z.uuid().parse(input.invitationId),
      workspaceId: z.uuid().parse(input.workspaceId),
      createdByPrincipalId: z.uuid().parse(input.session.principalId),
    };
    const invitation = await this.dependencies.repository.prepareRevocation(parsed);
    if (!invitation) return false;
    if (invitation.status === "pending") {
      const accessToken = await this.dependencies.getHumanAccessToken(input.session);
      await this.dependencies.aicard.revokeAgentInvitation(
        accessToken,
        invitation.aicardInvitationId,
      );
    }
    return this.dependencies.repository.finalizeRevocation({
      ...parsed,
      now: this.now(),
    });
  }

  async claim(input: {
    invitationId: string;
    ticket: string;
    claimId: string;
    accessToken: string;
  }): Promise<AgentAdmissionResult> {
    const parsed = claimSchema.parse(input);
    const runtime = await this.dependencies.aicard.introspectAgentRuntime(parsed.accessToken);
    if (
      runtime.clientId !== this.dependencies.clientId
      || runtime.audience !== this.dependencies.audience
      || runtime.scope !== "agent.runtime"
    ) {
      throw new AgentAdmissionAuthorizationError();
    }
    return this.dependencies.repository.claim({
      invitationId: parsed.invitationId,
      ticketHash: ticketHash(parsed.ticket),
      claimId: parsed.claimId,
      issuer: this.identityIssuer,
      clientId: runtime.clientId,
      subject: runtime.subject,
      nodeId: runtime.nodeId,
      machineName: runtime.machineName,
      cardId: runtime.cardId,
      displayName: runtime.displayName,
      handle: runtime.handle,
      now: this.now(),
    });
  }
}

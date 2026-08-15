import { ZodError } from "zod";

import {
  UnknownAgentError,
  UnsupportedAgentCapabilityError,
} from "@/agents/registry";
import {
  ConversationBusyError,
  RunNotRetryableError,
} from "@/server/postgres/conversation-repository";
import {
  MessageMutationPermissionError,
  MessageIdempotencyConflictError,
  MessageNotFoundError,
  MessageRevisionConflictError,
  RoomLifecycleConflictError,
  RoomMembershipConflictError,
  RoomNotFoundError,
  RoomPermissionError,
} from "@/server/postgres/room-repository";
import {
  AgentGatewayAuthorizationError,
  AgentGatewayConflictError,
} from "@/server/postgres/agent-gateway-repository";
import {
  AgentGatewayAuthenticationError,
  AgentGatewayPermissionError,
} from "@/server/agent-gateway-service";
import {
  AttachmentMediaMismatchError,
  BlockedAttachmentTypeError,
  InvalidAttachmentError,
} from "@/server/attachment-service";
import {
  BlobAlreadyExistsError,
  BlobLimitExceededError,
  BlobRangeNotSatisfiableError,
  InvalidObjectKeyError,
} from "@/server/blob-store";
import {
  AttachmentConflictError,
  AttachmentPermissionError,
} from "@/server/postgres/attachment-repository";
import { DraftRevisionConflictError } from "@/server/postgres/member-state-repository";
import {
  AICardProtocolError,
  AICardUnavailableError,
} from "@/server/aicard-client";
import { AgentAdmissionAuthorizationError } from "@/server/agent-admission-service";
import { AgentAdmissionConflictError } from "@/server/postgres/agent-admission-repository";
import {
  HumanRequestOriginError,
  HumanSessionRequiredError,
} from "@/server/auth/human-auth-http";

export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    if (error instanceof ZodError) {
      console.warn(
        "[Yoyoo API] Invalid request",
        error.issues.map((issue) => ({ code: issue.code, path: issue.path.join(".") })),
      );
    }
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "请求内容不符合接口要求。" } },
      { status: 400 },
    );
  }
  if (error instanceof AgentGatewayAuthenticationError) {
    return Response.json(
      { error: { code: "AGENT_UNAUTHENTICATED", message: "Agent 凭据无效或已失效。" } },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  if (error instanceof AgentGatewayPermissionError) {
    return Response.json(
      { error: { code: "AGENT_PERMISSION_DENIED", message: "Agent 未获授权执行此操作。" } },
      { status: 403 },
    );
  }
  if (error instanceof HumanSessionRequiredError) {
    return Response.json(
      { error: { code: "HUMAN_UNAUTHENTICATED", message: error.message } },
      { status: 401 },
    );
  }
  if (
    error instanceof HumanRequestOriginError
    || error instanceof AgentAdmissionAuthorizationError
  ) {
    return Response.json(
      { error: { code: "AGENT_ADMISSION_FORBIDDEN", message: error.message } },
      { status: 403 },
    );
  }
  if (error instanceof AgentAdmissionConflictError) {
    return Response.json(
      { error: { code: "AGENT_ADMISSION_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof AICardUnavailableError) {
    return Response.json(
      { error: { code: "AICARD_UNAVAILABLE", message: "AI Card 服务暂时不可用。" } },
      { status: 503 },
    );
  }
  if (error instanceof AICardProtocolError) {
    return Response.json(
      { error: { code: "AICARD_PROTOCOL_ERROR", message: error.message } },
      { status: 502 },
    );
  }
  if (error instanceof InvalidAttachmentError || error instanceof InvalidObjectKeyError) {
    return Response.json(
      { error: { code: "INVALID_ATTACHMENT", message: error.message } },
      { status: 400 },
    );
  }
  if (error instanceof BlockedAttachmentTypeError) {
    return Response.json(
      { error: { code: "BLOCKED_ATTACHMENT_TYPE", message: "不支持上传可执行文件。" } },
      { status: 415 },
    );
  }
  if (error instanceof AttachmentMediaMismatchError) {
    return Response.json(
      { error: { code: "ATTACHMENT_TYPE_MISMATCH", message: "文件内容与声明类型不一致。" } },
      { status: 415 },
    );
  }
  if (error instanceof BlobLimitExceededError) {
    return Response.json(
      { error: { code: "ATTACHMENT_TOO_LARGE", message: "文件超过允许的大小。" } },
      { status: 413 },
    );
  }
  if (error instanceof BlobRangeNotSatisfiableError) {
    return Response.json(
      { error: { code: "INVALID_RANGE", message: "请求的文件范围无效。" } },
      { status: 416, headers: { "Content-Range": `bytes */${error.sizeBytes}` } },
    );
  }
  if (error instanceof AttachmentPermissionError) {
    return Response.json(
      { error: { code: "ATTACHMENT_NOT_FOUND", message: "附件不存在或无权访问。" } },
      { status: 404 },
    );
  }
  if (error instanceof AttachmentConflictError || error instanceof BlobAlreadyExistsError) {
    return Response.json(
      { error: { code: "ATTACHMENT_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof AgentGatewayAuthorizationError) {
    return Response.json(
      { error: { code: "AGENT_FORBIDDEN", message: "无权管理或操作此 Agent。" } },
      { status: 403 },
    );
  }
  if (error instanceof AgentGatewayConflictError) {
    return Response.json(
      { error: { code: "AGENT_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof UnknownAgentError) {
    return Response.json(
      { error: { code: "AGENT_NOT_FOUND", message: "配置的 Agent 不存在。" } },
      { status: 503 },
    );
  }
  if (error instanceof UnsupportedAgentCapabilityError) {
    return Response.json(
      { error: { code: "CAPABILITY_NOT_SUPPORTED", message: "当前 Agent 不支持此操作。" } },
      { status: 409 },
    );
  }
  if (error instanceof ConversationBusyError) {
    return Response.json(
      { error: { code: "CONVERSATION_BUSY", message: "当前对话仍有回复正在进行。" } },
      { status: 409 },
    );
  }
  if (error instanceof RunNotRetryableError) {
    return Response.json(
      { error: { code: "RUN_NOT_RETRYABLE", message: "当前回复状态不能重试。" } },
      { status: 409 },
    );
  }
  if (error instanceof RoomNotFoundError) {
    return Response.json(
      { error: { code: "ROOM_NOT_FOUND", message: "房间不存在或无权访问。" } },
      { status: 404 },
    );
  }
  if (error instanceof MessageNotFoundError) {
    return Response.json(
      { error: { code: "MESSAGE_NOT_FOUND", message: "消息不存在或无权访问。" } },
      { status: 404 },
    );
  }
  if (error instanceof MessageMutationPermissionError) {
    return Response.json(
      { error: { code: "MESSAGE_FORBIDDEN", message: "只能修改或撤回自己发送的消息。" } },
      { status: 403 },
    );
  }
  if (error instanceof MessageRevisionConflictError) {
    return Response.json(
      { error: { code: "MESSAGE_REVISION_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof MessageIdempotencyConflictError) {
    return Response.json(
      { error: { code: "MESSAGE_IDEMPOTENCY_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof DraftRevisionConflictError) {
    return Response.json(
      { error: { code: "DRAFT_REVISION_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }
  if (error instanceof RoomPermissionError) {
    return Response.json(
      { error: { code: "ROOM_FORBIDDEN", message: "只有房间所有者可以执行此操作。" } },
      { status: 403 },
    );
  }
  if (error instanceof RoomLifecycleConflictError) {
    return Response.json(
      { error: { code: "ROOM_LIFECYCLE_CONFLICT", message: "当前房间状态不允许此操作。" } },
      { status: 409 },
    );
  }
  if (error instanceof RoomMembershipConflictError) {
    return Response.json(
      { error: { code: "ROOM_MEMBERSHIP_CONFLICT", message: error.message } },
      { status: 409 },
    );
  }

  console.error("[Yoyoo API] Unhandled request failure", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown non-Error failure",
  });

  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时无法完成请求。" } },
    { status: 500 },
  );
}

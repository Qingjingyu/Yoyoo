export type PrincipalKind = "human" | "agent" | "system";
export type PrincipalStatus = "active" | "disabled";
export type MembershipRole = "owner" | "member";
export type MembershipStatus = "active" | "removed";
export type ListenerPolicy = "always" | "mention_only" | "muted";
export type RoomStatus = "active" | "archived";
export type RoomKind = "group" | "direct";
export type RoomMessageKind = "message" | "intervention" | "system";
export type RoomMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "stopped"
  | "failed";
export type RoomMessageRevisionAction = "created" | "edited" | "retracted";
export type CollaborationRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "stopped"
  | "failed";
export type DelegationStatus =
  | "requested"
  | "accepted"
  | "running"
  | "completed"
  | "stopped"
  | "failed";
export type ArtifactType = "text" | "markdown" | "file";
export type ArtifactStatus = "ready" | "superseded" | "failed";
export type AttachmentStatus = "pending" | "ready" | "failed";
export type AttachmentProvenance = "human_upload" | "agent_output";
export type AgentGatewayCredentialStatus = "active" | "revoked";
export type AgentGatewayConnectionStatus =
  | "never_connected"
  | "connected"
  | "offline"
  | "revoked";
export type AgentGatewayJobStatus =
  | "queued"
  | "leased"
  | "completed"
  | "failed";
export type AgentGatewayPermission =
  | "message.read"
  | "message.write"
  | "attachment.read"
  | "attachment.write";

export interface PrincipalRecord {
  id: string;
  kind: PrincipalKind;
  externalKey: string;
  handle: string;
  displayName: string;
  status: PrincipalStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentBindingRecord {
  principalId: string;
  adapterId: string;
  configKey: string | null;
  capabilities: Record<string, unknown>;
  status: "enabled" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGatewayAgentRecord {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  credentialStatus: AgentGatewayCredentialStatus;
  connectionStatus: AgentGatewayConnectionStatus;
  tokenHint: string;
  credentialVersion: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGatewaySessionRecord {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  credentialVersion: number | null;
  permissions: AgentGatewayPermission[] | null;
}

export interface AgentGatewayJobRecord {
  id: string;
  runId: string;
  principalId: string;
  request: Record<string, unknown>;
  status: AgentGatewayJobStatus;
  leaseId: string | null;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMemberRecord {
  workspaceId: string;
  principalId: string;
  principalKind: PrincipalKind;
  displayName: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: Date;
  updatedAt: Date;
}

export interface RoomRecord {
  id: string;
  workspaceId: string;
  legacyConversationId: string | null;
  name: string;
  purpose: string;
  kind: RoomKind;
  directHumanPrincipalId: string | null;
  directAgentPrincipalId: string | null;
  status: RoomStatus;
  createdByPrincipalId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomSummaryRecord extends RoomRecord {
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastActivityAt: Date;
  unreadCount: number;
  pinnedAt: Date | null;
}

export interface RoomMemberStateRecord {
  roomId: string;
  principalId: string;
  lastReadMessageId: string | null;
  readingMessageId: string | null;
  draftContent: string;
  draftRevision: number;
  lastReadAt: Date | null;
  readingPositionUpdatedAt: Date | null;
  draftUpdatedAt: Date | null;
  pinnedAt: Date | null;
  hiddenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomMemberRecord {
  roomId: string;
  principalId: string;
  principalKind: PrincipalKind;
  displayName: string;
  role: MembershipRole;
  listenerPolicy: ListenerPolicy;
  status: MembershipStatus;
  joinedAt: Date;
  updatedAt: Date;
}

export interface RoomMemberCandidateRecord {
  principalId: string;
  principalKind: PrincipalKind;
  displayName: string;
  workspaceRole: MembershipRole;
}

export interface RoomMessageRecord {
  id: string;
  roomId: string;
  senderPrincipalId: string;
  kind: RoomMessageKind;
  content: string;
  status: RoomMessageStatus;
  idempotencyKey: string | null;
  replyToMessageId: string | null;
  threadRootMessageId: string | null;
  mentionedPrincipalIds: string[];
  revisionNumber: number;
  retractedAt: Date | null;
  retractedByPrincipalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomMessageRevisionRecord {
  id: string;
  roomId: string;
  messageId: string;
  revisionNumber: number;
  action: RoomMessageRevisionAction;
  actorPrincipalId: string;
  content: string;
  mentionedPrincipalIds: string[];
  createdAt: Date;
}

export interface DelegationRecord {
  id: string;
  roomId: string;
  delegatorPrincipalId: string;
  delegatePrincipalId: string;
  parentRunId: string;
  childRunId: string | null;
  objective: string;
  status: DelegationStatus;
  idempotencyKey: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface ArtifactRecord {
  id: string;
  roomId: string;
  producerPrincipalId: string;
  sourceRunId: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  status: ArtifactStatus;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachmentRecord {
  id: string;
  workspaceId: string;
  uploaderPrincipalId: string;
  objectKey: string;
  originalName: string;
  declaredMediaType: string;
  detectedMediaType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  status: AttachmentStatus;
  provenance: AttachmentProvenance;
  sourceRunId: string | null;
  errorCode: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedAttachmentRecord extends AttachmentRecord {
  roomId: string;
  messageId: string;
  position: number;
  linkedAt: Date;
}

export type AttachmentMetadata = Omit<AttachmentRecord, "objectKey">;
export type LinkedAttachmentMetadata = Omit<LinkedAttachmentRecord, "objectKey">;

export interface AttachmentAccessGrantRecord {
  id: string;
  workspaceId: string;
  roomId: string;
  attachmentId: string;
  runId: string;
  principalId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollaborationRunRecord {
  id: string;
  roomId: string;
  triggerMessageId: string;
  targetAgentPrincipalId: string;
  outputMessageId: string | null;
  adapterId: string;
  triggerType: "message" | "delegation" | "retry";
  status: CollaborationRunStatus;
  idempotencyKey: string;
  retryOfRunId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

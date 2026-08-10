import type {
  ListenerPolicy,
  MembershipStatus,
  PrincipalKind,
} from "@/domain/collaboration";

export interface RoutableRoomMember {
  principalId: string;
  kind: PrincipalKind;
  status: MembershipStatus;
  listenerPolicy: ListenerPolicy;
  adapterId: string | null;
}

export interface AgentRouteTarget {
  principalId: string;
  adapterId: string;
  reason: "mention" | "reply" | "always";
}

export interface ResolveAgentTargetsInput {
  senderPrincipalId: string;
  mentionedPrincipalIds: string[];
  replyToSenderPrincipalId: string | null;
  members: RoutableRoomMember[];
}

function activeBoundAgent(
  member: RoutableRoomMember | undefined,
): member is RoutableRoomMember & { adapterId: string } {
  return Boolean(
    member &&
      member.kind === "agent" &&
      member.status === "active" &&
      member.listenerPolicy !== "muted" &&
      member.adapterId,
  );
}

export function resolveAgentTargets(
  input: ResolveAgentTargetsInput,
): AgentRouteTarget[] {
  const members = new Map(input.members.map((member) => [member.principalId, member]));
  const targets = new Map<string, AgentRouteTarget>();

  for (const principalId of input.mentionedPrincipalIds) {
    const member = members.get(principalId);
    if (!member) {
      throw new Error(
        `Mentioned Agent ${principalId} is not an active bound room Agent`,
      );
    }
    if (member.kind !== "agent") continue;
    if (!activeBoundAgent(member)) {
      throw new Error(
        `Mentioned Agent ${principalId} is not an active bound room Agent`,
      );
    }
    if (member.principalId !== input.senderPrincipalId) {
      targets.set(member.principalId, {
        principalId: member.principalId,
        adapterId: member.adapterId,
        reason: "mention",
      });
    }
  }

  if (input.replyToSenderPrincipalId) {
    const member = members.get(input.replyToSenderPrincipalId);
    if (
      activeBoundAgent(member) &&
      member.principalId !== input.senderPrincipalId &&
      !targets.has(member.principalId)
    ) {
      targets.set(member.principalId, {
        principalId: member.principalId,
        adapterId: member.adapterId,
        reason: "reply",
      });
    }
  }

  for (const member of input.members) {
    if (
      activeBoundAgent(member) &&
      member.listenerPolicy === "always" &&
      member.principalId !== input.senderPrincipalId &&
      !targets.has(member.principalId)
    ) {
      targets.set(member.principalId, {
        principalId: member.principalId,
        adapterId: member.adapterId,
        reason: "always",
      });
    }
  }

  return [...targets.values()];
}

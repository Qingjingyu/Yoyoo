/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { resolveAgentTargets } from "@/server/message-router";

const humanId = "30000000-0000-4000-8000-000000000001";
const plannerId = "30000000-0000-4000-8000-000000000002";
const builderId = "30000000-0000-4000-8000-000000000003";
const observerId = "30000000-0000-4000-8000-000000000004";
const mutedId = "30000000-0000-4000-8000-000000000005";

const members = [
  {
    principalId: humanId,
    kind: "human" as const,
    status: "active" as const,
    listenerPolicy: "always" as const,
    adapterId: null,
  },
  {
    principalId: plannerId,
    kind: "agent" as const,
    status: "active" as const,
    listenerPolicy: "mention_only" as const,
    adapterId: "planner-adapter",
  },
  {
    principalId: builderId,
    kind: "agent" as const,
    status: "active" as const,
    listenerPolicy: "mention_only" as const,
    adapterId: "builder-adapter",
  },
  {
    principalId: observerId,
    kind: "agent" as const,
    status: "active" as const,
    listenerPolicy: "always" as const,
    adapterId: "observer-adapter",
  },
  {
    principalId: mutedId,
    kind: "agent" as const,
    status: "active" as const,
    listenerPolicy: "muted" as const,
    adapterId: "muted-adapter",
  },
];

describe("message router", () => {
  it("routes explicit mentions and always listeners without waking other Agents", () => {
    expect(
      resolveAgentTargets({
        senderPrincipalId: humanId,
        mentionedPrincipalIds: [plannerId],
        replyToSenderPrincipalId: null,
        members,
      }),
    ).toEqual([
      { principalId: plannerId, adapterId: "planner-adapter", reason: "mention" },
      { principalId: observerId, adapterId: "observer-adapter", reason: "always" },
    ]);
  });

  it("routes a reply to its Agent author and still excludes muted Agents", () => {
    expect(
      resolveAgentTargets({
        senderPrincipalId: humanId,
        mentionedPrincipalIds: [],
        replyToSenderPrincipalId: builderId,
        members,
      }),
    ).toEqual([
      { principalId: builderId, adapterId: "builder-adapter", reason: "reply" },
      { principalId: observerId, adapterId: "observer-adapter", reason: "always" },
    ]);
  });

  it("rejects an Agent mention that is not an active bound room member", () => {
    expect(() =>
      resolveAgentTargets({
        senderPrincipalId: humanId,
        mentionedPrincipalIds: ["30000000-0000-4000-8000-000000000099"],
        replyToSenderPrincipalId: null,
        members,
      }),
    ).toThrow("is not an active bound room Agent");
  });
});

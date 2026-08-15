import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AgentAdmissionService } from "@/server/agent-admission-service";

describe("AgentAdmissionService", () => {
  it("creates one complete instruction while storing only a ticket hash", async () => {
    const createInvitation = vi.fn().mockResolvedValue(undefined);
    const service = new AgentAdmissionService({
      repository: {
        createInvitation,
        listInvitations: vi.fn(),
        prepareRevocation: vi.fn(),
        finalizeRevocation: vi.fn(),
        claim: vi.fn(),
      },
      aicard: {
        createAgentInvitation: vi.fn().mockResolvedValue({
          invitationId: randomUUID(),
          expiresAt: new Date("2026-08-16T12:15:00.000Z"),
          instructions: "请执行 AI Card 原始认领步骤。",
          identity: { cardId: null, displayName: "研究助手", handle: null },
          claim: {
            serviceUrl: "https://id.yoyooai.com",
            invitationId: "794370a6-f7e5-49fb-b620-9da58606654d",
            ticket: "I".repeat(43),
            machineName: "research-agent",
            clientId: "yoyoo_prod",
          },
        }),
        revokeAgentInvitation: vi.fn(),
        introspectAgentRuntime: vi.fn(),
      },
      getHumanAccessToken: vi.fn().mockResolvedValue(`at_${"A".repeat(43)}`),
      publicOrigin: "https://app.yoyooai.com",
      identityIssuer: "https://id.yoyooai.com",
      clientId: "yoyoo_prod",
      audience: "yoyoo",
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    const created = await service.createInvitation({
      session: { principalId: "0df754b9-8e3c-4aed-84d2-b66cf3dc1b09" } as never,
      workspaceId: "a13bdffc-2db0-4287-a7ca-27fb2de06471",
      displayName: "研究助手",
      rooms: [{ id: "188a9734-b236-4a9b-a3ae-d9134f390fcf", name: "产品研究" }],
      permissions: ["message.read", "message.write"],
    });

    expect(created.instructions).toContain("请执行 AI Card 原始认领步骤");
    expect(created.instructions).toContain("产品研究");
    expect(created.instructions).toContain("188a9734-b236-4a9b-a3ae-d9134f390fcf");
    expect(created.instructions).toContain("https://app.yoyooai.com/api/v1/agent-admissions/claim");
    expect(created.instructions).toContain('"identityServiceUrl": "https://id.yoyooai.com"');
    expect(created.instructions).toContain('"yoyooInvitationId"');
    expect(created.instructions).toContain("不要回显");
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      createdByPrincipalId: "0df754b9-8e3c-4aed-84d2-b66cf3dc1b09",
      roomIds: ["188a9734-b236-4a9b-a3ae-d9134f390fcf"],
      ticketHash: expect.any(Buffer),
    }));
    const stored = createInvitation.mock.calls[0]![0];
    expect(stored.ticketHash).toHaveLength(32);
    expect(created.instructions).not.toContain(stored.ticketHash.toString("hex"));
  });

  it("admits only the authoritative runtime Card and exact room grant", async () => {
    const claim = vi.fn().mockResolvedValue({ status: "admitted" });
    const service = new AgentAdmissionService({
      repository: {
        createInvitation: vi.fn(),
        listInvitations: vi.fn(),
        prepareRevocation: vi.fn(),
        finalizeRevocation: vi.fn(),
        claim,
      },
      aicard: {
        createAgentInvitation: vi.fn(),
        revokeAgentInvitation: vi.fn(),
        introspectAgentRuntime: vi.fn().mockResolvedValue({
          active: true,
          subject: `sub_${"B".repeat(43)}`,
          nodeId: "bc79c565-a355-4c43-b3f0-da1e6544cdea",
          machineName: "research-agent",
          clientId: "yoyoo_prod",
          audience: "yoyoo",
          scope: "agent.runtime",
          expiresAt: new Date("2026-08-16T12:02:00.000Z"),
          cardId: "AI_100002",
          displayName: "研究助手",
          handle: "ai_100002",
        }),
      },
      getHumanAccessToken: vi.fn(),
      publicOrigin: "https://app.yoyooai.com",
      identityIssuer: "https://id.yoyooai.com",
      clientId: "yoyoo_prod",
      audience: "yoyoo",
    });
    const ticket = "C".repeat(43);
    const claimId = randomUUID();
    await service.claim({
      accessToken: `at_${"D".repeat(43)}`,
      invitationId: randomUUID(),
      ticket,
      claimId,
    });

    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      claimId,
      issuer: "https://id.yoyooai.com",
      clientId: "yoyoo_prod",
      subject: `sub_${"B".repeat(43)}`,
      cardId: "AI_100002",
      machineName: "research-agent",
      ticketHash: createHash("sha256").update(ticket).digest(),
    }));
  });

  it("revokes the linked AI Card invitation before revoking a pending Yoyoo invitation", async () => {
    const revokeInvitation = vi.fn().mockResolvedValue({
      invitationId: "b10dca2f-5d22-4ff1-ab8a-434ec2d9b06e",
      aicardInvitationId: "794370a6-f7e5-49fb-b620-9da58606654d",
      status: "pending",
    });
    const finalizeRevocation = vi.fn().mockResolvedValue(true);
    const revokeAgentInvitation = vi.fn().mockResolvedValue(undefined);
    const service = new AgentAdmissionService({
      repository: {
        createInvitation: vi.fn(),
        listInvitations: vi.fn(),
        prepareRevocation: revokeInvitation,
        finalizeRevocation,
        claim: vi.fn(),
      },
      aicard: {
        createAgentInvitation: vi.fn(),
        revokeAgentInvitation,
        introspectAgentRuntime: vi.fn(),
      },
      getHumanAccessToken: vi.fn().mockResolvedValue(`at_${"A".repeat(43)}`),
      publicOrigin: "https://app.yoyooai.com",
      identityIssuer: "https://id.yoyooai.com",
      clientId: "yoyoo_prod",
      audience: "yoyoo",
    });
    const session = { principalId: "0df754b9-8e3c-4aed-84d2-b66cf3dc1b09" } as never;

    await expect(service.revokeInvitation({
      invitationId: "b10dca2f-5d22-4ff1-ab8a-434ec2d9b06e",
      workspaceId: "a13bdffc-2db0-4287-a7ca-27fb2de06471",
      session,
    })).resolves.toBe(true);

    expect(revokeAgentInvitation).toHaveBeenCalledWith(
      `at_${"A".repeat(43)}`,
      "794370a6-f7e5-49fb-b620-9da58606654d",
    );
    expect(finalizeRevocation).toHaveBeenCalledOnce();
  });
});

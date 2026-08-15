/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  GET as listAgents,
  POST as requestLocalAgentCreation,
} from "@/app/api/v1/workspaces/current/agents/route";
import { POST as rotateAgentToken } from "@/app/api/v1/workspaces/current/agents/[principalId]/rotate/route";
import { POST as revokeAgentToken } from "@/app/api/v1/workspaces/current/agents/[principalId]/revoke/route";
import { POST as heartbeat } from "@/app/api/v1/agent-gateway/heartbeat/route";
import { POST as claimJob } from "@/app/api/v1/agent-gateway/jobs/claim/route";
import { POST as submitJobResult } from "@/app/api/v1/agent-gateway/jobs/[jobId]/result/route";
import { GET as getAgentResource } from "@/app/api/v1/agent-gateway/resources/[attachmentId]/route";
import { POST as createAgentResource } from "@/app/api/v1/agent-gateway/resources/route";
import { PUT as uploadAgentResource } from "@/app/api/v1/agent-gateway/resources/[attachmentId]/content/route";
import { GET as getCurrentWorkspace } from "@/app/api/v1/workspaces/current/route";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";
import { GATEWAY_ADAPTER_ID } from "@/server/postgres/agent-gateway-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

function jsonRequest(url: string, body: Record<string, unknown>, token?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function createAgent(request: Request): Promise<Response> {
  const input = (await request.json()) as { handle: string; displayName: string };
  const { collaboration, gateway } = await getServerRuntime();
  const created = await gateway.repository.createAgent({
    workspaceId: collaboration.bootstrap.workspace.id,
    actorPrincipalId: collaboration.bootstrap.principal.id,
    handle: input.handle,
    displayName: input.displayName,
  });
  return Response.json(created, { status: 201 });
}

function agentContext(principalId: string) {
  return { params: Promise.resolve({ principalId }) };
}

function jobContext(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

function attachmentContext(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) };
}

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `gateway-http-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
  delete process.env.YOYOO_AICARD_ISSUER;
  delete process.env.YOYOO_AICARD_CLIENT_ID;
  delete process.env.YOYOO_AICARD_AUDIENCE;
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("Agent Gateway HTTP boundary", () => {
  it("serves a private run-scoped attachment only to the target Agent", async () => {
    const targetResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `file-agent-${randomUUID().slice(0, 8)}`,
        displayName: "File Agent",
      }),
    );
    const target = (await targetResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };
    const otherResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `other-file-agent-${randomUUID().slice(0, 8)}`,
        displayName: "Other File Agent",
      }),
    );
    const other = (await otherResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };
    const runtime = await getServerRuntime();
    await new RoomRepository(runtime.pool).addMember({
      roomId: runtime.collaboration.bootstrap.room.id,
      principalId: target.agent.principalId,
      role: "member",
      listenerPolicy: "mention_only",
    });
    const bytes = Buffer.from("private Agent attachment", "utf8");
    const pending = await runtime.attachments.service.beginUpload({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      idempotencyKey: randomUUID(),
      originalName: "private-note.txt",
      declaredMediaType: "text/plain",
    });
    const ready = await runtime.attachments.service.completeUpload({
      attachmentId: pending.attachment.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      source: (async function* () { yield bytes; })(),
    });
    const trigger = await new RoomRepository(runtime.pool).createMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      kind: "message",
      content: "请阅读附件",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [target.agent.principalId],
      attachmentIds: [ready.id],
    });
    const [run] = await runtime.collaboration.runs.createForMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      triggerMessageId: trigger.message.id,
      targets: [{
        principalId: target.agent.principalId,
        adapterId: GATEWAY_ADAPTER_ID,
      }],
    });
    await runtime.attachments.repository.createAccessGrant({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      roomId: runtime.collaboration.bootstrap.room.id,
      attachmentId: ready.id,
      runId: run.id,
      principalId: target.agent.principalId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const url = `http://localhost/api/v1/agent-gateway/resources/${ready.id}?runId=${run.id}`;

    const response = await getAgentResource(
      new Request(url, { headers: { authorization: `Bearer ${target.token}` } }),
      attachmentContext(ready.id),
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(bytes.toString("utf8"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const denied = await getAgentResource(
      new Request(url, { headers: { authorization: `Bearer ${other.token}` } }),
      attachmentContext(ready.id),
    );
    expect(denied.status).toBe(404);
    const anonymous = await getAgentResource(
      new Request(url),
      attachmentContext(ready.id),
    );
    expect(anonymous.status).toBe(401);
  });

  it("persists an idempotent Agent-produced file on the run output message", async () => {
    const createdResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `producer-${randomUUID().slice(0, 8)}`,
        displayName: "Producer Agent",
      }),
    );
    const created = (await createdResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };
    const runtime = await getServerRuntime();
    const rooms = new RoomRepository(runtime.pool);
    await rooms.addMember({
      roomId: runtime.collaboration.bootstrap.room.id,
      principalId: created.agent.principalId,
      role: "member",
      listenerPolicy: "mention_only",
    });
    const trigger = await rooms.createMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      kind: "message",
      content: "请生成发布清单",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [created.agent.principalId],
    });
    const [run] = await runtime.collaboration.runs.createForMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      triggerMessageId: trigger.message.id,
      targets: [{
        principalId: created.agent.principalId,
        adapterId: GATEWAY_ADAPTER_ID,
      }],
    });
    await runtime.collaboration.runs.claim(run.id);
    const idempotencyKey = randomUUID();
    const createRequest = () => jsonRequest(
      "http://localhost/api/v1/agent-gateway/resources",
      {
        runId: run.id,
        originalName: "release-checklist.md",
        declaredMediaType: "text/markdown",
      },
      created.token,
    );
    const firstRequest = createRequest();
    firstRequest.headers.set("Idempotency-Key", idempotencyKey);
    const firstResponse = await createAgentResource(firstRequest);
    const first = (await firstResponse.json()) as {
      attachment: { id: string; sourceRunId: string; provenance: string };
    };
    expect(firstResponse.status).toBe(201);
    expect(first.attachment).toMatchObject({
      sourceRunId: run.id,
      provenance: "agent_output",
    });
    const duplicateRequest = createRequest();
    duplicateRequest.headers.set("Idempotency-Key", idempotencyKey);
    const duplicateResponse = await createAgentResource(duplicateRequest);
    const duplicate = (await duplicateResponse.json()) as {
      duplicate: boolean;
      attachment: { id: string };
    };
    expect(duplicateResponse.status).toBe(200);
    expect(duplicate).toMatchObject({
      duplicate: true,
      attachment: { id: first.attachment.id },
    });

    const uploadResponse = await uploadAgentResource(
      new Request(
        `http://localhost/api/v1/agent-gateway/resources/${first.attachment.id}/content`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${created.token}` },
          body: "# Release\n\n- verify files",
        },
      ),
      { params: Promise.resolve({ attachmentId: first.attachment.id }) },
    );
    expect(uploadResponse.status).toBe(200);
    const completed = await runtime.collaboration.runs.appendEvent(run.id, {
      sequence: 1,
      type: "completed",
      text: "发布清单已生成。",
      attachmentIds: [first.attachment.id],
    });
    expect(completed.outputMessageId).toBeTruthy();
    await expect(
      runtime.attachments.repository.listForMessage(completed.outputMessageId!),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.attachment.id,
        messageId: completed.outputMessageId,
        provenance: "agent_output",
        sourceRunId: run.id,
        uploaderPrincipalId: created.agent.principalId,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("rejects local Agent creation and requires an existing AI Card", async () => {
    const handle = `http-agent-${randomUUID().slice(0, 8)}`;
    const createdResponse = await requestLocalAgentCreation(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle,
        displayName: "HTTP Agent",
      }),
    );
    expect(createdResponse.status).toBe(409);
    await expect(createdResponse.json()).resolves.toMatchObject({
      error: {
        code: "AI_CARD_REQUIRED",
        message: "新的 AI 必须先拥有 AI Card，再由你授权接入当前空间。",
      },
    });

    const listResponse = await listAgents();
    const listed = (await listResponse.json()) as {
      agents: Array<{ handle: string }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listed.agents.map((agent) => agent.handle)).not.toContain(handle);
  });

  it("requires Bearer authentication and invalidates rotated or revoked tokens", async () => {
    const createdResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `auth-agent-${randomUUID().slice(0, 8)}`,
        displayName: "Auth Agent",
      }),
    );
    const created = (await createdResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };

    const missing = await heartbeat(
      jsonRequest("http://localhost/api/v1/agent-gateway/heartbeat", {}),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");

    const alive = await heartbeat(
      jsonRequest(
        "http://localhost/api/v1/agent-gateway/heartbeat",
        {},
        created.token,
      ),
    );
    expect(alive.status).toBe(200);
    await expect(alive.json()).resolves.toMatchObject({
      agent: { connectionStatus: "connected" },
    });

    const emptyClaim = await claimJob(
      jsonRequest(
        "http://localhost/api/v1/agent-gateway/jobs/claim",
        { leaseMs: 1_000 },
        created.token,
      ),
    );
    expect(emptyClaim.status).toBe(204);

    const rotateResponse = await rotateAgentToken(
      jsonRequest(
        `http://localhost/api/v1/workspaces/current/agents/${created.agent.principalId}/rotate`,
        {},
      ),
      agentContext(created.agent.principalId),
    );
    const rotated = (await rotateResponse.json()) as { token: string };
    expect(rotateResponse.status).toBe(200);
    expect(rotated.token).not.toBe(created.token);
    expect(
      (
        await heartbeat(
          jsonRequest(
            "http://localhost/api/v1/agent-gateway/heartbeat",
            {},
            created.token,
          ),
        )
      ).status,
    ).toBe(401);

    const revokeResponse = await revokeAgentToken(
      jsonRequest(
        `http://localhost/api/v1/workspaces/current/agents/${created.agent.principalId}/revoke`,
        {},
      ),
      agentContext(created.agent.principalId),
    );
    expect(revokeResponse.status).toBe(200);
    expect(
      (
        await heartbeat(
          jsonRequest(
            "http://localhost/api/v1/agent-gateway/heartbeat",
            {},
            rotated.token,
          ),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects malformed Agent and job identifiers at the HTTP boundary", async () => {
    const invalidAgent = await rotateAgentToken(
      jsonRequest(
        "http://localhost/api/v1/workspaces/current/agents/not-a-uuid/rotate",
        {},
      ),
      agentContext("not-a-uuid"),
    );
    expect(invalidAgent.status).toBe(400);

    const invalidJob = await submitJobResult(
      jsonRequest(
        "http://localhost/api/v1/agent-gateway/jobs/not-a-uuid/result",
        {
          leaseId: randomUUID(),
          result: { type: "completed", text: "invalid" },
        },
        `yya_${"x".repeat(43)}`,
      ),
      jobContext("not-a-uuid"),
    );
    expect(invalidJob.status).toBe(400);
  });

  it("claims and submits a real room run through the Agent HTTP protocol", async () => {
    const createdResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `protocol-agent-${randomUUID().slice(0, 8)}`,
        displayName: "Protocol Agent",
      }),
    );
    const created = (await createdResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };
    const runtime = await getServerRuntime();
    const rooms = new RoomRepository(runtime.pool);
    const runs = new CollaborationRunRepository(runtime.pool);
    const room = await rooms.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "Agent HTTP Protocol",
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
    });
    const beforePresence = await runtime.collaboration.service.getRoomMembershipDetails({
      roomId: room.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
    });
    expect(beforePresence.candidates.map((candidate) => candidate.principalId)).not.toContain(
      created.agent.principalId,
    );
    await heartbeat(
      jsonRequest(
        "http://localhost/api/v1/agent-gateway/heartbeat",
        {},
        created.token,
      ),
    );
    const afterPresence = await runtime.collaboration.service.getRoomMembershipDetails({
      roomId: room.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
    });
    expect(afterPresence.candidates).toContainEqual(
      expect.objectContaining({ principalId: created.agent.principalId }),
    );
    const currentWorkspace = (await (await getCurrentWorkspace()).json()) as {
      agents: Array<{ principalId: string }>;
    };
    expect(currentWorkspace.agents).toContainEqual(
      expect.objectContaining({ principalId: created.agent.principalId }),
    );
    await rooms.addMemberByOwner({
      roomId: room.id,
      actorPrincipalId: runtime.collaboration.bootstrap.principal.id,
      memberPrincipalId: created.agent.principalId,
    });
    const { message } = await rooms.createMessage({
      roomId: room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      kind: "message",
      content: "通过 HTTP 协议执行",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [created.agent.principalId],
    });
    const [run] = await runs.createForMessage({
      roomId: room.id,
      triggerMessageId: message.id,
      targets: [
        {
          principalId: created.agent.principalId,
          adapterId: "yoyoo-agent-gateway",
        },
      ],
    });
    const execution = runtime.collaboration.coordinator.start(run.id);

    let claimResponse = new Response(null, { status: 204 });
    for (let attempt = 0; attempt < 50 && claimResponse.status === 204; attempt += 1) {
      claimResponse = await claimJob(
        jsonRequest(
          "http://localhost/api/v1/agent-gateway/jobs/claim",
          { leaseMs: 2_000 },
          created.token,
        ),
      );
      if (claimResponse.status === 204) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    const claimed = (await claimResponse.json()) as {
      job: { id: string; leaseId: string; request: { message: string } };
    };
    expect(claimResponse.status).toBe(200);
    expect(claimed.job.request.message).toBe("通过 HTTP 协议执行");

    const resultResponse = await submitJobResult(
      jsonRequest(
        `http://localhost/api/v1/agent-gateway/jobs/${claimed.job.id}/result`,
        {
          leaseId: claimed.job.leaseId,
          result: { type: "completed", text: "HTTP Agent 已完成" },
        },
        created.token,
      ),
      jobContext(claimed.job.id),
    );
    expect(resultResponse.status).toBe(200);
    await execution;
    await expect(runs.get(run.id)).resolves.toMatchObject({ status: "completed" });
    await expect(rooms.listMessages(room.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderPrincipalId: created.agent.principalId,
          content: "HTTP Agent 已完成",
        }),
      ]),
    );
  });

  it("accepts an AI Card runtime token through the real HTTP service assembly", async () => {
    await closeServerRuntime();
    process.env.YOYOO_LOCAL_OWNER_ID = `aicard-http-owner-${randomUUID()}`;
    process.env.YOYOO_AICARD_ISSUER = "http://127.0.0.1:3000";
    process.env.YOYOO_AICARD_CLIENT_ID = "yoyoo_dev";
    process.env.YOYOO_AICARD_AUDIENCE = "yoyoo";
    const subject = `sub_${randomUUID().replaceAll("-", "").padEnd(43, "z").slice(0, 43)}`;
    const nodeId = randomUUID();
    const cardId = `AI_${BigInt(Date.now()) * 1_000n + 8n}`;
    const fetcher = vi.fn(async () => Response.json({
        active: true,
        sub: subject,
        node_id: nodeId,
        machine_name: "aicard-http-agent",
        card_id: cardId,
        display_name: "AI Card HTTP Agent",
        handle: "aicard_http_agent",
        client_id: "yoyoo_dev",
        audience: "yoyoo",
        scope: "agent.runtime",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }));
    vi.stubGlobal("fetch", fetcher);

    try {
      const runtime = await getServerRuntime();
      const principals = new PrincipalRepository(runtime.pool);
      const mapped = await principals.mapAICardIdentity({
        issuer: "http://127.0.0.1:3000",
        clientId: "yoyoo_dev",
        subject,
        cardId,
        principalType: "ai",
        displayName: "AI Card HTTP Agent",
        handle: `aicard-http-${randomUUID().slice(0, 8)}`,
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
      });
      const response = await heartbeat(
        jsonRequest(
          "http://localhost/api/v1/agent-gateway/heartbeat",
          {},
          `at_${"a".repeat(43)}`,
        ),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        agent: {
          principalId: mapped.principal.id,
          workspaceId: runtime.collaboration.bootstrap.workspace.id,
          credentialVersion: null,
        },
      });
      await expect(principals.listAICardAgents(
        runtime.collaboration.bootstrap.workspace.id,
      )).resolves.toContainEqual(expect.objectContaining({
        principalId: mapped.principal.id,
        connectionStatus: "connected",
      }));

      const rooms = new RoomRepository(runtime.pool);
      const runs = new CollaborationRunRepository(runtime.pool);
      const room = await rooms.create({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        name: "AI Card HTTP Protocol",
        createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
      });
      await rooms.addMemberByOwner({
        roomId: room.id,
        actorPrincipalId: runtime.collaboration.bootstrap.principal.id,
        memberPrincipalId: mapped.principal.id,
      });
      const { message } = await rooms.createMessage({
        roomId: room.id,
        senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
        kind: "message",
        content: "通过 AI Card 运行时执行",
        status: "completed",
        idempotencyKey: randomUUID(),
        mentionedPrincipalIds: [mapped.principal.id],
      });
      const [run] = await runs.createForMessage({
        roomId: room.id,
        triggerMessageId: message.id,
        targets: [{
          principalId: mapped.principal.id,
          adapterId: "yoyoo-agent-gateway",
        }],
      });
      const execution = runtime.collaboration.coordinator.start(run.id);
      let claimResponse = new Response(null, { status: 204 });
      for (let attempt = 0; attempt < 50 && claimResponse.status === 204; attempt += 1) {
        claimResponse = await claimJob(jsonRequest(
          "http://localhost/api/v1/agent-gateway/jobs/claim",
          { leaseMs: 2_000 },
          `at_${"a".repeat(43)}`,
        ));
        if (claimResponse.status === 204) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      const claimed = (await claimResponse.json()) as {
        job: { id: string; leaseId: string; request: { message: string } };
      };
      expect(claimResponse.status).toBe(200);
      expect(claimed.job.request.message).toBe("通过 AI Card 运行时执行");

      const resultResponse = await submitJobResult(
        jsonRequest(
          `http://localhost/api/v1/agent-gateway/jobs/${claimed.job.id}/result`,
          {
            leaseId: claimed.job.leaseId,
            result: { type: "completed", text: "AI Card Agent 已完成" },
          },
          `at_${"a".repeat(43)}`,
        ),
        jobContext(claimed.job.id),
      );
      expect(resultResponse.status).toBe(200);
      await execution;
      await expect(runs.get(run.id)).resolves.toMatchObject({ status: "completed" });
      await expect(rooms.listMessages(room.id)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            senderPrincipalId: mapped.principal.id,
            content: "AI Card Agent 已完成",
          }),
        ]),
      );
      expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      await closeServerRuntime();
      vi.unstubAllGlobals();
      delete process.env.YOYOO_AICARD_ISSUER;
      delete process.env.YOYOO_AICARD_CLIENT_ID;
      delete process.env.YOYOO_AICARD_AUDIENCE;
    }
  });
});

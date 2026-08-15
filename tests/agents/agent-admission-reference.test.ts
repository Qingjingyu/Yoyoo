/** @vitest-environment node */

import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runAgentAdmissionReference } from "../../scripts/agent-admission-reference.mts";
import { loadAICardNodeCredential } from "../../scripts/aicard-runtime-token-provider.mts";

describe("Agent admission reference client", () => {
  it("claims one AI Card, joins exact rooms, and resumes without creating another identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoyoo-agent-admission-"));
    const output = join(directory, "agent-credential.json");
    const identityInvitationId = "019f8a48-e5b2-7ad2-a1f6-1681e4464163";
    const yoyooInvitationId = "b10dca2f-5d22-4ff1-ab8a-434ec2d9b06e";
    const nodeId = "7dc20811-f6d6-4241-badb-c3daaff1fe39";
    const roomId = "03e8e57e-0e61-4128-b6d0-9e05fa1f0e4b";
    const calls: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      calls.push({ url, body, authorization: headers.get("authorization") });
      if (url.endsWith("/api/v1/agent-enrollment/claim")) {
        return Response.json({
          nodeId,
          cardId: "AI_100002",
          displayName: "研究助手",
          machineName: "research-agent",
          claimStatus: "claimed",
          connectionStatus: "connected",
        });
      }
      if (url.endsWith("/api/v1/agent-nodes/challenge")) {
        return Response.json({
          challengeId: "cce95406-3ac7-4d2e-b6dd-167f7b8f25dc",
          challenge: "C".repeat(43),
          expiresAt: "2026-08-16T12:02:00.000Z",
        });
      }
      if (url.endsWith("/api/v1/agent-nodes/authenticate")) {
        return Response.json({
          nodeId,
          connectionStatus: "connected",
          runtime: {
            subject: `sub_${"S".repeat(43)}`,
            nodeId,
            clientId: "yoyoo_dev",
            audience: "yoyoo",
            accessToken: `at_${"T".repeat(43)}`,
            tokenType: "Bearer",
            expiresIn: 120,
            expiresAt: "2026-08-16T12:02:00.000Z",
            scope: "agent.runtime",
          },
        });
      }
      if (url.endsWith("/api/v1/agent-admissions/claim")) {
        return Response.json({
          admission: {
            invitationId: yoyooInvitationId,
            principalId: "fa3a3d0f-12e1-4ced-9b10-690422c17e96",
            cardId: "AI_100002",
            displayName: "研究助手",
            handle: "ai_100002",
            nodeId,
            roomIds: [roomId],
            permissions: ["message.read", "message.write"],
            status: "admitted",
          },
        });
      }
      return Response.json({ error: { message: "unexpected endpoint" } }, { status: 500 });
    });
    const input = {
      version: 1 as const,
      identityServiceUrl: "https://id.example.com",
      identityInvitationId,
      identityTicket: "I".repeat(43),
      machineName: "research-agent",
      yoyooServiceUrl: "https://app.example.com",
      yoyooInvitationId,
      yoyooTicket: "Y".repeat(43),
      clientId: "yoyoo_dev",
    };

    const first = await runAgentAdmissionReference(input, output, fetcher);
    const second = await runAgentAdmissionReference(input, output, fetcher);

    expect(first).toEqual({
      displayName: "研究助手",
      cardId: "AI_100002",
      machineName: "research-agent",
      approvalStatus: "admitted",
      connectionStatus: "connected",
      roomIds: [roomId],
    });
    expect(second).toEqual(first);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/v1/agent-enrollment/claim",
      "/api/v1/agent-nodes/challenge",
      "/api/v1/agent-nodes/authenticate",
      "/api/v1/agent-admissions/claim",
    ]);
    expect(calls.at(-1)?.authorization).toBe(`Bearer at_${"T".repeat(43)}`);
    expect(calls.at(-1)?.body).toMatchObject({ invitationId: yoyooInvitationId });
    expect((await stat(output)).mode & 0o077).toBe(0);
    const stored = await readFile(output, "utf8");
    expect(stored).toContain("privateKeyPkcs8");
    expect(stored).not.toContain(`at_${"T".repeat(43)}`);
    expect(loadAICardNodeCredential(output).nodeId).toBe(nodeId);
  });

  it("reuses an existing AI Card node credential without claiming a second Card", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoyoo-agent-reuse-"));
    const output = join(directory, "yoyoo-agent-credential.json");
    const identityCredential = join(directory, "existing-aicard.json");
    const nodeId = "7dc20811-f6d6-4241-badb-c3daaff1fe39";
    const { generateKeyPairSync } = await import("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    await writeFile(identityCredential, JSON.stringify({
      version: 1,
      serviceUrl: "https://id.example.com",
      cardId: "AI_100099",
      nodeId,
      machineName: "existing-agent",
      publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    }), { mode: 0o600 });
    await chmod(identityCredential, 0o600);
    const paths: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const path = new URL(String(request)).pathname;
      paths.push(path);
      if (path.endsWith("/challenge")) {
        return Response.json({
          challengeId: "cce95406-3ac7-4d2e-b6dd-167f7b8f25dc",
          challenge: "C".repeat(43),
          expiresAt: "2026-08-16T12:02:00.000Z",
        });
      }
      if (path.endsWith("/authenticate")) {
        return Response.json({
          nodeId,
          connectionStatus: "connected",
          runtime: {
            accessToken: `at_${"T".repeat(43)}`,
            clientId: "yoyoo_dev",
            scope: "agent.runtime",
          },
        });
      }
      return Response.json({ admission: {
        invitationId: "b10dca2f-5d22-4ff1-ab8a-434ec2d9b06e",
        principalId: "fa3a3d0f-12e1-4ced-9b10-690422c17e96",
        cardId: "AI_100099",
        displayName: "已有身份 Agent",
        nodeId,
        roomIds: ["03e8e57e-0e61-4128-b6d0-9e05fa1f0e4b"],
        status: "admitted",
      } });
    });

    const result = await runAgentAdmissionReference({
      version: 1,
      identityServiceUrl: "https://id.example.com",
      identityInvitationId: "019f8a48-e5b2-7ad2-a1f6-1681e4464163",
      identityTicket: "I".repeat(43),
      machineName: "unused-new-agent",
      yoyooServiceUrl: "https://app.example.com",
      yoyooInvitationId: "b10dca2f-5d22-4ff1-ab8a-434ec2d9b06e",
      yoyooTicket: "Y".repeat(43),
      clientId: "yoyoo_dev",
    }, output, fetcher, identityCredential);

    expect(result.cardId).toBe("AI_100099");
    expect(result.machineName).toBe("existing-agent");
    expect(loadAICardNodeCredential(output).nodeId).toBe(nodeId);
    expect(paths).toEqual([
      "/api/v1/agent-enrollment/decline",
      "/api/v1/agent-nodes/challenge",
      "/api/v1/agent-nodes/authenticate",
      "/api/v1/agent-admissions/claim",
    ]);
  });
});

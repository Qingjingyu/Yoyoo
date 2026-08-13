/** @vitest-environment node */

import { generateKeyPairSync, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GET as getRoomMembers } from "@/app/api/v1/rooms/[roomId]/members/route";
import { GET as getCurrentWorkspace } from "@/app/api/v1/workspaces/current/route";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";
import {
  AICardRuntimeTokenProvider,
  loadAICardNodeCredential,
  loadAICardNodePrivateKey,
} from "../../scripts/aicard-runtime-token-provider.mts";

describe("AICardRuntimeTokenProvider", () => {
  it("includes a connected AI Card Agent in the current workspace", async () => {
    await closeServerRuntime();
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL
      ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
    process.env.YOYOO_LOCAL_OWNER_ID = `aicard-workspace-owner-${randomUUID()}`;
    process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";

    try {
      const runtime = await getServerRuntime();
      const principals = new PrincipalRepository(runtime.pool);
      const subject = `sub_${randomUUID().replaceAll("-", "").padEnd(43, "w").slice(0, 43)}`;
      const mapped = await principals.mapAICardIdentity({
        issuer: "http://127.0.0.1:3000",
        clientId: "yoyoo_dev",
        subject,
        cardId: `AI_${BigInt(Date.now()) * 1_000n + 7n}`,
        principalType: "ai",
        displayName: "Workspace AI Card Agent",
        handle: `workspace-agent-${randomUUID().slice(0, 8)}`,
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
      });
      await runtime.gateway.repository.authenticateAICardRuntime({
        issuer: "http://127.0.0.1:3000",
        clientId: "yoyoo_dev",
        subject,
        nodeId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await getCurrentWorkspace();
      const body = (await response.json()) as {
        agents: Array<{ principalId: string; adapterId: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.agents).toContainEqual(expect.objectContaining({
        principalId: mapped.principal.id,
        adapterId: "yoyoo-agent-gateway",
      }));

      const created = await runtime.collaboration.service.createRoom({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
        name: "AI Card membership candidate",
        idempotencyKey: randomUUID(),
      });
      const membershipResponse = await getRoomMembers(
        new Request(`http://localhost/api/v1/rooms/${created.room.id}/members`),
        { params: Promise.resolve({ roomId: created.room.id }) },
      );
      const membership = (await membershipResponse.json()) as {
        candidates: Array<{ principalId: string }>;
      };

      expect(membershipResponse.status).toBe(200);
      expect(membership.candidates).toContainEqual(expect.objectContaining({
        principalId: mapped.principal.id,
      }));
    } finally {
      await closeServerRuntime();
    }
  });

  it("lets the documented Node entrypoint reach startup validation", () => {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/run-aicard-yos-gateway-agent.mts")],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          AICARD_NODE_CREDENTIAL_FILE: "",
          AICARD_NODE_ID: "",
          AICARD_NODE_PRIVATE_KEY_FILE: "",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AICARD_NODE_ID is required");
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });

  it("signs the client-bound challenge and caches the short session", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const nodeId = randomUUID();
    const challengeId = randomUUID();
    const challenge = "c".repeat(43);
    const token = `at_${"t".repeat(43)}`;
    const expiresAt = new Date("2026-08-09T12:02:00.000Z");
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/challenge")) {
        return Response.json({
          challengeId,
          challenge,
          expiresAt: "2026-08-09T12:00:30.000Z",
        });
      }
      return Response.json({
        nodeId,
        connectionStatus: "connected",
        runtime: {
          subject: `sub_${"s".repeat(43)}`,
          nodeId,
          clientId: "yoyoo_dev",
          audience: "yoyoo",
          accessToken: token,
          tokenType: "Bearer",
          expiresIn: 120,
          expiresAt: expiresAt.toISOString(),
          scope: "agent.runtime",
        },
      });
    });
    const provider = new AICardRuntimeTokenProvider({
      issuer: "http://127.0.0.1:3000",
      nodeId,
      clientId: "yoyoo_dev",
      audience: "yoyoo",
      privateKey,
      fetcher,
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    });

    await expect(provider.getToken()).resolves.toBe(token);
    await expect(provider.getToken()).resolves.toBe(token);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests[0]).toMatchObject({
      url: "http://127.0.0.1:3000/api/v1/agent-nodes/challenge",
      body: { nodeId },
    });
    expect(requests[1]?.body).toMatchObject({
      nodeId,
      clientId: "yoyoo_dev",
      challengeId,
      challenge,
      signature: expect.any(String),
    });
    const payload = [
      "aicard-agent-runtime-v1",
      nodeId,
      "yoyoo_dev",
      challenge,
    ].join("\n");
    expect(verify(
      null,
      Buffer.from(payload, "utf8"),
      publicKey,
      Buffer.from(String(requests[1]?.body.signature), "base64url"),
    )).toBe(true);
  });

  it("fails closed when AI Card returns the wrong runtime audience", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const nodeId = randomUUID();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        challengeId: randomUUID(),
        challenge: "c".repeat(43),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }))
      .mockResolvedValueOnce(Response.json({
        nodeId,
        connectionStatus: "connected",
        runtime: {
          subject: `sub_${"s".repeat(43)}`,
          nodeId,
          clientId: "yoyoo_dev",
          audience: "another-platform",
          accessToken: `at_${"t".repeat(43)}`,
          tokenType: "Bearer",
          expiresIn: 120,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          scope: "agent.runtime",
        },
      }));
    const provider = new AICardRuntimeTokenProvider({
      issuer: "http://127.0.0.1:3000",
      nodeId,
      clientId: "yoyoo_dev",
      audience: "yoyoo",
      privateKey,
      fetcher,
    });

    await expect(provider.getToken()).rejects.toMatchObject({
      name: "AICardRuntimeProtocolError",
    });
  });

  it("does not expose a malformed provider response or returned token in errors", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const nodeId = randomUUID();
    const returnedToken = `at_${"q".repeat(43)}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        challengeId: randomUUID(),
        challenge: "c".repeat(43),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }))
      .mockResolvedValueOnce(Response.json({ accessToken: returnedToken }));
    const provider = new AICardRuntimeTokenProvider({
      issuer: "http://127.0.0.1:3000",
      nodeId,
      clientId: "yoyoo_dev",
      audience: "yoyoo",
      privateKey,
      fetcher,
    });

    const error = await provider.getToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "AICardRuntimeProtocolError" });
    expect(String(error)).not.toContain(returnedToken);
  });

  it("loads only an owner-readable Ed25519 private key file", () => {
    const directory = mkdtempSync(join(tmpdir(), "yoyoo-aicard-key-"));
    const path = join(directory, "node-private-key.pem");
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path, privateKey.export({ format: "pem", type: "pkcs8" }), {
      mode: 0o600,
    });

    try {
      expect(loadAICardNodePrivateKey(path).asymmetricKeyType).toBe("ed25519");
      chmodSync(path, 0o644);
      expect(() => loadAICardNodePrivateKey(path)).toThrow(
        "must not be readable by group or other users",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads the protected JSON produced by the AI Card enrollment client", () => {
    const directory = mkdtempSync(join(tmpdir(), "yoyoo-aicard-credential-"));
    const path = join(directory, "node-credential.json");
    const nodeId = randomUUID();
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path, JSON.stringify({
      version: 1,
      serviceUrl: "http://localhost:3000",
      cardId: `aic_${"a".repeat(22)}`,
      nodeId,
      machineName: "yoyoo-agent",
      claimId: randomUUID(),
      claimSecret: "s".repeat(43),
      publicKeySpki: "p".repeat(44),
      privateKeyPkcs8: privateKey.export({
        format: "der",
        type: "pkcs8",
      }).toString("base64url"),
    }), { mode: 0o600 });

    try {
      const loaded = loadAICardNodeCredential(path);
      expect(loaded.nodeId).toBe(nodeId);
      expect(loaded.privateKey.asymmetricKeyType).toBe("ed25519");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

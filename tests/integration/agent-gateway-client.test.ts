/** @vitest-environment node */

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  AgentGatewayClient,
  AgentGatewayProtocolError,
  runAgentGatewayOnce,
} from "../../scripts/agent-gateway-client.mts";
import { createYosGatewayHandler } from "../../scripts/run-yos-gateway-agent.mts";

const token = `yya_${"a".repeat(43)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("AgentGatewayClient", () => {
  it("loads in the same native Node runtime used by the reference bridge", () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "import('./scripts/agent-gateway-client.mts')"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("uses only the public heartbeat, claim, and result contract", async () => {
    const jobId = randomUUID();
    const leaseId = randomUUID();
    const runId = randomUUID();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (url.endsWith("/heartbeat")) return jsonResponse({ agent: {} });
      if (url.endsWith("/jobs/claim")) {
        return jsonResponse({
          job: {
            id: jobId,
            runId,
            principalId: randomUUID(),
            request: { runId, conversationId: randomUUID(), message: "hello" },
            status: "leased",
            leaseId,
            leasedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
            result: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            finishedAt: null,
          },
        });
      }
      return jsonResponse({ duplicate: false, job: { id: jobId } });
    });
    const client = new AgentGatewayClient({
      baseUrl: "https://yoyoo.example.test/",
      token,
      fetcher,
    });

    await client.heartbeat();
    await expect(
      runAgentGatewayOnce(client, async (job) => ({
        type: "completed",
        text: `reply:${(job.request as { message: string }).message}`,
      })),
    ).resolves.toBe(true);

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/v1/agent-gateway/heartbeat",
      "/api/v1/agent-gateway/jobs/claim",
      `/api/v1/agent-gateway/jobs/${jobId}/result`,
    ]);
    expect(calls.every((call) => new Headers(call.init.headers).get("authorization") === `Bearer ${token}`)).toBe(true);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      leaseId,
      result: { type: "completed", text: "reply:hello" },
    });
  });

  it("returns idle on 204 and never includes the credential in errors", async () => {
    const idleClient = new AgentGatewayClient({
      baseUrl: "http://127.0.0.1:4175",
      token,
      fetcher: vi.fn(async () => new Response(null, { status: 204 })),
    });
    await expect(runAgentGatewayOnce(idleClient, vi.fn())).resolves.toBe(false);

    const rejectedClient = new AgentGatewayClient({
      baseUrl: "http://127.0.0.1:4175",
      token,
      fetcher: vi.fn(async () => jsonResponse({ error: { code: "NO" } }, 401)),
    });
    const failure = await rejectedClient.heartbeat().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentGatewayProtocolError);
    expect(String(failure)).not.toContain(token);
  });

  it("accepts a rotating short-lived runtime token provider", async () => {
    const first = `at_${"a".repeat(43)}`;
    const second = `at_${"b".repeat(43)}`;
    const provideToken = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const headers: string[] = [];
    const client = new AgentGatewayClient({
      baseUrl: "http://127.0.0.1:4175",
      token: provideToken,
      fetcher: vi.fn(async (_input, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        return jsonResponse({ agent: {} });
      }),
    });

    await client.heartbeat();
    await client.heartbeat();

    expect(provideToken).toHaveBeenCalledTimes(2);
    expect(headers).toEqual([`Bearer ${first}`, `Bearer ${second}`]);
  });

  it("downloads only run-scoped Gateway resources with Bearer authentication", async () => {
    const attachmentId = randomUUID();
    const runId = randomUUID();
    const path = `/api/v1/agent-gateway/resources/${attachmentId}?runId=${runId}`;
    const requestHeaders: Headers[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestHeaders.push(new Headers(init?.headers));
      return new Response("private brief", {
        headers: { "content-type": "text/plain" },
      });
    });
    const client = new AgentGatewayClient({
      baseUrl: "https://yoyoo.example.test",
      token,
      fetcher,
    });

    const response = await client.fetchResource(path);

    await expect(response.text()).resolves.toBe("private brief");
    expect(fetcher).toHaveBeenCalledWith(
      `https://yoyoo.example.test${path}`,
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
    expect(requestHeaders[0].get("authorization")).toBe(`Bearer ${token}`);
    await expect(client.fetchResource("https://attacker.example/private"))
      .rejects.toThrow("resource path");
    await expect(client.fetchResource(`/api/v1/attachments/${attachmentId}`))
      .rejects.toThrow("resource path");
  });

  it("creates and uploads an Agent-produced resource before result submission", async () => {
    const runId = randomUUID();
    const attachmentId = randomUUID();
    const methods: string[] = [];
    const client = new AgentGatewayClient({
      baseUrl: "https://yoyoo.example.test",
      token,
      fetcher: vi.fn(async (_input, init) => {
        methods.push(init?.method ?? "GET");
        if (init?.method === "POST") {
          return jsonResponse({
            duplicate: false,
            attachment: { id: attachmentId },
          }, 201);
        }
        return jsonResponse({ attachment: { id: attachmentId } });
      }),
    });

    const resource = await client.createResource({
      runId,
      originalName: "result.md",
      declaredMediaType: "text/markdown",
      idempotencyKey: "result-v1",
    });
    await client.uploadResource(resource.attachment.id, "# Result");

    expect(resource).toMatchObject({ attachment: { id: attachmentId } });
    expect(methods).toEqual(["POST", "PUT"]);
  });
});

describe("YOS Gateway handler", () => {
  it("converts a terminal YOS event into a Gateway result", async () => {
    const handler = createYosGatewayHandler({
      descriptor: {
        id: "test-yos",
        displayName: "Test YOS",
        version: "1.0.0",
        capabilities: { streaming: false, cancellation: false },
      },
      async *run() {
        yield { sequence: 1, type: "status", status: "thinking" } as const;
        yield { sequence: 2, type: "completed", text: "YOS reply" } as const;
      },
    });
    const runId = randomUUID();

    await expect(
      handler(
        {
          id: randomUUID(),
          runId,
          principalId: randomUUID(),
          request: { runId, conversationId: randomUUID(), message: "hello" },
          leaseId: randomUUID(),
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ type: "completed", text: "YOS reply" });
  });

  it("fails visibly instead of dropping an attachment for unsupported YOS", async () => {
    const run = vi.fn();
    const handler = createYosGatewayHandler({
      descriptor: {
        id: "test-yos",
        displayName: "Test YOS",
        version: "1.0.0",
        capabilities: { streaming: false, cancellation: false },
      },
      run,
    });
    const runId = randomUUID();
    const attachmentId = randomUUID();
    const messageId = randomUUID();
    const humanId = randomUUID();
    const agentId = randomUUID();

    await expect(handler({
      id: randomUUID(),
      runId,
      principalId: agentId,
      leaseId: randomUUID(),
      request: {
        runId,
        workspaceId: randomUUID(),
        roomId: randomUUID(),
        triggerMessageId: messageId,
        triggerType: "message",
        message: "阅读附件",
        sender: { principalId: humanId, kind: "human", displayName: "Human" },
        members: [
          { principalId: humanId, kind: "human", displayName: "Human", listenerPolicy: "always" },
          { principalId: agentId, kind: "agent", displayName: "YOS", listenerPolicy: "mention_only" },
        ],
        mentionedPrincipalIds: [agentId],
        history: [],
        replyTo: null,
        threadRoot: null,
        attachments: [{
          attachmentId,
          messageId,
          originalName: "brief.txt",
          mediaType: "text/plain",
          sizeBytes: 10,
          sha256: "a".repeat(64),
          provenance: "human_upload",
          resource: {
            method: "GET",
            path: `/api/v1/agent-gateway/resources/${attachmentId}?runId=${runId}`,
          },
        }],
      },
    }, new AbortController().signal)).resolves.toMatchObject({
      type: "failed",
      error: { code: "ATTACHMENTS_NOT_SUPPORTED", retriable: false },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("bridges one authorized text attachment into the YOS request", async () => {
    const marker = `private-marker-${randomUUID()}`;
    const bytes = Buffer.from(marker, "utf8");
    const run = vi.fn(async function* (request: Record<string, unknown>) {
      yield {
        sequence: 1,
        type: "completed",
        text: String(request.message).includes(marker) ? "marker confirmed" : "marker missing",
      } as const;
    });
    const resourceClient = {
      fetchResource: vi.fn(async () => new Response(bytes, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      })),
    };
    const handler = createYosGatewayHandler({
      descriptor: {
        id: "test-yos",
        displayName: "Test YOS",
        version: "1.0.0",
        capabilities: { streaming: false, cancellation: false },
      },
      run,
    }, { resourceClient });
    const runId = randomUUID();
    const attachmentId = randomUUID();
    const messageId = randomUUID();
    const humanId = randomUUID();
    const agentId = randomUUID();
    const resourcePath = `/api/v1/agent-gateway/resources/${attachmentId}?runId=${runId}`;

    await expect(handler({
      id: randomUUID(),
      runId,
      principalId: agentId,
      leaseId: randomUUID(),
      request: {
        runId,
        workspaceId: randomUUID(),
        roomId: randomUUID(),
        triggerMessageId: messageId,
        triggerType: "message",
        message: "请读取附件中的唯一标记",
        sender: { principalId: humanId, kind: "human", displayName: "Human" },
        members: [
          { principalId: humanId, kind: "human", displayName: "Human", listenerPolicy: "always" },
          { principalId: agentId, kind: "agent", displayName: "YOS", listenerPolicy: "mention_only" },
        ],
        mentionedPrincipalIds: [agentId],
        history: [],
        replyTo: null,
        threadRoot: null,
        attachments: [{
          attachmentId,
          messageId,
          originalName: "brief.txt",
          mediaType: "text/plain",
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          provenance: "human_upload",
          resource: { method: "GET", path: resourcePath },
        }],
      },
    }, new AbortController().signal)).resolves.toEqual({
      type: "completed",
      text: "marker confirmed",
    });
    expect(resourceClient.fetchResource).toHaveBeenCalledWith(
      resourcePath,
      expect.any(AbortSignal),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(marker),
        attachments: [],
      }),
      expect.any(AbortSignal),
    );
  });

  it("rejects unsupported binary attachment media before contacting YOS", async () => {
    const run = vi.fn();
    const resourceClient = { fetchResource: vi.fn() };
    const handler = createYosGatewayHandler({
      descriptor: {
        id: "test-yos",
        displayName: "Test YOS",
        version: "1.0.0",
        capabilities: { streaming: false, cancellation: false },
      },
      run,
    }, { resourceClient });
    const runId = randomUUID();
    const attachmentId = randomUUID();
    const messageId = randomUUID();
    const humanId = randomUUID();
    const agentId = randomUUID();

    await expect(handler({
      id: randomUUID(),
      runId,
      principalId: agentId,
      leaseId: randomUUID(),
      request: {
        runId,
        workspaceId: randomUUID(),
        roomId: randomUUID(),
        triggerMessageId: messageId,
        triggerType: "message",
        message: "阅读附件",
        sender: { principalId: humanId, kind: "human", displayName: "Human" },
        members: [
          { principalId: humanId, kind: "human", displayName: "Human", listenerPolicy: "always" },
          { principalId: agentId, kind: "agent", displayName: "YOS", listenerPolicy: "mention_only" },
        ],
        mentionedPrincipalIds: [agentId],
        history: [],
        replyTo: null,
        threadRoot: null,
        attachments: [{
          attachmentId,
          messageId,
          originalName: "brief.pdf",
          mediaType: "application/pdf",
          sizeBytes: 32,
          sha256: "a".repeat(64),
          provenance: "human_upload",
          resource: {
            method: "GET",
            path: `/api/v1/agent-gateway/resources/${attachmentId}?runId=${runId}`,
          },
        }],
      },
    }, new AbortController().signal)).resolves.toMatchObject({
      type: "failed",
      error: { code: "ATTACHMENT_MEDIA_TYPE_UNSUPPORTED", retriable: false },
    });
    expect(resourceClient.fetchResource).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

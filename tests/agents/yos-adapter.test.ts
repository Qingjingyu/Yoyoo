/** @vitest-environment node */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { collectAgentEvents, type AgentRunRequest } from "@/agents/contract";
import { YosWebConsoleAdapter } from "@/agents/yos-adapter";

const request: AgentRunRequest = {
  runId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  message: "请回复这条消息",
};

const roomRequest: AgentRunRequest = {
  runId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  roomId: "33333333-3333-4333-8333-333333333333",
  triggerMessageId: "44444444-4444-4444-8444-444444444444",
  triggerType: "message",
  message: "请基于上一轮结论继续",
  sender: {
    principalId: "55555555-5555-4555-8555-555555555555",
    kind: "human",
    displayName: "Su Bai",
  },
  members: [
    {
      principalId: "55555555-5555-4555-8555-555555555555",
      kind: "human",
      displayName: "Su Bai",
      listenerPolicy: "always",
    },
    {
      principalId: "66666666-6666-4666-8666-666666666666",
      kind: "agent",
      displayName: "YOS",
      listenerPolicy: "mention_only",
    },
  ],
  mentionedPrincipalIds: ["66666666-6666-4666-8666-666666666666"],
  history: [
    {
      messageId: "77777777-7777-4777-8777-777777777777",
      senderPrincipalId: "88888888-8888-4888-8888-888888888888",
      senderKind: "agent",
      senderDisplayName: "Codex",
      content: "上一轮标记是 CODEX_SHARED_FACT。",
    },
  ],
  replyTo: null,
  threadRoot: null,
};

interface Fixture {
  baseUrl: string;
  close(): Promise<void>;
}

const fixtures: Fixture[] = [];

function json(res: ServerResponse, status: number, body: unknown, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function startFixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<Fixture> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error) => {
      json(res, 500, { error: error instanceof Error ? error.message : "fixture failure" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to listen");
  const fixture = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
  fixtures.push(fixture);
  return fixture;
}

function authenticated(req: IncomingMessage): boolean {
  return req.headers.cookie === "wc_session=test-session";
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("YosWebConsoleAdapter", () => {
  it("authenticates with a server-side cookie and reports available health", async () => {
    const seen: Array<{ method?: string; path?: string; cookie?: string }> = [];
    const fixture = await startFixture(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://fixture").pathname;
      seen.push({ method: req.method, path, cookie: req.headers.cookie });
      if (path === "/api/health") return json(res, 200, { status: "ok" });
      if (path === "/api/auth" && req.method === "GET") {
        return json(res, 200, { required: true, authenticated: authenticated(req) });
      }
      if (path === "/api/auth" && req.method === "POST") {
        const body = await readJson(req);
        if (body.password !== "local-secret") return json(res, 401, { error: "Wrong password" });
        return json(res, 200, { success: true }, { "set-cookie": "wc_session=test-session; Path=/; HttpOnly" });
      }
      if (path === "/api/status" && authenticated(req)) {
        return json(res, 200, { state: "idle" });
      }
      return json(res, 401, { error: "Authentication required" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      password: "local-secret",
    });

    await expect(adapter.health()).resolves.toEqual({ status: "available" });
    expect(adapter.descriptor.capabilities).toEqual({ streaming: false, cancellation: false });
    expect(seen.at(-1)).toMatchObject({ path: "/api/status", cookie: "wc_session=test-session" });
    expect(JSON.stringify(seen)).not.toContain("local-secret");
  });

  it("turns the first new outbound YOS message into an ordered terminal response", async () => {
    let pollCount = 0;
    let sentBody: Record<string, unknown> | undefined;
    const fixture = await startFixture(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      if (url.pathname === "/api/auth") {
        return json(res, 200, { required: false, authenticated: true });
      }
      if (url.pathname === "/api/conversations/recent") {
        return json(res, 200, [{ id: 41, direction: "out", content: "旧回复" }]);
      }
      if (url.pathname === "/api/send") {
        sentBody = await readJson(req);
        return json(res, 200, { success: true });
      }
      if (url.pathname === "/api/poll") {
        expect(url.searchParams.get("since_id")).toBe(pollCount === 0 ? "41" : "42");
        pollCount += 1;
        return pollCount === 1
          ? json(res, 200, [{ id: 42, direction: "in", content: request.message }])
          : json(res, 200, [{ id: 43, direction: "out", content: "YOS 已收到。" }]);
      }
      return json(res, 404, { error: "not found" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      pollIntervalMs: 1,
      responseTimeoutMs: 200,
    });

    const events = await collectAgentEvents(
      adapter.run(roomRequest, new AbortController().signal),
    );

    expect(sentBody?.message).toEqual(expect.stringContaining("Recent public room history"));
    expect(sentBody?.message).toEqual(expect.stringContaining("Codex (agent): 上一轮标记是 CODEX_SHARED_FACT。"));
    expect(sentBody?.message).toEqual(expect.stringContaining("Current message from Su Bai"));
    expect(sentBody?.message).toEqual(expect.stringContaining(roomRequest.message));
    expect(events).toEqual([
      { sequence: 1, type: "status", status: "running" },
      { sequence: 2, type: "status", status: "thinking" },
      { sequence: 3, type: "text_delta", delta: "YOS 已收到。" },
      { sequence: 4, type: "completed", text: "YOS 已收到。" },
    ]);
  });

  it("drains an unmatched earlier inbound message before sending the next request", async () => {
    const paths: string[] = [];
    let pollCount = 0;
    const fixture = await startFixture(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      paths.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/api/auth") {
        return json(res, 200, { required: false, authenticated: true });
      }
      if (url.pathname === "/api/conversations/recent") {
        return json(res, 200, [{ id: 7, direction: "in", content: "上一条请求" }]);
      }
      if (url.pathname === "/api/send") return json(res, 200, { success: true });
      if (url.pathname === "/api/poll") {
        pollCount += 1;
        if (pollCount === 1) {
          return json(res, 200, [{ id: 8, direction: "out", content: "上一条回复" }]);
        }
        return json(res, 200, [{ id: 9, direction: "out", content: "本轮回复" }]);
      }
      return json(res, 404, { error: "not found" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      pollIntervalMs: 1,
      responseTimeoutMs: 200,
    });

    const events = await collectAgentEvents(adapter.run(request, new AbortController().signal));

    expect(paths.indexOf("GET /api/poll")).toBeLessThan(paths.indexOf("POST /api/send"));
    expect(events.at(-1)).toEqual({
      sequence: 4,
      type: "completed",
      text: "本轮回复",
    });
  });

  it("stops before contacting YOS when the run is already aborted", async () => {
    let requests = 0;
    const fixture = await startFixture((_req, res) => {
      requests += 1;
      json(res, 500, { error: "should not be reached" });
    });
    const adapter = new YosWebConsoleAdapter({ baseUrl: fixture.baseUrl });
    const controller = new AbortController();
    controller.abort();

    await expect(collectAgentEvents(adapter.run(request, controller.signal))).resolves.toEqual([
      { sequence: 1, type: "stopped" },
    ]);
    expect(requests).toBe(0);
  });

  it("returns a retriable failure when YOS accepts a message but does not reply in time", async () => {
    const fixture = await startFixture(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      if (url.pathname === "/api/auth") return json(res, 200, { required: false, authenticated: true });
      if (url.pathname === "/api/conversations/recent") return json(res, 200, []);
      if (url.pathname === "/api/send") return json(res, 200, { success: true });
      if (url.pathname === "/api/poll") return json(res, 200, []);
      return json(res, 404, { error: "not found" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      pollIntervalMs: 2,
      responseTimeoutMs: 15,
    });

    const events = await collectAgentEvents(adapter.run(request, new AbortController().signal));

    expect(events.at(-1)).toEqual({
      sequence: 3,
      type: "failed",
      error: {
        code: "YOS_RESPONSE_TIMEOUT",
        message: "YOS did not reply before the response deadline",
        retriable: true,
      },
    });
  });

  it("keeps the default reply window open beyond 120 seconds", async () => {
    let pollCount = 0;
    let virtualNow = 0;
    const fixture = await startFixture(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      if (url.pathname === "/api/auth") {
        return json(res, 200, { required: false, authenticated: true });
      }
      if (url.pathname === "/api/conversations/recent") return json(res, 200, []);
      if (url.pathname === "/api/send") {
        vi.spyOn(Date, "now").mockImplementation(() => virtualNow);
        return json(res, 200, { success: true });
      }
      if (url.pathname === "/api/poll") {
        pollCount += 1;
        if (pollCount === 1) {
          virtualNow = 130_000;
          return json(res, 200, []);
        }
        return json(res, 200, [{ id: 1, direction: "out", content: "延迟回复" }]);
      }
      return json(res, 404, { error: "not found" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      pollIntervalMs: 1,
    });

    const events = await collectAgentEvents(adapter.run(request, new AbortController().signal));

    expect(pollCount).toBe(2);
    expect(events.at(-1)).toEqual({
      sequence: 4,
      type: "completed",
      text: "延迟回复",
    });
  });

  it("fails authentication without exposing the configured password", async () => {
    const fixture = await startFixture(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://fixture").pathname;
      if (path === "/api/auth" && req.method === "GET") {
        return json(res, 200, { required: true, authenticated: false });
      }
      if (path === "/api/auth" && req.method === "POST") {
        return json(res, 401, { error: "Wrong password: do-not-leak" });
      }
      return json(res, 404, { error: "not found" });
    });
    const adapter = new YosWebConsoleAdapter({
      baseUrl: fixture.baseUrl,
      password: "do-not-leak",
    });

    const events = await collectAgentEvents(adapter.run(request, new AbortController().signal));
    const serialized = JSON.stringify(events);

    expect(events).toEqual([
      {
        sequence: 1,
        type: "failed",
        error: {
          code: "YOS_AUTH_FAILED",
          message: "YOS Web Console authentication failed",
          retriable: false,
        },
      },
    ]);
    expect(serialized).not.toContain("do-not-leak");
  });
});

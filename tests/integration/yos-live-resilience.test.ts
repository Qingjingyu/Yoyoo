/** @vitest-environment node */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { expect, it } from "vitest";

import { collectAgentEvents } from "@/agents/contract";
import { YosWebConsoleAdapter } from "@/agents/yos-adapter";
import { ConversationRepository } from "@/server/postgres/conversation-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { RunRepository, type RunRecord } from "@/server/postgres/run-repository";

const liveEnabled = process.env.YOS_LIVE_RESILIENCE_TEST === "1";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

async function requestBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: string,
): Promise<void> {
  const body = await requestBody(request);
  const headers = new Headers();
  if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
  if (request.headers["content-type"]) {
    headers.set("content-type", request.headers["content-type"]);
  }
  const upstream = await fetch(`${target}${request.url ?? "/"}`, {
    method: request.method,
    headers,
    body,
  });
  response.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type");
  const cookie = upstream.headers.get("set-cookie");
  if (contentType) response.setHeader("content-type", contentType);
  if (cookie) response.setHeader("set-cookie", cookie);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Yoyoo acceptance process did not exit after SIGTERM"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopYoyoo(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child);
}

async function startYoyoo(ownerId: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(
    process.execPath,
    ["scripts/run-yos-next.mts", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
        YOYOO_LOCAL_OWNER_ID: ownerId,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4_000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-4_000);
  });
  let lastHttpResult = "No HTTP response received";

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Yoyoo acceptance process exited during startup\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/conversations/current`);
      if (response.ok) return child;
      lastHttpResult = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
    } catch {
      // The owned process is still starting; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopYoyoo(child);
  throw new Error(
    `Yoyoo acceptance process did not become ready\n${lastHttpResult}\n${output}`,
  );
}

async function waitForRun(
  runs: RunRepository,
  runId: string,
  predicate: (run: RunRecord) => boolean,
  timeoutMs = 180_000,
): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runs.get(runId);
    if (predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} did not reach the expected state`);
}

async function waitUntilYosAccepted(
  runs: RunRepository,
  runId: string,
  timeoutMs = 190_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await runs.listEvents(runId);
    if (events.some((entry) => entry.event.type === "status")) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} was not accepted by YOS before the deadline`);
}

it.runIf(liveEnabled)("exposes a retriable failure when polling is cut after YOS accepts a message", async () => {
  const target = process.env.YOS_WEB_CONSOLE_URL;
  if (!target) throw new Error("YOS_WEB_CONSOLE_URL is required for the resilience test");
  let accepted = false;
  const proxy = createServer(async (request, response) => {
    try {
      if (accepted && request.url?.startsWith("/api/poll")) {
        response.socket?.destroy();
        return;
      }
      await proxyRequest(request, response, target);
      if (request.url === "/api/send" && response.statusCode < 400) accepted = true;
    } catch {
      if (!response.destroyed) response.destroy();
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  try {
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Proxy failed to listen");
    const adapter = new YosWebConsoleAdapter({
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: process.env.YOS_WEB_PASSWORD,
      pollIntervalMs: 20,
      responseTimeoutMs: 30_000,
    });
    const marker = `YOS_NETWORK_CUT_${randomUUID().slice(0, 8)}`;
    const events = await collectAgentEvents(adapter.run({
      runId: randomUUID(),
      conversationId: randomUUID(),
      message: `Yoyoo 链路中断验收。请只回复：${marker}`,
    }, new AbortController().signal));

    expect(accepted).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "YOS_CONNECTION_FAILED", retriable: true },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
    });
  }
}, 190_000);

it.runIf(liveEnabled)("reconciles an accepted run after restart and completes its retry", async () => {
  const ownerId = `yos-restart-${randomUUID()}`;
  const marker = `YOS_RESTART_RETRY_${randomUUID().slice(0, 8)}`;
  const content = `Yoyoo 重启恢复验收。请只回复：${marker}`;
  const port = 4175;
  const pool = createPostgresPool(databaseUrl, { max: 2 });
  const runs = new RunRepository(pool);
  const conversations = new ConversationRepository(pool);
  let service: ChildProcessWithoutNullStreams | undefined;

  try {
    service = await startYoyoo(ownerId, port);
    const submissionResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/conversations/current/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ content }),
      },
    );
    expect(submissionResponse.status).toBe(202);
    const submission = await submissionResponse.json() as { run: { id: string } };

    await waitUntilYosAccepted(runs, submission.run.id);
    await stopYoyoo(service);
    service = undefined;

    service = await startYoyoo(ownerId, port);
    const interrupted = await waitForRun(
      runs,
      submission.run.id,
      (run) => run.status === "failed",
      30_000,
    );
    expect(interrupted.errorCode).toBe("PROCESS_RESTARTED");

    const retryResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/runs/${submission.run.id}/retry`,
      { method: "POST", headers: { "Idempotency-Key": randomUUID() } },
    );
    expect(retryResponse.status).toBe(202);
    const retry = await retryResponse.json() as { run: { id: string } };
    const completed = await waitForRun(
      runs,
      retry.run.id,
      (run) => ["completed", "failed", "stopped"].includes(run.status),
    );
    expect(completed.status).toBe("completed");

    const conversation = await conversations.getOrCreateCurrent(ownerId, "yos-web-console");
    const messages = await conversations.listMessages(conversation.id);
    expect(messages.filter(
      (message) => message.senderType === "human" && message.content === content,
    )).toHaveLength(1);
    expect(messages).toContainEqual(expect.objectContaining({
      senderType: "agent",
      content: expect.stringContaining(marker),
      status: "completed",
    }));
  } finally {
    if (service) await stopYoyoo(service);
    await pool.end();
  }
}, 220_000);

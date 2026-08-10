/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getCurrent } from "@/app/api/v1/conversations/current/route";
import { GET as getEvents } from "@/app/api/v1/conversations/current/events/route";
import { POST as postMessage } from "@/app/api/v1/conversations/current/messages/route";
import { POST as cancelRun } from "@/app/api/v1/runs/[runId]/cancel/route";
import { POST as retryRun } from "@/app/api/v1/runs/[runId]/retry/route";
import {
  closeServerRuntime,
  getLocalOwnerId,
  getServerRuntime,
} from "@/server/runtime";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

interface SubmissionBody {
  duplicate: boolean;
  message: { id: string; content: string };
  run: { id: string; status: string };
}

function messageRequest(content: string, idempotencyKey?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request("http://localhost/api/v1/conversations/current/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
}

async function submit(content: string, key = randomUUID()) {
  const response = await postMessage(messageRequest(content, key));
  return { response, body: (await response.json()) as SubmissionBody };
}

async function readEventStream(runId: string, lastEventId?: number) {
  const headers = new Headers();
  if (lastEventId !== undefined) headers.set("Last-Event-ID", String(lastEventId));
  const response = await getEvents(
    new Request(
      `http://localhost/api/v1/conversations/current/events?runId=${runId}`,
      { headers },
    ),
  );
  return { response, text: await response.text() };
}

beforeAll(() => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `http-test-owner-${randomUUID()}`;
  process.env.YOYOO_TEST_AGENT_DELAY_MS = "45";
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("conversation HTTP boundary", () => {
  it("returns structured validation errors for missing keys, empty text, and oversized text", async () => {
    const missingKey = await postMessage(messageRequest("有效内容"));
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toEqual({
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: expect.any(String),
      },
    });

    const empty = await postMessage(messageRequest("   ", randomUUID()));
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });

    const oversized = await postMessage(messageRequest("x".repeat(1201), randomUUID()));
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("returns one submission for repeated idempotency keys", async () => {
    const key = randomUUID();
    const first = await submit(`幂等消息 ${key}`, key);
    const second = await submit(`幂等消息 ${key}`, key);

    expect(first.response.status).toBe(202);
    expect(second.response.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(second.body.run.id).toBe(first.body.run.id);

    await readEventStream(first.body.run.id);
  });

  it("streams ordered persisted events and resumes after Last-Event-ID", async () => {
    const { body } = await submit(`SSE ${randomUUID()}`);
    const full = await readEventStream(body.run.id);

    expect(full.response.status).toBe(200);
    expect(full.response.headers.get("content-type")).toContain("text/event-stream");
    expect(full.text).toContain("id: 1");
    expect(full.text).toContain("event: status");
    expect(full.text).toContain("event: text_delta");
    expect(full.text).toContain("event: completed");

    const resumed = await readEventStream(body.run.id, 2);
    expect(resumed.text).not.toContain("id: 1\n");
    expect(resumed.text).not.toContain("id: 2\n");
    expect(resumed.text).toContain("id: 3");
    expect(resumed.text).toContain("event: completed");
  });

  it("cancels a live run and exposes a stopped terminal event", async () => {
    const { body } = await submit(`取消 ${randomUUID()}`);
    const response = await cancelRun(new Request("http://localhost"), {
      params: Promise.resolve({ runId: body.run.id }),
    });
    expect(response.status).toBe(202);

    const stream = await readEventStream(body.run.id);
    expect(stream.text).toContain("event: stopped");
    expect(stream.text).not.toContain("event: completed");
  });

  it("restores persisted messages through the current conversation resource", async () => {
    const content = `刷新后仍存在 ${randomUUID()}`;
    const { body } = await submit(content);
    await readEventStream(body.run.id);

    const response = await getCurrent();
    const snapshot = (await response.json()) as {
      messages: Array<{ content: string; senderType: string }>;
    };
    expect(response.status).toBe(200);
    expect(snapshot.messages).toContainEqual(
      expect.objectContaining({ content, senderType: "human" }),
    );
    expect(snapshot.messages).toContainEqual(
      expect.objectContaining({ senderType: "agent" }),
    );
  });

  it("retries a failed run without creating a second human message", async () => {
    const runtime = await getServerRuntime();
    const conversation = await runtime.conversations.getOrCreateCurrent(
      getLocalOwnerId(),
      runtime.agentId,
    );
    const failed = await runtime.conversations.createSubmission({
      conversationId: conversation.id,
      adapterId: runtime.agentId,
      content: `HTTP retry ${randomUUID()}`,
      idempotencyKey: randomUUID(),
    });
    await runtime.runs.claim(failed.run.id);
    await runtime.runs.appendEvent(failed.run.id, {
      sequence: 1,
      type: "failed",
      error: { code: "TEST_FAILURE", message: "Test failure", retriable: true },
    });

    const retryKey = randomUUID();
    const retryRequest = () =>
      new Request("http://localhost", {
        method: "POST",
        headers: { "Idempotency-Key": retryKey },
      });
    const response = await retryRun(retryRequest(), {
      params: Promise.resolve({ runId: failed.run.id }),
    });
    const retried = (await response.json()) as {
      duplicate: boolean;
      run: { id: string };
    };
    expect(response.status).toBe(202);
    expect(retried.duplicate).toBe(false);
    expect(retried.run.id).not.toBe(failed.run.id);

    const repeatedResponse = await retryRun(retryRequest(), {
      params: Promise.resolve({ runId: failed.run.id }),
    });
    const repeated = (await repeatedResponse.json()) as {
      duplicate: boolean;
      run: { id: string };
    };
    expect(repeatedResponse.status).toBe(200);
    expect(repeated.duplicate).toBe(true);
    expect(repeated.run.id).toBe(retried.run.id);
    await readEventStream(retried.run.id);

    const messages = await runtime.conversations.listMessages(conversation.id);
    expect(
      messages.filter(
        (message) => message.senderType === "human" && message.content === failed.message.content,
      ),
    ).toHaveLength(1);
  });
});

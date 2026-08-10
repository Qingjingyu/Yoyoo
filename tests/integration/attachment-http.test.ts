/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as beginAttachment } from "@/app/api/v1/attachments/route";
import { PUT as uploadAttachment } from "@/app/api/v1/attachments/[attachmentId]/route";
import { GET as getAttachmentContent } from "@/app/api/v1/attachments/[attachmentId]/content/route";
import { GET as getRoom } from "@/app/api/v1/rooms/[roomId]/route";
import { POST as createRoom } from "@/app/api/v1/rooms/route";
import { POST as postMessage } from "@/app/api/v1/rooms/[roomId]/messages/route";
import { closeServerRuntime } from "@/server/runtime";

function context(name: string, value: string) {
  return { params: Promise.resolve({ [name]: value }) } as never;
}

async function newRoom(): Promise<string> {
  const response = await createRoom(
    new Request("http://localhost/api/v1/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ name: `附件测试 ${randomUUID().slice(0, 6)}` }),
    }),
  );
  const body = (await response.json()) as { room: { id: string } };
  return body.room.id;
}

describe("attachment HTTP flow", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
    process.env.YOYOO_BLOB_ROOT = `/tmp/yoyoo-http-${randomUUID()}`;
    await closeServerRuntime();
  });

  afterAll(async () => {
    await closeServerRuntime();
    delete process.env.YOYOO_BLOB_ROOT;
    delete process.env.DATABASE_URL;
  });

  it("uploads idempotently, sends an attachment-only message, and refreshes metadata", async () => {
    const roomId = await newRoom();
    const idempotencyKey = randomUUID();
    const beginRequest = () => new Request("http://localhost/api/v1/attachments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ originalName: "计划.txt", declaredMediaType: "text/plain" }),
    });
    const firstResponse = await beginAttachment(beginRequest());
    const repeatedResponse = await beginAttachment(beginRequest());
    const first = (await firstResponse.json()) as {
      duplicate: boolean;
      attachment: { id: string; objectKey?: string; status: string };
    };
    const repeated = (await repeatedResponse.json()) as typeof first;

    expect(firstResponse.status).toBe(201);
    expect(repeatedResponse.status).toBe(200);
    expect(repeated.attachment.id).toBe(first.attachment.id);
    expect(first.attachment).not.toHaveProperty("objectKey");

    const bytes = Buffer.from("Yoyoo private attachment");
    const uploadedResponse = await uploadAttachment(
      new Request(`http://localhost/api/v1/attachments/${first.attachment.id}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
      context("attachmentId", first.attachment.id),
    );
    const uploaded = (await uploadedResponse.json()) as {
      attachment: { id: string; objectKey?: string; sizeBytes: number; status: string };
    };
    expect(uploadedResponse.status).toBe(200);
    expect(uploaded.attachment).toMatchObject({
      id: first.attachment.id,
      sizeBytes: bytes.byteLength,
      status: "ready",
    });
    expect(uploaded.attachment).not.toHaveProperty("objectKey");

    const messageResponse = await postMessage(
      new Request(`http://localhost/api/v1/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          content: "",
          mentionedPrincipalIds: [],
          attachmentIds: [first.attachment.id],
        }),
      }),
      context("roomId", roomId),
    );
    expect(messageResponse.status).toBe(202);

    const snapshotResponse = await getRoom(
      new Request(`http://localhost/api/v1/rooms/${roomId}`),
      context("roomId", roomId),
    );
    const snapshot = (await snapshotResponse.json()) as {
      attachments: Array<{ id: string; messageId: string; objectKey?: string }>;
      messages: Array<{ id: string; content: string }>;
    };
    expect(snapshot.attachments).toContainEqual(
      expect.objectContaining({ id: first.attachment.id }),
    );
    expect(snapshot.attachments[0]).not.toHaveProperty("objectKey");
    expect(snapshot.messages).toContainEqual(expect.objectContaining({ content: "" }));

    const contentResponse = await getAttachmentContent(
      new Request(
        `http://localhost/api/v1/attachments/${first.attachment.id}/content?roomId=${roomId}`,
      ),
      context("attachmentId", first.attachment.id),
    );
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("text/plain");
    expect(contentResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(contentResponse.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(bytes);

    const rangeResponse = await getAttachmentContent(
      new Request(
        `http://localhost/api/v1/attachments/${first.attachment.id}/content?roomId=${roomId}`,
        { headers: { Range: "bytes=2-6" } },
      ),
      context("attachmentId", first.attachment.id),
    );
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("content-range")).toBe(
      `bytes 2-6/${bytes.byteLength}`,
    );
    expect(Buffer.from(await rangeResponse.arrayBuffer())).toEqual(bytes.subarray(2, 7));

    const deniedResponse = await getAttachmentContent(
      new Request(
        `http://localhost/api/v1/attachments/${first.attachment.id}/content?roomId=${randomUUID()}`,
      ),
      context("attachmentId", first.attachment.id),
    );
    expect(deniedResponse.status).toBe(404);
  });

  it("rejects a textless message when it has no attachment", async () => {
    const roomId = await newRoom();
    const response = await postMessage(
      new Request(`http://localhost/api/v1/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ content: "", mentionedPrincipalIds: [], attachmentIds: [] }),
      }),
      context("roomId", roomId),
    );
    expect(response.status).toBe(400);
  });
});

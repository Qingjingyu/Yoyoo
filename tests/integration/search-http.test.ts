/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as search } from "@/app/api/v1/search/route";
import { GET as listRoomFiles } from "@/app/api/v1/rooms/[roomId]/files/route";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `search-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("authorized search and room files", () => {
  it("searches visible message text and filenames with stable pagination", async () => {
    const runtime = await getServerRuntime();
    const rooms = new RoomRepository(runtime.pool);
    const marker = `needle-${randomUUID()}`;
    const first = await rooms.createMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      kind: "message",
      content: `${marker} first message`,
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    await rooms.createMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      kind: "message",
      content: `${marker} second message`,
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    const pending = await runtime.attachments.service.beginUpload({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      idempotencyKey: randomUUID(),
      originalName: `${marker}-brief.txt`,
      declaredMediaType: "text/plain",
    });
    const ready = await runtime.attachments.service.completeUpload({
      attachmentId: pending.attachment.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      source: (async function* () { yield Buffer.from("search file"); })(),
    });
    await runtime.attachments.repository.linkReadyToMessage({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      roomId: runtime.collaboration.bootstrap.room.id,
      messageId: first.message.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      attachmentIds: [ready.id],
    });

    const firstPage = await search(new Request(
      `http://localhost/api/v1/search?q=${encodeURIComponent(marker)}&limit=1`,
    ));
    const firstBody = (await firstPage.json()) as {
      results: Array<{ id: string; roomId: string; messageId: string }>;
      nextCursor: string | null;
    };
    expect(firstPage.status).toBe(200);
    expect(firstBody.results).toHaveLength(1);
    expect(firstBody.nextCursor).toBeTruthy();
    const secondPage = await search(new Request(
      `http://localhost/api/v1/search?q=${encodeURIComponent(marker)}&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    ));
    const secondBody = (await secondPage.json()) as typeof firstBody;
    expect(secondBody.results).toHaveLength(1);
    expect(secondBody.results[0].id).not.toBe(firstBody.results[0].id);

    const filesOnly = await search(new Request(
      `http://localhost/api/v1/search?q=${encodeURIComponent(marker)}&category=file`,
    ));
    const filesBody = (await filesOnly.json()) as {
      results: Array<{ id: string; kind: string; messageId: string; text: string }>;
    };
    expect(filesBody.results).toEqual([
      expect.objectContaining({
        id: ready.id,
        kind: "file",
        messageId: first.message.id,
        text: `${marker}-brief.txt`,
      }),
    ]);
    expect(JSON.stringify(filesBody)).not.toContain(ready.objectKey);

    await rooms.retractMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      messageId: first.message.id,
      actorPrincipalId: runtime.collaboration.bootstrap.principal.id,
      expectedRevisionNumber: 1,
    });
    const afterRetraction = await search(new Request(
      `http://localhost/api/v1/search?q=${encodeURIComponent(`${marker}-brief.txt`)}&category=file`,
    ));
    await expect(afterRetraction.json()).resolves.toMatchObject({ results: [] });
    await expect(runtime.attachments.repository.getForRoomMember({
      attachmentId: ready.id,
      roomId: runtime.collaboration.bootstrap.room.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
    })).resolves.toBeNull();
    await expect(runtime.search.listRoomFiles({
      roomId: runtime.collaboration.bootstrap.room.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
    })).resolves.not.toContainEqual(expect.objectContaining({ id: ready.id }));
    await expect(runtime.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM message_attachments WHERE attachment_id = $1",
      [ready.id],
    )).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("lists categorized room files and denies a non-member", async () => {
    const runtime = await getServerRuntime();
    const response = await listRoomFiles(
      new Request("http://localhost"),
      { params: Promise.resolve({ roomId: runtime.collaboration.bootstrap.room.id }) },
    );
    const body = (await response.json()) as {
      files: Array<{ category: string; roomId: string; messageId: string }>;
    };
    expect(response.status).toBe(200);
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.every((file) => file.roomId === runtime.collaboration.bootstrap.room.id))
      .toBe(true);

    const outsider = await new PrincipalRepository(runtime.pool).create({
      kind: "human",
      externalKey: `human:search-outsider-${randomUUID()}`,
      handle: `outsider-${randomUUID().slice(0, 8)}`,
      displayName: "Search Outsider",
    });
    await expect(runtime.search.listRoomFiles({
      roomId: runtime.collaboration.bootstrap.room.id,
      principalId: outsider.id,
    })).rejects.toThrow("not found");
  });

  it("rejects unbounded or malformed search input", async () => {
    const empty = await search(new Request("http://localhost/api/v1/search?q="));
    expect(empty.status).toBe(400);
    const long = await search(new Request(
      `http://localhost/api/v1/search?q=${"x".repeat(201)}`,
    ));
    expect(long.status).toBe(400);
    const invalidRange = await search(new Request(
      "http://localhost/api/v1/search?q=test&from=2026-08-10&to=2026-08-01",
    ));
    expect(invalidRange.status).toBe(400);
  });
});

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoomClient } from "@/lib/room-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RoomClient", () => {
  it("creates a named room with a stable idempotency key", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          duplicate: false,
          room: { id: "room-2", name: "产品发布室" },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createRoomClient({ fetcher });

    await client.createRoom("产品发布室", "room-key");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rooms",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "room-key" }),
        body: JSON.stringify({ name: "产品发布室" }),
      }),
    );
  });

  it("renames and changes room lifecycle through PATCH", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "room-1", name: "新名称", status: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createRoomClient({ fetcher });

    await client.renameRoom("room-1", "新名称");
    await client.setRoomStatus("room-1", "archived");
    await client.setRoomStatus("room-1", "active");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/rooms/room-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "新名称" }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/rooms/room-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "archived" }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/rooms/room-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    );
  });

  it("updates room purpose and personal list state", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "room-1", purpose: "项目协作" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createRoomClient({ fetcher });

    await client.setRoomPurpose("room/1", "项目协作");
    await client.updateRoomListState("room/1", "pin");
    await client.updateRoomListState("room/1", "hide");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/rooms/room%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ purpose: "项目协作" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/rooms/room%2F1/list-state",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "pin" }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/rooms/room%2F1/list-state",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "hide" }) }),
    );
  });

  it("loads and mutates room membership through room-scoped endpoints", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ member: { principalId: "agent-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createRoomClient({ fetcher });

    await client.getRoomMembers("room/1");
    await client.addRoomMember("room/1", "agent/1");
    await client.removeRoomMember("room/1", "agent/1");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/rooms/room%2F1/members",
      undefined,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/rooms/room%2F1/members",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ principalId: "agent/1" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/v1/rooms/room%2F1/members/agent%2F1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends selected Agent mentions with a stable idempotency key", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          duplicate: false,
          message: { id: "message-1", content: "一起分析" },
          runs: [],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createRoomClient({ fetcher });

    await client.sendMessage("room-1", {
      content: "一起分析",
      mentionedPrincipalIds: ["planner", "reviewer"],
      idempotencyKey: "message-key",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rooms/room-1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "message-key" }),
        body: JSON.stringify({
          content: "一起分析",
          mentionedPrincipalIds: ["planner", "reviewer"],
        }),
      }),
    );
  });

  it("calls room-scoped intervention and retry endpoints", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith("/retry")
            ? { duplicate: false, run: { id: "retry-1", status: "queued" } }
            : { runId: "run-1", status: "stopping" },
        ),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    });
    const client = createRoomClient({ fetcher });

    await client.intervene("room-1", "run-1", "请先停止", "stop-key");
    await client.retryRun("room-1", "run-1", "retry-key");

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/rooms/room-1/runs/run-1/intervene",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/rooms/room-1/runs/run-1/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("edits and retracts a message with optimistic revision guards", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ message: { id: "message-1", revisionNumber: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createRoomClient({ fetcher });

    await client.editMessage("room/1", "message/1", "更新内容", 1);
    await client.retractMessage("room/1", "message/1", 2);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/rooms/room%2F1/messages/message%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ content: "更新内容", expectedRevisionNumber: 1 }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/rooms/room%2F1/messages/message%2F1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedRevisionNumber: 2 }),
      }),
    );
  });
});

/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import { createRunEventResponse } from "@/server/event-stream";
import type { RunRepository, StoredRunEvent } from "@/server/postgres/run-repository";

describe("run event stream", () => {
  it("drains a newly committed terminal event before closing a terminal run", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const now = new Date();
    const batches: StoredRunEvent[][] = [
      [{
        runId,
        sequence: 1,
        event: { sequence: 1, type: "status", status: "running" },
        createdAt: now,
      }],
      [{
        runId,
        sequence: 2,
        event: { sequence: 2, type: "completed", text: "最终回复" },
        createdAt: now,
      }],
    ];
    const listEvents = vi.fn(async () => batches.shift() ?? []);
    const runs = {
      listEvents,
      get: vi.fn(async () => ({ status: "completed" })),
    } as unknown as RunRepository;

    const response = createRunEventResponse(
      runs,
      runId,
      0,
      new AbortController().signal,
    );
    const text = await response.text();

    expect(text).toContain("event: status");
    expect(text).toContain("event: completed");
    expect(text).toContain("最终回复");
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});

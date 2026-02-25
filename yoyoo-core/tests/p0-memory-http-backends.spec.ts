import { describe, expect, it, vi } from "vitest";
import {
  createHttpJsonMemoryBackend,
  createInMemoryMemoryBackend,
  createMemoryService,
} from "../src/memory-abstraction";

describe("p0 memory http backends", () => {
  it("uses configured endpoints and parses append/list payload", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "r-1",
          text: "hello",
          createdAt: 1700000000000,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "r-1",
              text: "hello",
              createdAt: 1700000000000,
            },
          ],
        }),
      });

    const backend = createHttpJsonMemoryBackend({
      kind: "memu",
      baseUrl: "http://127.0.0.1:3301",
      appendPath: "/api/memory/append",
      listPath: "/api/memory/list",
      fetcher,
    });

    const appended = await backend.append("user:u1", "hello");
    const listed = await backend.list("user:u1", 10);

    expect(appended.id).toBe("r-1");
    expect(listed.length).toBe(1);
    expect(listed[0]?.text).toBe("hello");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3301/api/memory/append",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3301/api/memory/list",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("checks health endpoint and returns unavailable on failure", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    const backend = createHttpJsonMemoryBackend({
      kind: "letta",
      baseUrl: "http://127.0.0.1:4401",
      healthPath: "/healthz",
      fetcher,
    });

    const up = await backend.available?.();
    expect(up).toBe(false);
  });

  it("falls back to local backend when remote backend throws at runtime", async () => {
    const remote = createHttpJsonMemoryBackend({
      kind: "memu",
      baseUrl: "http://127.0.0.1:3301",
      fetcher: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    const local = createInMemoryMemoryBackend("local");
    const service = createMemoryService({
      backend: "memu",
      adapters: {
        memu: remote,
        local,
      },
    });

    await service.append("user:u2", "fallback-text");
    const out = await service.list("user:u2");

    expect(service.backendKind()).toBe("memu");
    expect(out[0]?.text).toBe("fallback-text");
  });
});

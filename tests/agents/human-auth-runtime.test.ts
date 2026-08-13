import { describe, expect, it, vi } from "vitest";

import { createHumanAuthHealthCheck } from "@/server/auth/human-auth-runtime";

describe("human auth runtime health", () => {
  it("treats a reachable database as healthy without requiring a local password credential", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });

    await expect(createHumanAuthHealthCheck({ query })()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("reports an unreachable database as unavailable", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(createHumanAuthHealthCheck({ query })()).resolves.toBe(false);
  });
});

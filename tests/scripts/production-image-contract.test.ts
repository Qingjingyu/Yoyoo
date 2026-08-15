/** @vitest-environment node */

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("production image contract", () => {
  it("ships the guarded AI Card owner finalizer used by the release runbook", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");

    expect(dockerfile).toContain(
      "COPY --from=builder --chown=nextjs:nodejs /app/scripts/finalize-aicard-owner-cutover.mts ./scripts/finalize-aicard-owner-cutover.mts",
    );
  });
});

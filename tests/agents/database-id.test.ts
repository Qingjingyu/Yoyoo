import { describe, expect, it } from "vitest";

import { databaseIdSchema } from "@/domain/id";

describe("databaseIdSchema", () => {
  it("accepts PostgreSQL UUID values produced by legacy deterministic migrations", () => {
    expect(
      databaseIdSchema.parse("ca6dfb20-8a88-88d7-00f3-72201c6f19ed"),
    ).toBe("ca6dfb20-8a88-88d7-00f3-72201c6f19ed");
  });

  it("still rejects non-GUID identifiers", () => {
    expect(databaseIdSchema.safeParse("not-an-id").success).toBe(false);
  });
});

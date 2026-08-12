import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUBLIC_OWNER_KEY,
  publicOwnerKey,
} from "../../scripts/bootstrap-public-workspace.mts";

describe("public workspace bootstrap contract", () => {
  it("uses one stable owner key when the environment is omitted", () => {
    expect(DEFAULT_PUBLIC_OWNER_KEY).toBe("local-owner-ui");
    expect(publicOwnerKey(undefined)).toBe("local-owner-ui");
  });

  it("rejects unstable or unsafe owner keys", () => {
    expect(() => publicOwnerKey("x")).toThrow("stable 3-80 character key");
    expect(() => publicOwnerKey("owner with spaces")).toThrow(
      "stable 3-80 character key",
    );
  });
});

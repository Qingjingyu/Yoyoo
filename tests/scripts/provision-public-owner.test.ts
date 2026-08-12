import { describe, expect, it } from "vitest";

import {
  PUBLIC_OWNER_AI_CARD_ID,
  ownerLoginHandle,
} from "../../scripts/provision-public-owner.mts";

describe("public owner provisioning contract", () => {
  it("binds the memorable first AI Card ID to one normalized login handle", () => {
    expect(PUBLIC_OWNER_AI_CARD_ID).toBe("AI_100001");
    expect(ownerLoginHandle()).toBe("ai_100001");
  });

  it("rejects identities outside the public AI Card ID namespace", () => {
    expect(() => ownerLoginHandle("aic_01K2F7M8")).toThrow(
      "Public owner AI Card ID is invalid",
    );
  });
});

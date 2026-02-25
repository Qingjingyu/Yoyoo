import { describe, expect, it } from "vitest";
import { createYoyooCore } from "../src/index";

describe("yoyoo core scaffold", () => {
  it("exports createYoyooCore", () => {
    expect(typeof createYoyooCore).toBe("function");
  });
});

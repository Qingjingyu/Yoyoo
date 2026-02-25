import { describe, expect, it } from "vitest";
import { buildRetrievalInstruction } from "../src/retrieval";

describe("retrieval policy", () => {
  it("enables retrieval-first when qmd-local-search is available", () => {
    const msg = buildRetrievalInstruction(["qmd-local-search"]);
    expect(msg?.includes("先检索")).toBe(true);
  });

  it("returns null when qmd-local-search is absent", () => {
    const msg = buildRetrievalInstruction(["other-skill"]);
    expect(msg).toBeNull();
  });

  it("is case-insensitive", () => {
    const msg = buildRetrievalInstruction(["QMD-LOCAL-SEARCH"]);
    expect(msg).toBeTruthy();
  });
});

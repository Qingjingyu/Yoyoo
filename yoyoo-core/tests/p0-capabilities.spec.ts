import { describe, expect, it } from "vitest";
import {
  getP0Capabilities,
  nextP0Capability,
  type P0CapabilityId,
} from "../src/p0-capabilities";

describe("p0 capability map", () => {
  it("defines four P0 capabilities in fixed order", () => {
    const items = getP0Capabilities();
    expect(items).toHaveLength(4);
    expect(items.map((x) => x.id)).toEqual([
      "p0-1-openclaw-execution",
      "p0-2-qmd-retrieval",
      "p0-3-evolver-evolution",
      "p0-4-memu-letta-memory",
    ]);
    expect(items.every((x) => x.landingTarget === "yoyoo-core")).toBe(true);
  });

  it("keeps required learning sources for evolver/evomap", () => {
    const item = getP0Capabilities().find(
      (x) => x.id === "p0-3-evolver-evolution",
    );
    expect(item).toBeTruthy();
    expect(item?.sources).toEqual(
      expect.arrayContaining([
        "https://evomap.ai/skill.md",
        "https://evomap.ai/wiki",
        "https://evomap.ai/blog",
        "https://github.com/autogame-17/evolver",
      ]),
    );
  });

  it("returns next pending capability by order", () => {
    const done: Partial<Record<P0CapabilityId, boolean>> = {
      "p0-1-openclaw-execution": true,
      "p0-2-qmd-retrieval": true,
    };
    const next = nextP0Capability(done);
    expect(next?.id).toBe("p0-3-evolver-evolution");
  });
});


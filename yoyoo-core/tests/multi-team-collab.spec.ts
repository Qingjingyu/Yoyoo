import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMultiTeamCollaboration } from "../src/multi-team-collab";

describe("multi-team collaboration", () => {
  it("dispatches objective to default roles and merges report", async () => {
    const called: string[] = [];
    const out = await runMultiTeamCollaboration({
      objective: "把本地 Yoyoo 验收流程做成一键脚本",
      runAgent: async ({ role }) => {
        called.push(role);
        return `${role}-done`;
      },
    });

    expect(out.roles).toEqual(["coder", "writer", "growth"]);
    expect(called).toEqual(["coder", "writer", "growth"]);
    expect(out.results).toHaveLength(3);
    expect(out.mergedReport).toContain("coder-done");
    expect(out.mergedReport).toContain("writer-done");
    expect(out.mergedReport).toContain("growth-done");
  });

  it("writes role summaries to shared-memory log", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-multi-team-"));
    await runMultiTeamCollaboration({
      objective: "设计发布节奏",
      roles: ["legal", "finance"],
      sharedMemoryRootDir: root,
      nowMs: Date.UTC(2026, 1, 25, 12, 0, 0),
      runAgent: async ({ role }) => `${role} baseline is ready`,
    });

    const logText = await readFile(path.join(root, "shared-memory/cross-agent-log.md"), "utf8");
    expect(logText).toContain("[2026-02-25] [legal] [P0] legal baseline is ready");
    expect(logText).toContain("[2026-02-25] [finance] [P0] finance baseline is ready");
  });

  it("continues on role failure and records error result", async () => {
    const out = await runMultiTeamCollaboration({
      objective: "统一测试规则",
      roles: ["coder", "writer"],
      runAgent: async ({ role }) => {
        if (role === "coder") {
          throw new Error("tool timeout");
        }
        return "writer-ready";
      },
    });

    expect(out.results[0].role).toBe("coder");
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].reply).toContain("tool timeout");
    expect(out.results[1].role).toBe("writer");
    expect(out.results[1].ok).toBe(true);
    expect(out.results[1].reply).toContain("writer-ready");
  });

  it("supports parallel role runs to reduce total latency", async () => {
    const start = Date.now();
    const out = await runMultiTeamCollaboration({
      objective: "并发执行测试",
      roles: ["coder", "writer", "growth"],
      maxParallelRoles: 3,
      runAgent: async ({ role }) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return `${role}-ok`;
      },
    });
    const elapsed = Date.now() - start;

    expect(out.results.map((x) => x.reply)).toEqual(["coder-ok", "writer-ok", "growth-ok"]);
    // Parallel mode should be much faster than strict serial (about 240ms here).
    expect(elapsed).toBeLessThan(200);
  });
});

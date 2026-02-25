import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendSharedMemoryLog,
  buildTieredSharedMemoryContext,
  cleanupExpiredSharedMemoryLogs,
  ensureSharedMemoryScaffold,
} from "../src/collaboration-memory";

describe("collaboration memory", () => {
  it("creates shared-memory scaffold files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-collab-"));
    await ensureSharedMemoryScaffold({ rootDir: root });

    const abstractText = await readFile(path.join(root, "shared-memory/.abstract"), "utf8");
    const profileText = await readFile(path.join(root, "shared-memory/user-profile.md"), "utf8");

    expect(abstractText).toContain("L0");
    expect(profileText).toContain("[P0]");
  });

  it("builds tiered context and filters expired P2 logs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-collab-"));
    await ensureSharedMemoryScaffold({ rootDir: root });

    await writeFile(
      path.join(root, "shared-memory/cross-agent-log.md"),
      [
        "# Cross Agent Log",
        "- [2026-01-01] [writer] [P2] old debug note",
        "- [2026-02-20] [coder] [P1] fixed webhook timeout",
        "- [2026-02-25] [pm] [P0] user style is concise",
      ].join("\n"),
      "utf8",
    );

    const context = await buildTieredSharedMemoryContext({
      rootDir: root,
      nowMs: Date.UTC(2026, 1, 25, 0, 0, 0),
      maxChars: 2000,
    });

    expect(context).toContain("[共享记忆-L0]");
    expect(context).toContain("user-profile.md");
    expect(context).toContain("fixed webhook timeout");
    expect(context).toContain("user style is concise");
    expect(context).not.toContain("old debug note");
  });

  it("appends normalized cross-agent log entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-collab-"));
    await ensureSharedMemoryScaffold({ rootDir: root });

    await appendSharedMemoryLog({
      rootDir: root,
      role: "coder",
      summary: "closed deployment regression",
      priority: "P1",
      nowMs: Date.UTC(2026, 1, 25, 12, 0, 0),
    });

    const logText = await readFile(path.join(root, "shared-memory/cross-agent-log.md"), "utf8");
    expect(logText).toContain("[2026-02-25] [coder] [P1] closed deployment regression");
  });

  it("archives expired logs by P-level policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yoyoo-collab-"));
    await ensureSharedMemoryScaffold({ rootDir: root });

    await writeFile(
      path.join(root, "shared-memory/cross-agent-log.md"),
      [
        "# Cross Agent Log",
        "- [2025-10-01] [ops] [P1] old project milestone",
        "- [2026-01-01] [dev] [P2] temp debug line",
        "- [2026-02-20] [pm] [P1] current launch prep",
      ].join("\n"),
      "utf8",
    );

    const out = await cleanupExpiredSharedMemoryLogs({
      rootDir: root,
      nowMs: Date.UTC(2026, 1, 25, 0, 0, 0),
    });

    expect(out.archivedCount).toBe(2);
    expect(out.archivePath).toContain("2026-02.md");

    const currentLog = await readFile(path.join(root, "shared-memory/cross-agent-log.md"), "utf8");
    expect(currentLog).toContain("current launch prep");
    expect(currentLog).not.toContain("old project milestone");

    const archiveLog = await readFile(out.archivePath!, "utf8");
    expect(archiveLog).toContain("old project milestone");
    expect(archiveLog).toContain("temp debug line");
  });
});

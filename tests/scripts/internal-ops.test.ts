import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildManifest,
  parseInternalArgs,
  readinessVerdict,
  redactDiagnostic,
  validateBackupDestination,
  verifyManifest,
} from "../../scripts/internal-ops.mts";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory() {
  const directory = join(
    tmpdir(),
    `yoyoo-internal-ops-${process.pid}-${Date.now()}-${temporaryDirectories.length}`,
  );
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("internal operations argument contract", () => {
  it("uses the stable loopback port and real Agent mode by default", () => {
    expect(parseInternalArgs(["start"])).toEqual({
      command: "start",
      mode: "yos",
      port: 4173,
      skipBuild: false,
    });
  });

  it("rejects unknown Agent modes and invalid ports", () => {
    expect(() => parseInternalArgs(["start", "--mode=cloud"])).toThrow(
      "Unsupported Agent mode",
    );
    expect(() => parseInternalArgs(["start", "--port=70000"])).toThrow(
      "Port must be an integer",
    );
  });
});

describe("internal backup contract", () => {
  it("allows backup writes only below the project-owned backup directory", () => {
    const projectRoot = "/workspace/yoyoo";
    expect(
      validateBackupDestination(
        projectRoot,
        "/workspace/yoyoo/output/backups/internal/2026-08-11T120000Z",
      ),
    ).toBe(
      "/workspace/yoyoo/output/backups/internal/2026-08-11T120000Z",
    );

    expect(() =>
      validateBackupDestination(projectRoot, "/workspace/yoyoo"),
    ).toThrow("outside the project backup root");
    expect(() =>
      validateBackupDestination(projectRoot, "/workspace/other/backup"),
    ).toThrow("outside the project backup root");
  });

  it("detects artifact tampering through the manifest digest", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "database.dump"), "database-v1", {
      mode: 0o600,
    });
    await writeFile(join(directory, "blobs.tar.gz"), "blobs-v1", {
      mode: 0o600,
    });

    const manifest = await buildManifest(directory, [
      "database.dump",
      "blobs.tar.gz",
    ]);
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expect(verifyManifest(directory)).resolves.toEqual({
      artifactCount: 2,
      valid: true,
    });

    await writeFile(join(directory, "database.dump"), "database-v2", {
      mode: 0o600,
    });
    await expect(verifyManifest(directory)).rejects.toThrow(
      "Digest mismatch for database.dump",
    );

    const manifestText = await readFile(join(directory, "manifest.json"), "utf8");
    expect(manifestText).not.toContain(directory);
  });
});

describe("internal readiness contract", () => {
  it("fails only when a required check fails", () => {
    expect(
      readinessVerdict([
        { detail: "available", name: "Docker", required: true, ok: true },
        { detail: "not logged in", name: "Codex", required: false, ok: false },
      ]),
    ).toEqual({ healthy: true, requiredFailures: [] });

    expect(
      readinessVerdict([
        { detail: "missing", name: "Environment", required: true, ok: false },
      ]),
    ).toEqual({ healthy: false, requiredFailures: ["Environment"] });
  });

  it("redacts credentials, bearer tokens, and private absolute paths", () => {
    const diagnostic = redactDiagnostic(
      "postgres://yoyoo:secret@127.0.0.1:55432/yoyoo_space " +
        "Authorization: Bearer live-token /Users/example/A/Yoyoo/.env.local",
      {
        homeDirectory: "/Users/example",
        projectRoot: "/Users/example/A/Yoyoo",
      },
    );

    expect(diagnostic).toBe(
      "postgres://[redacted]@127.0.0.1:55432/yoyoo_space " +
        "Authorization: Bearer [redacted] <project>/.env.local",
    );
    expect(diagnostic).not.toContain("secret");
    expect(diagnostic).not.toContain("live-token");
  });
});

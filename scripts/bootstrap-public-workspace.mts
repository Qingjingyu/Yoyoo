import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapLocalCollaboration } from "../src/server/collaboration-bootstrap.ts";
import { createPostgresPool } from "../src/server/postgres/client.ts";

export const DEFAULT_PUBLIC_OWNER_KEY = "local-owner-ui";

export function publicOwnerKey(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_PUBLIC_OWNER_KEY;
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(normalized)) {
    throw new Error("YOYOO_LOCAL_OWNER_ID must be a stable 3-80 character key");
  }
  return normalized;
}

async function bootstrapPublicWorkspace(): Promise<void> {
  const pool = createPostgresPool();
  try {
    const result = await bootstrapLocalCollaboration(
      pool,
      publicOwnerKey(process.env.YOYOO_LOCAL_OWNER_ID),
      [],
    );
    process.stdout.write([
      "Yoyoo 公网工作空间已就绪。",
      `所有者：${result.principal.displayName}`,
      `空间：${result.workspace.name}`,
      "",
    ].join("\n"));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  bootstrapPublicWorkspace().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "空间初始化失败"}\n`);
    process.exitCode = 1;
  });
}

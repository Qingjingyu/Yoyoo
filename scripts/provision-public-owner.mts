import { createInterface, emitKeypressEvents } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword } from "../src/server/auth/password.ts";
import { hashOpaqueToken, issueRecoveryCode } from "../src/server/auth/session-token.ts";
import { createPostgresPool } from "../src/server/postgres/client.ts";
import { HumanAuthRepository } from "../src/server/postgres/human-auth-repository.ts";

export const PUBLIC_OWNER_AI_CARD_ID = "AI_100001";

interface PublicOwnerRow {
  id: string;
  display_name: string;
}

export function ownerLoginHandle(aiCardId = PUBLIC_OWNER_AI_CARD_ID): string {
  if (!/^AI_[1-9][0-9]{5,}$/.test(aiCardId)) {
    throw new Error("Public owner AI Card ID is invalid");
  }
  return aiCardId.toLowerCase();
}

async function readHiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const readline = createInterface({ input: process.stdin, terminal: false });
    const iterator = readline[Symbol.asyncIterator]();
    const result = await iterator.next();
    readline.close();
    return result.done ? "" : result.value;
  }

  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onKeypress = (character: string, key: { ctrl?: boolean; name?: string }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Owner provisioning cancelled"));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (character && !key.ctrl) value += character;
    };
    process.stdin.on("keypress", onKeypress);
  });
}

async function findPublicOwner(databaseUrl?: string): Promise<{
  pool: ReturnType<typeof createPostgresPool>;
  owner: PublicOwnerRow;
}> {
  const pool = createPostgresPool(databaseUrl);
  const result = await pool.query<PublicOwnerRow>(
    `SELECT DISTINCT principals.id, principals.display_name
     FROM principals
     JOIN workspace_members ON workspace_members.principal_id = principals.id
     JOIN workspaces ON workspaces.id = workspace_members.workspace_id
     WHERE principals.ai_card_id = $1
       AND principals.kind = 'human'
       AND principals.status = 'active'
       AND workspace_members.role = 'owner'
       AND workspace_members.status = 'active'
       AND workspaces.status = 'active'`,
    [PUBLIC_OWNER_AI_CARD_ID],
  );
  if (result.rowCount !== 1) {
    await pool.end();
    throw new Error(
      `Expected exactly one active human workspace owner with ${PUBLIC_OWNER_AI_CARD_ID}`,
    );
  }
  return { pool, owner: result.rows[0] };
}

async function provisionPublicOwner(): Promise<void> {
  const firstPassword = await readHiddenPassword("新密码（12-128 位）：");
  const secondPassword = await readHiddenPassword("再次输入新密码：");
  if (firstPassword !== secondPassword) throw new Error("两次输入的密码不一致");
  const password = await hashPassword(firstPassword);
  const recoveryCode = issueRecoveryCode();
  const recoveryCodeHash = hashOpaqueToken(recoveryCode);
  const { pool, owner } = await findPublicOwner(process.env.DATABASE_URL);
  try {
    const repository = new HumanAuthRepository(pool);
    const existing = await pool.query(
      `SELECT 1 FROM human_credentials WHERE principal_id = $1`,
      [owner.id],
    );
    const credentialInput = {
      principalId: owner.id,
      loginHandle: ownerLoginHandle(),
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordAlgorithm: password.algorithm,
      recoveryCodeHash,
    } as const;
    const credential = existing.rowCount
      ? await repository.replaceCredential(credentialInput)
      : await repository.provisionCredential(credentialInput);

    process.stdout.write([
      "Yoyoo 公网账号已配置。",
      `显示名称：${owner.display_name}`,
      `AI Card ID：${PUBLIC_OWNER_AI_CARD_ID}`,
      `凭据版本：${credential.credentialVersion}`,
      `恢复码（仅显示一次）：${recoveryCode}`,
      "请将恢复码保存在密码管理器中。",
      "",
    ].join("\n"));
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  provisionPublicOwner().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "账号配置失败"}\n`);
    process.exitCode = 1;
  });
}

import { HumanAuthService } from "@/server/auth/human-auth-service";
import { getHumanAuthConfig } from "@/server/auth/human-auth-http";
import { createPostgresPool } from "@/server/postgres/client";
import { HumanAuthRepository } from "@/server/postgres/human-auth-repository";

interface HumanAuthRuntime {
  config: ReturnType<typeof getHumanAuthConfig>;
  service: HumanAuthService | null;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

const authRuntimeGlobal = globalThis as typeof globalThis & {
  __yoyooHumanAuthRuntime?: HumanAuthRuntime;
};

export function getHumanAuthRuntime(): HumanAuthRuntime {
  if (authRuntimeGlobal.__yoyooHumanAuthRuntime) {
    return authRuntimeGlobal.__yoyooHumanAuthRuntime;
  }
  const config = getHumanAuthConfig();
  if (config.mode === "local") {
    const runtime = {
      config,
      service: null,
      health: async () => true,
      close: async () => undefined,
    };
    authRuntimeGlobal.__yoyooHumanAuthRuntime = runtime;
    return runtime;
  }
  const pool = createPostgresPool();
  const service = new HumanAuthService(new HumanAuthRepository(pool), {
    pepper: config.pepper!,
    allowedLoginHandle: "ai_100001",
  });
  const runtime = {
    config,
    service,
    health: async () => {
      try {
        const result = await pool.query(
          `SELECT 1
           FROM human_credentials AS credentials
           JOIN principals ON principals.id = credentials.principal_id
           WHERE principals.ai_card_id = 'AI_100001'
             AND principals.kind = 'human'
             AND principals.status = 'active'
             AND credentials.status = 'active'`,
        );
        return result.rowCount === 1;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
  authRuntimeGlobal.__yoyooHumanAuthRuntime = runtime;
  return runtime;
}

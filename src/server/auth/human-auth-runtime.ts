import { HumanAuthService } from "@/server/auth/human-auth-service";
import { AICardSessionAuthority } from "@/server/auth/aicard-session-authority";
import { getHumanAuthConfig } from "@/server/auth/human-auth-http";
import { getAICardIntegrationConfig } from "@/server/aicard-integration-config";
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

interface HealthQueryable {
  query(text: string): Promise<unknown>;
}

export function createHumanAuthHealthCheck(pool: HealthQueryable) {
  return async (): Promise<boolean> => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  };
}

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
  const aicardConfig = getAICardIntegrationConfig();
  const service = new HumanAuthService(new HumanAuthRepository(pool), {
    ...(config.pepper
      ? { pepper: config.pepper, allowedLoginHandle: "ai_100001" }
      : {}),
    aicardAuthority: new AICardSessionAuthority(
      aicardConfig,
      aicardConfig.sessionSecret,
    ),
  });
  const runtime = {
    config,
    service,
    health: createHumanAuthHealthCheck(pool),
    close: () => pool.end(),
  };
  authRuntimeGlobal.__yoyooHumanAuthRuntime = runtime;
  return runtime;
}

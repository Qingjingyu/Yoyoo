import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  YOYOO_AICARD_ISSUER: z.url(),
  YOYOO_AICARD_CLIENT_ID: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  YOYOO_AICARD_REDIRECT_URI: z.url(),
  YOYOO_AICARD_SESSION_SECRET: z.string().min(1),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV !== 'production') return;
  for (const field of ['YOYOO_AICARD_ISSUER', 'YOYOO_AICARD_REDIRECT_URI'] as const) {
    if (!environment[field].startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Must use HTTPS in production',
      });
    }
  }
});

const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  YOYOO_AICARD_ISSUER: z.url(),
  YOYOO_AICARD_CLIENT_ID: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  YOYOO_AICARD_AUDIENCE: z.string()
    .regex(/^[a-z][a-z0-9:_-]{2,127}$/)
    .default('yoyoo'),
}).superRefine((environment, context) => {
  if (
    environment.NODE_ENV === 'production'
    && !environment.YOYOO_AICARD_ISSUER.startsWith('https://')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['YOYOO_AICARD_ISSUER'],
      message: 'Must use HTTPS in production',
    });
  }
});

export class AICardIntegrationConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(`Invalid AI Card integration environment: ${fields.join(', ')}`);
    this.name = 'AICardIntegrationConfigurationError';
  }
}

export function getAICardIntegrationConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new AICardIntegrationConfigurationError(
      [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'environment'))],
    );
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    issuer: parsed.data.YOYOO_AICARD_ISSUER,
    clientId: parsed.data.YOYOO_AICARD_CLIENT_ID,
    redirectUri: parsed.data.YOYOO_AICARD_REDIRECT_URI,
    sessionSecret: parsed.data.YOYOO_AICARD_SESSION_SECRET,
    scopes: ['card.basic', 'card.handle', 'card.id', 'offline_access'] as const,
  };
}

export function getAICardProfileUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const humanAuthMode = environment.YOYOO_HUMAN_AUTH_MODE?.trim() || 'local';
  const hasBrowserIntegration = Boolean(
    environment.YOYOO_AICARD_REDIRECT_URI?.trim()
    || environment.YOYOO_AICARD_SESSION_SECRET?.trim(),
  );

  if (humanAuthMode !== 'password' && !hasBrowserIntegration) return null;

  return new URL('/me/card', getAICardIntegrationConfig(environment).issuer).toString();
}

export function getAICardRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const issuer = environment.YOYOO_AICARD_ISSUER?.trim();
  const clientId = environment.YOYOO_AICARD_CLIENT_ID?.trim();
  const audience = environment.YOYOO_AICARD_AUDIENCE?.trim();
  if (!issuer && !clientId && !audience) return null;

  const parsed = runtimeEnvironmentSchema.safeParse({
    NODE_ENV: environment.NODE_ENV,
    YOYOO_AICARD_ISSUER: issuer,
    YOYOO_AICARD_CLIENT_ID: clientId,
    YOYOO_AICARD_AUDIENCE: audience || undefined,
  });
  if (!parsed.success) {
    throw new AICardIntegrationConfigurationError(
      [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'environment'))],
    );
  }
  return {
    issuer: parsed.data.YOYOO_AICARD_ISSUER,
    clientId: parsed.data.YOYOO_AICARD_CLIENT_ID,
    audience: parsed.data.YOYOO_AICARD_AUDIENCE,
  };
}

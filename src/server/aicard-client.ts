import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

const scopeSchema = z.enum(['card.basic', 'card.handle', 'card.id', 'offline_access']);
const configSchema = z.object({
  issuer: z.url(),
  clientId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  redirectUri: z.url(),
  scopes: z.array(scopeSchema).min(1),
});
const stateSchema = z.string().regex(/^[A-Za-z0-9._~-]{16,256}$/);
const verifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const authorizationCodeSchema = z.string().regex(/^ac_[A-Za-z0-9_-]{43}$/);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/);
const tokenResponseSchema = z.object({
  access_token: z.string().regex(/^at_[A-Za-z0-9_-]{43}$/),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string().trim().min(1),
  sub: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
  refresh_token: z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/).optional(),
  refresh_expires_in: z.number().int().positive().optional(),
}).strict();
const userInfoSchema = z.object({
  sub: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
  display_name: z.string().trim().min(1).max(120),
  principal_type: z.enum(['human', 'ai']),
  avatar_url: z.url().nullable(),
  handle: z.string().trim().min(1).max(80),
  card_id: z.string().trim().min(1).max(120).optional(),
}).strict();
const runtimeIntrospectionSchema = z.object({
  active: z.literal(true),
  sub: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
  node_id: z.uuid(),
  client_id: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  audience: z.string().regex(/^[a-z][a-z0-9:_-]{2,127}$/),
  scope: z.literal('agent.runtime'),
  expires_at: z.iso.datetime(),
}).strict();

export interface AICardClientConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly ('card.basic' | 'card.handle' | 'card.id' | 'offline_access')[];
}

export class AICardProtocolError extends Error {
  constructor(message = 'AI Card 返回了无法验证的协议响应') {
    super(message);
    this.name = 'AICardProtocolError';
  }
}

export interface AICardTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number | null;
  scope: string;
  subject: string;
}

export interface AICardUserInfo {
  subject: string;
  displayName: string;
  principalType: 'human' | 'ai';
  avatarUrl: string | null;
  handle: string;
  cardId: string | null;
}

export interface AICardAgentRuntimeSession {
  active: true;
  subject: string;
  nodeId: string;
  clientId: string;
  audience: string;
  scope: 'agent.runtime';
  expiresAt: Date;
}

export async function introspectAICardAgentRuntime(
  issuer: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<AICardAgentRuntimeSession> {
  const token = tokenResponseSchema.shape.access_token.parse(accessToken);
  const response = await fetcher(
    new URL('/api/v1/agent-runtime/introspect', issuer),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw providerError(response.status, body);
  const parsed = runtimeIntrospectionSchema.safeParse(body);
  if (!parsed.success) throw new AICardProtocolError();
  return {
    active: true,
    subject: parsed.data.sub,
    nodeId: parsed.data.node_id,
    clientId: parsed.data.client_id,
    audience: parsed.data.audience,
    scope: parsed.data.scope,
    expiresAt: new Date(parsed.data.expires_at),
  };
}

export class AICardClient {
  private readonly config: z.infer<typeof configSchema>;

  constructor(
    config: AICardClientConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse({ ...config, scopes: [...config.scopes] });
  }

  createAuthorizationTransaction(input: {
    state?: string;
    codeVerifier?: string;
    principalType?: 'human' | 'ai';
  } = {}) {
    const state = stateSchema.parse(
      input.state ?? randomBytes(24).toString('base64url'),
    );
    const codeVerifier = verifierSchema.parse(
      input.codeVerifier ?? randomBytes(48).toString('base64url'),
    );
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');
    const authorizationUrl = new URL('/authorize', this.config.issuer);
    const requestedScopes = input.principalType === 'ai'
      ? [...this.config.scopes, 'agent.runtime']
      : this.config.scopes;
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: requestedScopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    if (input.principalType) {
      authorizationUrl.searchParams.set('principal_type', input.principalType);
    }
    return { authorizationUrl: authorizationUrl.toString(), state, codeVerifier };
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    idempotencyKey: string;
  }): Promise<AICardTokenSet> {
    const code = authorizationCodeSchema.parse(input.code);
    const codeVerifier = verifierSchema.parse(input.codeVerifier);
    const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
    const response = await this.fetcher(new URL('/api/v1/token', this.config.issuer), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': idempotencyKey,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
      cache: 'no-store',
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) throw new AICardProtocolError();
    const grantedScopes = new Set(parsed.data.scope.split(/\s+/));
    if (this.config.scopes.some((scope) => !grantedScopes.has(scope))) {
      throw new AICardProtocolError('AI Card 未返回 Yoyoo 请求的完整授权范围');
    }
    if (
      this.config.scopes.includes('offline_access') &&
      (!parsed.data.refresh_token || !parsed.data.refresh_expires_in)
    ) {
      throw new AICardProtocolError('AI Card 未返回可续期的授权材料');
    }
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? null,
      tokenType: parsed.data.token_type,
      expiresIn: parsed.data.expires_in,
      refreshExpiresIn: parsed.data.refresh_expires_in ?? null,
      scope: parsed.data.scope,
      subject: parsed.data.sub,
    };
  }

  async getUserInfo(accessToken: string): Promise<AICardUserInfo> {
    const token = tokenResponseSchema.shape.access_token.parse(accessToken);
    const response = await this.fetcher(new URL('/api/v1/userinfo', this.config.issuer), {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    const parsed = userInfoSchema.safeParse(body);
    if (!parsed.success) throw new AICardProtocolError();
    return {
      subject: parsed.data.sub,
      displayName: parsed.data.display_name,
      principalType: parsed.data.principal_type,
      avatarUrl: parsed.data.avatar_url,
      handle: parsed.data.handle,
      cardId: parsed.data.card_id ?? null,
    };
  }

  async introspectAgentRuntime(
    accessToken: string,
  ): Promise<AICardAgentRuntimeSession> {
    return introspectAICardAgentRuntime(
      this.config.issuer,
      accessToken,
      this.fetcher,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AICardProtocolError('AI Card 返回了非 JSON 响应');
  }
}

function providerError(status: number, body: unknown): AICardProtocolError {
  const parsed = z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }).safeParse(body);
  const message = parsed.success
    ? `AI Card 请求失败：${parsed.data.error.message}`
    : `AI Card 请求失败（HTTP ${status}）`;
  return new AICardProtocolError(message);
}

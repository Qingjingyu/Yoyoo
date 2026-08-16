import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

const challengeSchema = z.object({
  challengeId: z.uuid(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
}).strict();

const runtimeResponseSchema = z.object({
  nodeId: z.uuid(),
  connectionStatus: z.literal("connected"),
  runtime: z.object({
    subject: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
    nodeId: z.uuid(),
    clientId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
    audience: z.string().regex(/^[a-z][a-z0-9:_-]{2,127}$/),
    accessToken: z.string().regex(/^at_[A-Za-z0-9_-]{43}$/),
    tokenType: z.literal("Bearer"),
    expiresIn: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    scope: z.literal("agent.runtime"),
  }).passthrough(),
}).strict();

export class AICardRuntimeProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super("AI Card runtime session could not be established");
    this.name = "AICardRuntimeProtocolError";
    this.status = status;
    this.code = code;
  }
}

function readProtectedFile(path: string): Buffer {
  const resolved = resolve(path);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error("AI Card node credential must be a regular file");
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("AI Card node credential must not be readable by group or other users");
  }
  return readFileSync(resolved);
}

interface AICardRuntimeTokenProviderOptions {
  issuer: string;
  nodeId: string;
  clientId: string;
  audience: string;
  privateKey: KeyObject;
  fetcher?: typeof fetch;
  now?: () => Date;
}

function normalizedIssuer(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("AI Card issuer must be an HTTP(S) URL without credentials");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadAICardNodePrivateKey(path: string): KeyObject {
  const encoded = readProtectedFile(path);
  let key: KeyObject;
  try {
    key = createPrivateKey(encoded);
  } catch {
    throw new Error("AI Card node private key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("AI Card node private key must be Ed25519");
  }
  return key;
}

export function loadAICardNodeCredential(path: string): {
  nodeId: string;
  privateKey: KeyObject;
} {
  let value: unknown;
  try {
    value = JSON.parse(readProtectedFile(path).toString("utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not be readable")) {
      throw error;
    }
    throw new Error("AI Card node credential file is invalid");
  }
  const parsed = z.object({
    version: z.literal(1),
    nodeId: z.uuid(),
    privateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]{40,342}$/),
  }).passthrough().safeParse(value);
  if (!parsed.success) throw new Error("AI Card node credential file is invalid");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(parsed.data.privateKeyPkcs8, "base64url"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw new Error("AI Card node credential file is invalid");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("AI Card node private key must be Ed25519");
  }
  return { nodeId: parsed.data.nodeId, privateKey };
}

export class AICardRuntimeTokenProvider {
  readonly #issuer: string;
  readonly #nodeId: string;
  readonly #clientId: string;
  readonly #audience: string;
  readonly #privateKey: KeyObject;
  readonly #fetcher: typeof fetch;
  readonly #now: () => Date;
  #cached: { token: string; expiresAt: Date } | null = null;
  #refreshing: Promise<string> | null = null;

  constructor(options: AICardRuntimeTokenProviderOptions) {
    if (options.privateKey.type !== "private" || options.privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("AI Card node private key must be Ed25519");
    }
    this.#issuer = normalizedIssuer(options.issuer);
    this.#nodeId = z.uuid().parse(options.nodeId);
    this.#clientId = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/).parse(options.clientId);
    this.#audience = z.string().regex(/^[a-z][a-z0-9:_-]{2,127}$/).parse(options.audience);
    this.#privateKey = options.privateKey;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async getToken(): Promise<string> {
    if (
      this.#cached
      && this.#cached.expiresAt.getTime() - this.#now().getTime() > 15_000
    ) {
      return this.#cached.token;
    }
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #refresh(): Promise<string> {
    const challengeResult = challengeSchema.safeParse(await this.#post(
      "/api/v1/agent-nodes/challenge",
      { nodeId: this.#nodeId },
    ));
    if (!challengeResult.success) {
      throw new AICardRuntimeProtocolError(502, "INVALID_RESPONSE");
    }
    const challenge = challengeResult.data;
    const payload = [
      "aicard-agent-runtime-v1",
      this.#nodeId,
      this.#clientId,
      challenge.challenge,
    ].join("\n");
    const signature = sign(
      null,
      Buffer.from(payload, "utf8"),
      this.#privateKey,
    ).toString("base64url");
    const responseResult = runtimeResponseSchema.safeParse(await this.#post(
      "/api/v1/agent-nodes/authenticate",
      {
        nodeId: this.#nodeId,
        clientId: this.#clientId,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        signature,
      },
    ));
    if (!responseResult.success) {
      throw new AICardRuntimeProtocolError(502, "INVALID_RESPONSE");
    }
    const response = responseResult.data;
    if (
      response.nodeId !== this.#nodeId
      || response.runtime.nodeId !== this.#nodeId
      || response.runtime.clientId !== this.#clientId
      || response.runtime.audience !== this.#audience
    ) {
      throw new AICardRuntimeProtocolError(502, "AUTHORITY_MISMATCH");
    }
    const expiresAt = new Date(response.runtime.expiresAt);
    if (expiresAt.getTime() - this.#now().getTime() <= 15_000) {
      throw new AICardRuntimeProtocolError(502, "SESSION_TOO_SHORT");
    }
    this.#cached = { token: response.runtime.accessToken, expiresAt };
    return this.#cached.token;
  }

  async #post(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#issuer}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AICardRuntimeProtocolError(0, "CONNECTION_FAILED");
    }
    if (!response.ok) {
      let code = "HTTP_ERROR";
      try {
        const envelope = await response.json() as { error?: { code?: unknown } };
        if (typeof envelope.error?.code === "string") code = envelope.error.code;
      } catch {
        // Public error details are optional and response bodies are never echoed.
      }
      throw new AICardRuntimeProtocolError(response.status, code);
    }
    try {
      return await response.json();
    } catch {
      throw new AICardRuntimeProtocolError(502, "INVALID_RESPONSE");
    }
  }
}

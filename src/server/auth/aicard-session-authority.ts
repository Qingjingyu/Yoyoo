import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  AICardClient,
  AICardProtocolError,
  AICardRefreshRejectedError,
  AICardUnavailableError,
  type AICardClientConfig,
} from "@/server/aicard-client";

const REFRESH_AAD_PREFIX = Buffer.from("yoyoo:aicard:refresh:v1", "utf8");

export interface FederatedAuthorizationMaterial {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  refreshExpiresAt: Date;
}

export interface AICardSessionAuthorityPort {
  protectRefreshToken(input: {
    refreshToken: string;
    authorizationStateHash: Buffer;
    refreshExpiresAt: Date;
  }): FederatedAuthorizationMaterial;
  refreshAuthorization(input: {
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    material: FederatedAuthorizationMaterial;
    now: Date;
  }): Promise<FederatedAuthorizationMaterial>;
}

export class FederatedAuthorizationRejectedError extends Error {
  constructor(message = "AI Card authorization is no longer valid") {
    super(message);
    this.name = "FederatedAuthorizationRejectedError";
  }
}

export class FederatedAuthorizationUnavailableError extends Error {
  constructor(message = "AI Card authorization validation is temporarily unavailable") {
    super(message);
    this.name = "FederatedAuthorizationUnavailableError";
  }
}

function parseSecret(secret: string): Buffer {
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== secret) {
    throw new Error("AI Card refresh protection requires a canonical 256-bit secret");
  }
  return key;
}

function aad(authorizationStateHash: Buffer): Buffer {
  if (authorizationStateHash.length !== 32) {
    throw new Error("AI Card authorization state hash must be 256 bits");
  }
  return Buffer.concat([REFRESH_AAD_PREFIX, authorizationStateHash]);
}

export class AICardSessionAuthority implements AICardSessionAuthorityPort {
  private readonly key: Buffer;
  private readonly client: AICardClient;
  private readonly issuer: string;
  private readonly clientId: string;

  constructor(
    config: AICardClientConfig,
    secret: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.key = parseSecret(secret);
    this.client = new AICardClient(config, fetcher);
    this.issuer = new URL(config.issuer).toString();
    this.clientId = config.clientId;
  }

  protectRefreshToken(input: {
    refreshToken: string;
    authorizationStateHash: Buffer;
    refreshExpiresAt: Date;
  }): FederatedAuthorizationMaterial {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad(input.authorizationStateHash));
    const ciphertext = Buffer.concat([
      cipher.update(input.refreshToken, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext,
      iv,
      tag: cipher.getAuthTag(),
      refreshExpiresAt: input.refreshExpiresAt,
    };
  }

  async refreshAuthorization(input: {
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    material: FederatedAuthorizationMaterial;
    now: Date;
  }): Promise<FederatedAuthorizationMaterial> {
    if (
      new URL(input.issuer).toString() !== this.issuer
      || input.clientId !== this.clientId
    ) {
      throw new FederatedAuthorizationRejectedError();
    }
    if (input.material.refreshExpiresAt.getTime() <= input.now.getTime()) {
      throw new FederatedAuthorizationRejectedError();
    }

    let refreshToken: string;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        input.material.iv,
      );
      decipher.setAAD(aad(input.authorizationStateHash));
      decipher.setAuthTag(input.material.tag);
      refreshToken = Buffer.concat([
        decipher.update(input.material.ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new FederatedAuthorizationRejectedError();
    }

    const idempotencyKey = `refresh_${createHmac("sha256", this.key)
      .update(input.authorizationStateHash)
      .update("\0", "utf8")
      .update(refreshToken, "utf8")
      .digest("base64url")}`;
    try {
      const rotated = await this.client.exchangeRefreshToken({
        refreshToken,
        idempotencyKey,
      });
      if (
        rotated.subject !== input.subject
        || !rotated.refreshToken
        || !rotated.refreshExpiresIn
      ) {
        throw new FederatedAuthorizationRejectedError();
      }
      return this.protectRefreshToken({
        refreshToken: rotated.refreshToken,
        authorizationStateHash: input.authorizationStateHash,
        refreshExpiresAt: new Date(
          input.now.getTime() + rotated.refreshExpiresIn * 1_000,
        ),
      });
    } catch (error) {
      if (error instanceof FederatedAuthorizationRejectedError) throw error;
      if (error instanceof AICardRefreshRejectedError) {
        throw new FederatedAuthorizationRejectedError();
      }
      if (
        error instanceof AICardUnavailableError
        || error instanceof AICardProtocolError
      ) {
        throw new FederatedAuthorizationUnavailableError();
      }
      throw new FederatedAuthorizationUnavailableError();
    }
  }
}

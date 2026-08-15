import { createAuthenticationPepper } from "@/server/auth/human-auth-service";
import type { HumanSessionRecord } from "@/server/postgres/human-auth-repository";

export const HUMAN_SESSION_COOKIE = "yoyoo_session";

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export interface HumanAuthConfig {
  mode: "local" | "password" | "aicard";
  publicOrigin: string | null;
  pepper: Buffer | null;
}

export interface SessionResolver {
  resolveSession(token: string, now?: Date): Promise<HumanSessionRecord | null>;
}

export class HumanAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanAuthConfigurationError";
  }
}

export class HumanSessionRequiredError extends Error {
  constructor(message = "需要登录后才能继续。") {
    super(message);
    this.name = "HumanSessionRequiredError";
  }
}

export class HumanRequestOriginError extends Error {
  constructor(message = "请求来源无效。") {
    super(message);
    this.name = "HumanRequestOriginError";
  }
}

export function getHumanAuthConfig(
  environment: AuthEnvironment = process.env,
): HumanAuthConfig {
  const production = environment.NODE_ENV === "production";
  const mode = environment.YOYOO_HUMAN_AUTH_MODE?.trim() || "local";
  if (mode !== "local" && mode !== "password" && mode !== "aicard") {
    throw new HumanAuthConfigurationError(
      "YOYOO_HUMAN_AUTH_MODE must be local, password, or aicard",
    );
  }
  if (production && environment.YOYOO_PUBLIC_ORIGIN?.trim() && mode === "local") {
    throw new HumanAuthConfigurationError(
      "Production requires YOYOO_HUMAN_AUTH_MODE=password or aicard",
    );
  }
  if (mode === "local") {
    return { mode, publicOrigin: null, pepper: null };
  }

  const originValue = environment.YOYOO_PUBLIC_ORIGIN?.trim();
  if (!originValue) {
    throw new HumanAuthConfigurationError("YOYOO_PUBLIC_ORIGIN is required");
  }
  const origin = new URL(originValue);
  if (production && origin.protocol !== "https:") {
    throw new HumanAuthConfigurationError("Production public origin must use HTTPS");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new HumanAuthConfigurationError("YOYOO_PUBLIC_ORIGIN must contain only an origin");
  }
  if (mode === "aicard") {
    return {
      mode,
      publicOrigin: origin.origin,
      pepper: null,
    };
  }
  const pepperValue = environment.YOYOO_AUTH_PEPPER?.trim();
  if (!pepperValue) {
    throw new HumanAuthConfigurationError("YOYOO_AUTH_PEPPER is required");
  }
  return {
    mode,
    publicOrigin: origin.origin,
    pepper: createAuthenticationPepper(pepperValue),
  };
}

function requestCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    if (segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

export async function requireHumanSession(
  request: Request,
  resolver: SessionResolver,
): Promise<HumanSessionRecord> {
  const token = requestCookie(request, HUMAN_SESSION_COOKIE);
  if (!token) throw new HumanSessionRequiredError();
  const session = await resolver.resolveSession(token);
  if (!session) throw new HumanSessionRequiredError();
  return session;
}

export function createHumanSessionCookie(
  token: string,
  expiresAt: Date,
  secure: boolean,
): string {
  const parts = [
    `${HUMAN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearHumanSessionCookie(secure: boolean): string {
  return createHumanSessionCookie("", new Date(0), secure);
}

export function assertSameOrigin(request: Request, publicOrigin: string): void {
  const expected = new URL(publicOrigin).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    if (new URL(origin).origin !== expected) throw new HumanRequestOriginError();
    return;
  }
  const referer = request.headers.get("referer");
  if (!referer || new URL(referer).origin !== expected) {
    throw new HumanRequestOriginError();
  }
}

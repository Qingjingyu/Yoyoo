import {
  HUMAN_SESSION_COOKIE,
  assertSameOrigin,
  type HumanAuthConfig,
  type SessionResolver,
} from "@/server/auth/human-auth-http";

type ProxySession = Awaited<ReturnType<SessionResolver["resolveSession"]>>;

export type HumanRequestAuthorization =
  | { kind: "allowed"; session: ProxySession }
  | { kind: "redirect"; location: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden-origin" };

const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/v1/auth/login",
]);

export function isPublicHumanPath(pathname: string): boolean {
  return PUBLIC_EXACT_PATHS.has(pathname)
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/api/v1/agent-gateway/")
    || pathname === "/favicon.ico"
    || pathname === "/icon";
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export async function authorizeHumanRequest(
  request: Request,
  config: HumanAuthConfig,
  resolver: SessionResolver,
): Promise<HumanRequestAuthorization> {
  if (config.mode === "local" || isPublicHumanPath(new URL(request.url).pathname)) {
    return { kind: "allowed", session: null };
  }

  const token = readCookie(request, HUMAN_SESSION_COOKIE);
  const session = token ? await resolver.resolveSession(token) : null;
  if (!session) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return { kind: "unauthorized" };
    const next = `${url.pathname}${url.search}`;
    return {
      kind: "redirect",
      location: `/login?next=${encodeURIComponent(next)}`,
    };
  }

  if (!isSafeMethod(request.method)) {
    try {
      assertSameOrigin(request, config.publicOrigin!);
    } catch {
      return { kind: "forbidden-origin" };
    }
  }
  return { kind: "allowed", session };
}

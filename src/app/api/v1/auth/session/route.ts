import {
  HUMAN_SESSION_COOKIE,
  HumanSessionRequiredError,
  clearHumanSessionCookie,
  requireHumanSession,
  assertSameOrigin,
} from "@/server/auth/human-auth-http";
import { getHumanAuthRuntime } from "@/server/auth/human-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const prefix = `${HUMAN_SESSION_COOKIE}=`;
  return cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
}

export async function GET(request: Request): Promise<Response> {
  const auth = getHumanAuthRuntime();
  if (auth.config.mode !== "password" || !auth.service) {
    return Response.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const session = await requireHumanSession(request, auth.service);
    return Response.json(
      {
        authenticated: true,
        identity: {
          aiCardId: session.aiCardId,
          loginHandle: session.loginHandle,
          displayName: session.displayName,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (!(error instanceof HumanSessionRequiredError)) throw error;
    return Response.json(
      { authenticated: false },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = getHumanAuthRuntime();
  if (auth.config.mode === "password" && auth.service && auth.config.publicOrigin) {
    try {
      assertSameOrigin(request, auth.config.publicOrigin);
      const token = cookieValue(request);
      if (token) await auth.service.logout(decodeURIComponent(token));
    } catch {
      return Response.json(
        { error: { code: "INVALID_ORIGIN", message: "请求来源无效。" } },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
  }
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": clearHumanSessionCookie(process.env.NODE_ENV === "production"),
    },
  });
}

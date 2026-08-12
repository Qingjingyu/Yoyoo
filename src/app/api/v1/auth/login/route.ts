import { z } from "zod";

import {
  HumanRequestOriginError,
  createHumanSessionCookie,
  assertSameOrigin,
} from "@/server/auth/human-auth-http";
import { isHumanAuthenticationError } from "@/server/auth/human-auth-service";
import { getHumanAuthRuntime } from "@/server/auth/human-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  loginHandle: z.string().min(1).max(65),
  password: z.string().min(1).max(128),
}).strict();

function requestSource(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const auth = getHumanAuthRuntime();
  if (auth.config.mode !== "password" || !auth.service || !auth.config.publicOrigin) {
    return Response.json(
      { error: { code: "AUTH_NOT_CONFIGURED", message: "账号登录尚未启用。" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    assertSameOrigin(request, auth.config.publicOrigin);
    const body = loginSchema.parse(await request.json());
    const session = await auth.service.login({
      ...body,
      source: requestSource(request),
    });
    return Response.json(
      { authenticated: true },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": createHumanSessionCookie(
            session.token,
            session.expiresAt,
            process.env.NODE_ENV === "production",
          ),
        },
      },
    );
  } catch (error) {
    if (error instanceof HumanRequestOriginError) {
      return Response.json(
        { error: { code: "INVALID_ORIGIN", message: error.message } },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    if (isHumanAuthenticationError(error)) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: "账号或密码格式无效。" } },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    console.error("Human login failed unexpectedly", error);
    return Response.json(
      { error: { code: "LOGIN_UNAVAILABLE", message: "暂时无法登录，请稍后再试。" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

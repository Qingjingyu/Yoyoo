import { NextRequest, NextResponse } from "next/server";

import { getHumanAuthRuntime } from "@/server/auth/human-auth-runtime";
import { authorizeHumanRequest } from "@/server/auth/human-auth-proxy";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === "/orb-preview") {
    return new NextResponse(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const runtime = getHumanAuthRuntime();
  const authorization = await authorizeHumanRequest(
    request,
    runtime.config,
    runtime.service ?? { resolveSession: async () => null },
  );
  if (authorization.kind === "redirect") {
    return NextResponse.redirect(new URL(authorization.location, request.url), 307);
  }
  if (authorization.kind === "unauthorized") {
    return NextResponse.json(
      { error: { code: "HUMAN_UNAUTHENTICATED", message: "需要登录后才能继续。" } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (authorization.kind === "forbidden-origin") {
    return NextResponse.json(
      { error: { code: "INVALID_ORIGIN", message: "请求来源无效。" } },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const response = NextResponse.next();
  if (runtime.config.mode !== "local") {
    response.headers.set("cache-control", "private, no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)"],
};

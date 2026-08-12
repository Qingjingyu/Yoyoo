import { getHumanAuthRuntime } from "@/server/auth/human-auth-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const healthy = await getHumanAuthRuntime().health();
  return Response.json(
    { status: healthy ? "ok" : "unavailable" },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

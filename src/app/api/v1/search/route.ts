import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  roomId: databaseIdSchema.optional(),
  senderId: databaseIdSchema.optional(),
  category: z.enum(["message", "file", "image", "document", "archive", "agent_output"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const input = searchSchema.parse(Object.fromEntries(url.searchParams));
    if (input.from && input.to && input.from > input.to) {
      throw new SyntaxError("Search date range is invalid");
    }
    const { collaboration, search } = await getServerRuntime();
    return Response.json(await search.search({
      workspaceId: collaboration.bootstrap.workspace.id,
      principalId: collaboration.bootstrap.principal.id,
      query: input.q,
      roomId: input.roomId,
      senderPrincipalId: input.senderId,
      category: input.category,
      from: input.from,
      to: input.to,
      cursor: input.cursor,
      limit: input.limit,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

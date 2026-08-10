import { databaseIdSchema } from "@/domain/id";
import { RoomNotFoundError } from "@/server/postgres/room-repository";
import {
  SearchRepository,
  type SearchResourceCategory,
  type SearchResultRecord,
} from "@/server/postgres/search-repository";

const MAX_PAGE_SIZE = 50;

function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const [createdAt, id] = JSON.parse(decoded) as [string, string];
    const parsedDate = new Date(createdAt);
    if (Number.isNaN(parsedDate.getTime())) throw new Error("invalid date");
    return { createdAt: parsedDate, id: databaseIdSchema.parse(id) };
  } catch {
    throw new SyntaxError("Search cursor is invalid");
  }
}

function encodeCursor(result: SearchResultRecord): string {
  return Buffer.from(JSON.stringify([result.createdAt.toISOString(), result.id]), "utf8")
    .toString("base64url");
}

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  async search(input: {
    workspaceId: string;
    principalId: string;
    query: string;
    roomId?: string;
    senderPrincipalId?: string;
    category?: SearchResourceCategory | "file";
    from?: Date;
    to?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<{ results: SearchResultRecord[]; nextCursor: string | null }> {
    const query = input.query.trim();
    if (!query || query.length > 200) throw new SyntaxError("Search query is invalid");
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
    const rows = await this.repository.search({
      ...input,
      query,
      before: decodeCursor(input.cursor),
      limit: limit + 1,
    });
    const results = rows.slice(0, limit);
    return {
      results,
      nextCursor: rows.length > limit && results.length > 0
        ? encodeCursor(results.at(-1)!)
        : null,
    };
  }

  async listRoomFiles(input: {
    roomId: string;
    principalId: string;
  }): Promise<{ files: SearchResultRecord[] }> {
    if (!(await this.repository.canReadRoom(input))) throw new RoomNotFoundError();
    return { files: await this.repository.listRoomFiles(input) };
  }
}

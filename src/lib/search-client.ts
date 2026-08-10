export type SearchCategory = "message" | "file" | "image" | "document" | "archive" | "agent_output";

export interface SearchResult {
  id: string;
  kind: "message" | "file";
  category: Exclude<SearchCategory, "file">;
  workspaceId: string;
  roomId: string;
  roomName: string;
  messageId: string;
  senderPrincipalId: string;
  senderDisplayName: string;
  text: string;
  mediaType: string | null;
  provenance: "human_upload" | "agent_output" | null;
  createdAt: string;
}

export interface SearchClient {
  search(input: {
    query: string;
    roomId?: string;
    category?: SearchCategory;
    cursor?: string;
    limit?: number;
  }): Promise<{ results: SearchResult[]; nextCursor: string | null }>;
  listRoomFiles(roomId: string): Promise<{ files: SearchResult[] }>;
}

async function requestJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url);
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败。");
  return body;
}

export function createSearchClient(fetcher: typeof fetch = fetch): SearchClient {
  return {
    search: (input) => {
      const search = new URLSearchParams({ q: input.query });
      if (input.roomId) search.set("roomId", input.roomId);
      if (input.category) search.set("category", input.category);
      if (input.cursor) search.set("cursor", input.cursor);
      if (input.limit) search.set("limit", String(input.limit));
      return requestJson(fetcher, `/api/v1/search?${search}`);
    },
    listRoomFiles: (roomId) => requestJson(
      fetcher,
      `/api/v1/rooms/${encodeURIComponent(roomId)}/files`,
    ),
  };
}

export const browserSearchClient = createSearchClient();

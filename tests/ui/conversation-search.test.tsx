import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConversationSearch } from "@/components/conversation/conversation-search";
import { RoomFiles } from "@/components/conversation/room-files";
import type { RoomSummaryRecord } from "@/domain/collaboration";
import type { SearchClient, SearchResult } from "@/lib/search-client";

const result: SearchResult = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "file",
  category: "document",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  roomId: "10000000-0000-4000-8000-000000000003",
  roomName: "发布室",
  messageId: "10000000-0000-4000-8000-000000000004",
  senderPrincipalId: "10000000-0000-4000-8000-000000000005",
  senderDisplayName: "Planner",
  text: "发布计划.pdf",
  mediaType: "application/pdf",
  provenance: "human_upload",
  createdAt: new Date().toISOString(),
};

function client(overrides: Partial<SearchClient> = {}): SearchClient {
  return {
    search: vi.fn(async () => ({ results: [result], nextCursor: null })),
    listRoomFiles: vi.fn(async () => ({ files: [result] })),
    ...overrides,
  };
}

describe("conversation search", () => {
  it("searches and opens the authoritative source result", async () => {
    const searchClient = client();
    const onOpenResult = vi.fn();
    const user = userEvent.setup();
    render(
      <ConversationSearch
        client={searchClient}
        onClose={() => undefined}
        onOpenResult={onOpenResult}
        rooms={[{ id: result.roomId, name: result.roomName } as RoomSummaryRecord]}
      />,
    );

    await user.type(screen.getByLabelText("搜索关键词"), "发布");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(await screen.findByRole("button", { name: /发布计划/ }));

    expect(searchClient.search).toHaveBeenCalledWith(expect.objectContaining({
      query: "发布",
      limit: 20,
    }));
    expect(onOpenResult).toHaveBeenCalledWith(result);
  });

  it("shows a recoverable error and an explicit empty state", async () => {
    const failing = client({ search: vi.fn().mockRejectedValueOnce(new Error("offline")) });
    const user = userEvent.setup();
    const view = render(
      <ConversationSearch client={failing} onClose={() => undefined} onOpenResult={() => undefined} rooms={[]} />,
    );
    await user.type(screen.getByLabelText("搜索关键词"), "missing");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时不可用");

    view.unmount();
    render(
      <ConversationSearch
        client={client({ search: vi.fn(async () => ({ results: [], nextCursor: null })) })}
        onClose={() => undefined}
        onOpenResult={() => undefined}
        rooms={[]}
      />,
    );
    await user.type(screen.getByLabelText("搜索关键词"), "nothing");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("没有找到匹配内容。")).toBeInTheDocument();
  });
});

describe("room files", () => {
  it("renders a downloadable file and opens its source message", async () => {
    const onOpenMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <RoomFiles client={client()} onOpenMessage={onOpenMessage} roomId={result.roomId} />,
    );

    await user.click(await screen.findByRole("button", { name: /发布计划/ }));

    expect(onOpenMessage).toHaveBeenCalledWith(result.messageId);
    expect(screen.getByRole("link", { name: "下载 发布计划.pdf" })).toHaveAttribute(
      "href",
      expect.stringContaining(result.id),
    );
  });
});

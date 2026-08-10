"use client";

import { FileText, MessageCircle, Search, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { RoomSummaryRecord } from "@/domain/collaboration";
import {
  browserSearchClient,
  type SearchCategory,
  type SearchClient,
  type SearchResult,
} from "@/lib/search-client";

export function ConversationSearch({
  client = browserSearchClient,
  onClose,
  onOpenResult,
  rooms,
}: {
  client?: SearchClient;
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
  rooms: RoomSummaryRecord[];
}) {
  const [query, setQuery] = useState("");
  const [roomId, setRoomId] = useState("");
  const [category, setCategory] = useState<SearchCategory | "">("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  async function runSearch(cursor?: string) {
    const normalized = query.trim();
    if (!normalized) return;
    setState("loading");
    try {
      const page = await client.search({
        query: normalized,
        roomId: roomId || undefined,
        category: category || undefined,
        cursor,
        limit: 20,
      });
      setResults((current) => cursor ? [...current, ...page.results] : page.results);
      setNextCursor(page.nextCursor);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <aside aria-label="搜索消息和文件" className="conversation-search">
      <header>
        <div><span>SEARCH</span><h2>搜索</h2></div>
        <button aria-label="关闭搜索" onClick={onClose} type="button">
          <X aria-hidden="true" size={16} strokeWidth={1.6} />
        </button>
      </header>
      <form onSubmit={submit}>
        <label>
          <Search aria-hidden="true" size={16} strokeWidth={1.6} />
          <input
            aria-label="搜索关键词"
            autoFocus
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索消息或文件名"
            value={query}
          />
        </label>
        <div>
          <select aria-label="搜索房间" onChange={(event) => setRoomId(event.target.value)} value={roomId}>
            <option value="">全部房间</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
          <select aria-label="搜索类型" onChange={(event) => setCategory(event.target.value as SearchCategory | "")} value={category}>
            <option value="">全部类型</option>
            <option value="message">消息</option>
            <option value="file">文件</option>
            <option value="image">图片</option>
            <option value="document">文档</option>
            <option value="archive">压缩包</option>
            <option value="agent_output">AI 产出</option>
          </select>
          <button disabled={!query.trim() || state === "loading"} type="submit">搜索</button>
        </div>
      </form>
      <div className="conversation-search__results" aria-live="polite">
        {state === "idle" ? <p>输入关键词查找当前工作空间的消息与文件。</p> : null}
        {state === "loading" && results.length === 0 ? <p role="status">正在搜索…</p> : null}
        {state === "error" ? (
          <div role="alert"><p>搜索暂时不可用。</p><button onClick={() => void runSearch()} type="button">重试</button></div>
        ) : null}
        {state === "ready" && results.length === 0 ? <p>没有找到匹配内容。</p> : null}
        {results.map((result) => (
          <button className="conversation-search__result" key={`${result.kind}-${result.id}`} onClick={() => onOpenResult(result)} type="button">
            <span>{result.kind === "message" ? <MessageCircle size={15} /> : <FileText size={15} />}</span>
            <span><strong>{result.text}</strong><small>{result.roomName} · {result.senderDisplayName}</small></span>
          </button>
        ))}
        {nextCursor ? <button className="conversation-search__more" disabled={state === "loading"} onClick={() => void runSearch(nextCursor)} type="button">加载更多</button> : null}
      </div>
    </aside>
  );
}

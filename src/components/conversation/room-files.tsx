"use client";

import { Archive, Bot, FileText, Image as ImageIcon, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  browserSearchClient,
  type SearchClient,
  type SearchResult,
} from "@/lib/search-client";

const labels = {
  image: "图片",
  document: "文档",
  archive: "压缩包",
  agent_output: "AI 产出",
  message: "消息",
} as const;

function FileIcon({ category }: { category: SearchResult["category"] }) {
  if (category === "image") return <ImageIcon aria-hidden="true" size={14} />;
  if (category === "archive") return <Archive aria-hidden="true" size={14} />;
  if (category === "agent_output") return <Bot aria-hidden="true" size={14} />;
  return <FileText aria-hidden="true" size={14} />;
}

export function RoomFiles({
  client = browserSearchClient,
  onOpenMessage,
  roomId,
}: {
  client?: SearchClient;
  onOpenMessage: (messageId: string) => void;
  roomId: string;
}) {
  const [files, setFiles] = useState<SearchResult[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function load() {
    setState("loading");
    try {
      const result = await client.listRoomFiles(roomId);
      setFiles(result.files);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    let active = true;
    void client.listRoomFiles(roomId).then((result) => {
      if (!active) return;
      setFiles(result.files);
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => {
      active = false;
    };
  }, [client, roomId]);

  if (state === "loading") return <p className="room-files__state" role="status">正在读取文件…</p>;
  if (state === "error") {
    return <div className="room-files__state" role="alert"><span>文件暂时无法载入。</span><button aria-label="重试房间文件" onClick={() => void load()} type="button"><RotateCcw size={13} /></button></div>;
  }
  if (files.length === 0) return <p className="room-files__state">这个房间还没有文件。</p>;

  return (
    <div className="room-files">
      {files.map((file) => (
        <div className="room-files__item" key={file.id}>
          <FileIcon category={file.category} />
          <button onClick={() => onOpenMessage(file.messageId)} type="button">
            <strong>{file.text}</strong>
            <small>{labels[file.category]} · {file.senderDisplayName}</small>
          </button>
          <a aria-label={`下载 ${file.text}`} href={`/api/v1/attachments/${encodeURIComponent(file.id)}/content?roomId=${encodeURIComponent(roomId)}`} title="下载">↓</a>
        </div>
      ))}
    </div>
  );
}

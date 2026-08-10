"use client";

import { File, Paperclip, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AttachmentMetadata } from "@/domain/collaboration";
import {
  browserAttachmentClient,
  type AttachmentClient,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
} from "@/lib/attachment-client";

type UploadState = "selected" | "uploading" | "ready" | "failed";

interface UploadItem {
  localId: string;
  file: File;
  state: UploadState;
  progress: number;
  attachment: AttachmentMetadata | null;
}

function key(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function stateLabel(item: UploadItem): string {
  if (item.state === "selected") return "已选择";
  if (item.state === "uploading") return `${item.progress}%`;
  if (item.state === "ready") return "已就绪";
  return "上传失败";
}

export function AttachmentComposer({
  client = browserAttachmentClient,
  disabled = false,
  onReadyChange,
  onBusyChange,
}: {
  client?: AttachmentClient;
  disabled?: boolean;
  onReadyChange: (attachments: AttachmentMetadata[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onReadyChange(
      items.flatMap((item) => item.state === "ready" && item.attachment
        ? [item.attachment]
        : []),
    );
  }, [items, onReadyChange]);

  useEffect(() => {
    onBusyChange?.(items.some((item) => item.state === "selected" || item.state === "uploading"));
  }, [items, onBusyChange]);

  async function upload(localId: string, file: File) {
    setItems((current) => current.map((item) =>
      item.localId === localId
        ? { ...item, state: "uploading", progress: 0, attachment: null }
        : item,
    ));
    try {
      const pending = await client.begin(file, key());
      const attachment = await client.upload(
        pending.attachment.id,
        file,
        (progress) => setItems((current) => current.map((item) =>
          item.localId === localId ? { ...item, progress } : item,
        )),
      );
      setItems((current) => current.map((item) =>
        item.localId === localId
          ? { ...item, state: "ready", progress: 100, attachment }
          : item,
      ));
    } catch {
      setItems((current) => current.map((item) =>
        item.localId === localId ? { ...item, state: "failed", progress: 0 } : item,
      ));
    }
  }

  function selectFiles(files: FileList | null) {
    setError(null);
    if (!files?.length) return;
    const selected = Array.from(files);
    if (items.length + selected.length > MAX_ATTACHMENT_COUNT) {
      setError(`每条消息最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`);
      return;
    }
    const oversize = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversize) {
      setError(`${oversize.name} 超过 25 MiB，无法上传。`);
      return;
    }
    const additions = selected.map((file) => ({
      localId: key(),
      file,
      state: "selected" as const,
      progress: 0,
      attachment: null,
    }));
    setItems((current) => [...current, ...additions]);
    for (const item of additions) void upload(item.localId, item.file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="attachment-composer">
      {items.length > 0 ? (
        <div className="attachment-composer__queue" aria-label="待发送附件">
          {items.map((item) => (
            <div className="attachment-composer__item" data-state={item.state} key={item.localId}>
              <File aria-hidden="true" size={15} strokeWidth={1.6} />
              <span title={item.file.name}>{item.file.name}</span>
              <small>{stateLabel(item)}</small>
              {item.state === "failed" ? (
                <button
                  aria-label={`重试 ${item.file.name}`}
                  onClick={() => void upload(item.localId, item.file)}
                  title="重试"
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={13} />
                </button>
              ) : null}
              <button
                aria-label={`移除 ${item.file.name}`}
                disabled={item.state === "uploading"}
                onClick={() => setItems((current) => current.filter((entry) => entry.localId !== item.localId))}
                title="移除"
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
              {item.state === "uploading" ? (
                <span aria-hidden="true" className="attachment-composer__progress" style={{ width: `${item.progress}%` }} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <label className="attachment-composer__add" title="添加附件">
        <Paperclip aria-hidden="true" size={17} strokeWidth={1.7} />
        <span className="sr-only">添加附件</span>
        <input
          aria-label="添加附件"
          disabled={disabled}
          multiple
          onChange={(event) => selectFiles(event.target.files)}
          ref={inputRef}
          type="file"
        />
      </label>
      {error ? <p className="attachment-composer__error" role="alert">{error}</p> : null}
    </div>
  );
}

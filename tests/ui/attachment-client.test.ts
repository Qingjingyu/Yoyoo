/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import { createAttachmentClient } from "@/lib/attachment-client";

class FakeXhr {
  status = 200;
  responseText = JSON.stringify({
    attachment: { id: "attachment-1", originalName: "计划.txt", status: "ready" },
  });
  uploadListeners = new Map<string, (event: ProgressEvent) => void>();
  listeners = new Map<string, () => void>();
  upload = {
    addEventListener: (type: string, listener: (event: ProgressEvent) => void) => {
      this.uploadListeners.set(type, listener);
    },
  };
  open = vi.fn();
  setRequestHeader = vi.fn();
  addEventListener = (type: string, listener: () => void) => {
    this.listeners.set(type, listener);
  };
  send = vi.fn(() => {
    this.uploadListeners.get("progress")?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    this.listeners.get("load")?.();
  });
}

describe("AttachmentClient", () => {
  it("creates an upload and reports binary progress", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      duplicate: false,
      attachment: { id: "attachment-1", originalName: "计划.txt", status: "pending" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const xhr = new FakeXhr();
    const client = createAttachmentClient({
      fetcher,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    const file = new File(["1234567890"], "计划.txt", { type: "text/plain" });
    const progress = vi.fn();

    const pending = await client.begin(file, "upload-key");
    const ready = await client.upload(pending.attachment.id, file, progress);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/attachments", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "upload-key" }),
      body: JSON.stringify({ originalName: "计划.txt", declaredMediaType: "text/plain" }),
    }));
    expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/v1/attachments/attachment-1");
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(progress).toHaveBeenCalledWith(50);
    expect(ready).toMatchObject({ id: "attachment-1", status: "ready" });
  });
});

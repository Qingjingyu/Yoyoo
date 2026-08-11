import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AttachmentComposer } from "@/components/conversation/attachment-composer";
import type { AttachmentClient } from "@/lib/attachment-client";

function client(overrides: Partial<AttachmentClient> = {}): AttachmentClient {
  return {
    begin: vi.fn(async (file) => ({
      duplicate: false,
      attachment: {
        id: "attachment-1",
        workspaceId: "workspace",
        uploaderPrincipalId: "subai",
        originalName: file.name,
        declaredMediaType: file.type,
        detectedMediaType: null,
        sizeBytes: null,
        sha256: null,
        status: "pending" as const,
        provenance: "human_upload" as const,
        sourceRunId: null,
        errorCode: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })),
    upload: vi.fn(async (id, file, onProgress) => {
      onProgress(60);
      return {
        id,
        workspaceId: "workspace",
        uploaderPrincipalId: "subai",
        originalName: file.name,
        declaredMediaType: file.type,
        detectedMediaType: file.type,
        sizeBytes: file.size,
        sha256: "a".repeat(64),
        status: "ready" as const,
        provenance: "human_upload" as const,
        sourceRunId: null,
        errorCode: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    ...overrides,
  };
}

describe("AttachmentComposer", () => {
  it("exposes upload progress as a transform-ready ratio", async () => {
    let finishUpload: (() => void) | undefined;
    const attachmentClient = client({
      upload: vi.fn(async (id, file, onProgress) => {
        onProgress(60);
        await new Promise<void>((resolve) => {
          finishUpload = resolve;
        });
        return {
          id,
          workspaceId: "workspace",
          uploaderPrincipalId: "subai",
          originalName: file.name,
          declaredMediaType: file.type,
          detectedMediaType: file.type,
          sizeBytes: file.size,
          sha256: "c".repeat(64),
          status: "ready" as const,
          provenance: "human_upload" as const,
          sourceRunId: null,
          errorCode: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    });
    const user = userEvent.setup();
    const { container } = render(
      <AttachmentComposer client={attachmentClient} onReadyChange={() => undefined} />,
    );

    await user.upload(
      screen.getByLabelText("添加附件"),
      new File(["progress"], "progress.txt", { type: "text/plain" }),
    );

    expect(await screen.findByText("60%")).toBeInTheDocument();
    const progress = container.querySelector<HTMLElement>(".attachment-composer__progress");
    expect(progress?.style.getPropertyValue("--attachment-progress")).toBe("0.6");
    expect(progress?.style.width).toBe("");

    finishUpload?.();
  });

  it("uploads a selected file and exposes the ready attachment", async () => {
    const attachmentClient = client();
    const onReadyChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AttachmentComposer
        client={attachmentClient}
        onReadyChange={onReadyChange}
      />,
    );

    await user.upload(
      screen.getByLabelText("添加附件"),
      new File(["hello"], "一份很长的项目计划.txt", { type: "text/plain" }),
    );

    expect(await screen.findByText("一份很长的项目计划.txt")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已就绪")).toBeInTheDocument());
    expect(onReadyChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "attachment-1", status: "ready" }),
    ]);
    expect(screen.getByRole("button", { name: "移除 一份很长的项目计划.txt" })).toBeInTheDocument();
  });

  it("keeps a failed file retryable and rejects an oversize selection", async () => {
    const attachmentClient = client({
      upload: vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(
        async (id: string, file: File) => ({
          id,
          workspaceId: "workspace",
          uploaderPrincipalId: "subai",
          originalName: file.name,
          declaredMediaType: file.type,
          detectedMediaType: file.type,
          sizeBytes: file.size,
          sha256: "b".repeat(64),
          status: "ready" as const,
          provenance: "human_upload" as const,
          sourceRunId: null,
          errorCode: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    });
    const user = userEvent.setup();
    render(<AttachmentComposer client={attachmentClient} onReadyChange={() => undefined} />);

    await user.upload(
      screen.getByLabelText("添加附件"),
      new File(["retry"], "retry.txt", { type: "text/plain" }),
    );
    expect(await screen.findByRole("button", { name: "重试 retry.txt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试 retry.txt" }));
    await waitFor(() => expect(screen.getByText("已就绪")).toBeInTheDocument());

    const huge = new File(["x"], "huge.zip", { type: "application/zip" });
    Object.defineProperty(huge, "size", { value: 25 * 1024 * 1024 + 1 });
    await user.upload(screen.getByLabelText("添加附件"), huge);
    expect(await screen.findByRole("alert")).toHaveTextContent("25 MiB");
  });
});

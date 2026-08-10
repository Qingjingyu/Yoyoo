import type { AttachmentMetadata } from "@/domain/collaboration";

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class AttachmentApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AttachmentApiError";
  }
}

export interface AttachmentClient {
  begin(file: File, idempotencyKey: string): Promise<{
    duplicate: boolean;
    attachment: AttachmentMetadata;
  }>;
  upload(
    attachmentId: string,
    file: File,
    onProgress: (percent: number) => void,
  ): Promise<AttachmentMetadata>;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new AttachmentApiError(
      body.error?.code ?? "UPLOAD_FAILED",
      body.error?.message ?? "附件上传失败。",
      response.status,
    );
  }
  return body;
}

function parseXhr<T>(xhr: XMLHttpRequest): T {
  let body: T & { error?: { code?: string; message?: string } };
  try {
    body = JSON.parse(xhr.responseText) as typeof body;
  } catch {
    throw new AttachmentApiError("UPLOAD_FAILED", "附件上传失败。", xhr.status);
  }
  if (xhr.status < 200 || xhr.status >= 300) {
    throw new AttachmentApiError(
      body.error?.code ?? "UPLOAD_FAILED",
      body.error?.message ?? "附件上传失败。",
      xhr.status,
    );
  }
  return body;
}

export function createAttachmentClient(options: {
  fetcher?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
} = {}): AttachmentClient {
  const fetcher = options.fetcher ?? fetch;
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
  return {
    async begin(file, idempotencyKey) {
      return responseJson(await fetcher("/api/v1/attachments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          originalName: file.name,
          declaredMediaType: file.type || "application/octet-stream",
        }),
      }));
    },

    upload(attachmentId, file, onProgress) {
      return new Promise<AttachmentMetadata>((resolve, reject) => {
        const xhr = xhrFactory();
        xhr.open("PUT", `/api/v1/attachments/${encodeURIComponent(attachmentId)}`);
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable || event.total <= 0) return;
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        });
        xhr.addEventListener("load", () => {
          try {
            const body = parseXhr<{ attachment: AttachmentMetadata }>(xhr);
            onProgress(100);
            resolve(body.attachment);
          } catch (error) {
            reject(error);
          }
        });
        xhr.addEventListener("error", () => {
          reject(new AttachmentApiError("NETWORK_ERROR", "网络中断，附件未上传。", 0));
        });
        xhr.addEventListener("abort", () => {
          reject(new AttachmentApiError("UPLOAD_ABORTED", "附件上传已取消。", 0));
        });
        xhr.send(file);
      });
    },
  };
}

export const browserAttachmentClient = createAttachmentClient();

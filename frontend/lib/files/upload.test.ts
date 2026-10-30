import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  retryWhileBusy,
  sendToStorage,
  uploadAvatar,
  UploadError,
  type UploadTicket,
} from "@/lib/files/upload";
import { ApiError } from "@/lib/api";

type Outcome = { status: number } | "network-error";

let outcomes: Outcome[] = [];
const sent: { method: string; url: string; headers: Record<string, string>; withCredentials: boolean }[] = [];

class FakeXHR {
  status = 0;
  withCredentials = true;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private method = "";
  private url = "";
  private headers: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    sent.push({
      method: this.method,
      url: this.url,
      headers: this.headers,
      withCredentials: this.withCredentials,
    });
    const outcome = outcomes.shift() ?? { status: 200 };
    queueMicrotask(() => {
      if (outcome === "network-error") return this.onerror?.();
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = outcome.status;
      this.onload?.();
    });
  }
}

const ticket: UploadTicket = {
  fileId: "f1",
  method: "PUT",
  uploadUrl: "https://storage.example.com/bucket/key?X-Amz-Signature=abc",
  headers: { "Content-Type": "application/pdf" },
  expiresAt: new Date().toISOString(),
  contentType: "application/pdf",
  maxBytes: 10,
};

describe("sendToStorage", () => {
  const original = globalThis.XMLHttpRequest;

  beforeEach(() => {
    outcomes = [];
    sent.length = 0;
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = original;
  });

  test("PUTs to the presigned URL with only the signed headers", async () => {
    const progress: number[] = [];
    await sendToStorage(new Blob(["x"]), ticket, (f) => progress.push(f));
    expect(sent).toEqual([
      {
        method: "PUT",
        url: ticket.uploadUrl,
        headers: { "Content-Type": "application/pdf" },
        withCredentials: false,
      },
    ]);
    expect(progress).toEqual([0.5, 1]);
  });

  test("retries once on a network error", async () => {
    outcomes = ["network-error", { status: 200 }];
    await sendToStorage(new Blob(["x"]), ticket);
    expect(sent).toHaveLength(2);
  });

  test("gives up after the retry", async () => {
    outcomes = ["network-error", "network-error"];
    await expect(sendToStorage(new Blob(["x"]), ticket)).rejects.toBeInstanceOf(UploadError);
    expect(sent).toHaveLength(2);
  });

  test("reports a non-2xx status without retrying", async () => {
    outcomes = [{ status: 403 }];
    await expect(sendToStorage(new Blob(["x"]), ticket)).rejects.toThrow("Upload failed (403)");
    expect(sent).toHaveLength(1);
  });
});

describe("retryWhileBusy", () => {
  test("retries a 503 and returns the eventual result", async () => {
    let calls = 0;
    const out = await retryWhileBusy(async () => {
      calls++;
      if (calls < 3) throw new ApiError(503, "busy");
      return "done";
    }, [0, 0, 0]);
    expect(out).toBe("done");
    expect(calls).toBe(3);
  });

  test("gives up after the last delay", async () => {
    let calls = 0;
    const err = await retryWhileBusy(async () => {
      calls++;
      throw new ApiError(503, "busy");
    }, [0, 0]).catch((e) => e);
    expect((err as ApiError).status).toBe(503);
    expect(calls).toBe(3);
  });

  test("does not retry other errors", async () => {
    let calls = 0;
    const err = await retryWhileBusy(async () => {
      calls++;
      throw new ApiError(400, "bad");
    }, [0, 0]).catch((e) => e);
    expect((err as ApiError).status).toBe(400);
    expect(calls).toBe(1);
  });
});

describe("uploadAvatar", () => {
  const originalXHR = globalThis.XMLHttpRequest;
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];

  beforeEach(() => {
    outcomes = [];
    sent.length = 0;
    calls.length = 0;
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      const reply = url.endsWith("/auth/avatar/resumable")
        ? {
            path: "uploads/avatars/u.jpg",
            method: "PUT",
            uploadUrl: "https://storage.example.com/images/uploads/avatars/u.jpg?sig",
            headers: { "Content-Type": "image/jpeg" },
            expiresAt: new Date().toISOString(),
          }
        : { avatar_url: "https://api.example.com/api/images/avatars/u.jpg?t=1" };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.fetch = originalFetch;
  });

  test("asks for a ticket, PUTs to storage, then completes with the staged path", async () => {
    const image = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const url = await uploadAvatar(image, "avatar.jpg");

    expect(calls[0].url).toEndWith("/auth/avatar/resumable");
    expect(calls[0].body).toEqual({
      filename: "avatar.jpg",
      contentType: "image/jpeg",
      totalSize: image.size,
    });
    expect(sent).toEqual([
      {
        method: "PUT",
        url: "https://storage.example.com/images/uploads/avatars/u.jpg?sig",
        headers: { "Content-Type": "image/jpeg" },
        withCredentials: false,
      },
    ]);
    expect(calls[1].url).toEndWith("/auth/avatar/complete");
    expect(calls[1].body).toEqual({ path: "uploads/avatars/u.jpg" });
    expect(url).toBe("https://api.example.com/api/images/avatars/u.jpg?t=1");
  });

  test("does not complete when storage refuses the bytes", async () => {
    outcomes = [{ status: 403 }];
    await expect(
      uploadAvatar(new Blob(["x"], { type: "image/jpeg" }), "avatar.jpg"),
    ).rejects.toBeInstanceOf(UploadError);
    expect(calls).toHaveLength(1);
  });
});

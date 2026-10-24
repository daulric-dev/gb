import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendToStorage, UploadError, type UploadTicket } from "@/lib/files/upload";

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

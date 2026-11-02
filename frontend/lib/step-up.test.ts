import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

globalThis.document ??= { cookie: "" } as unknown as Document;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

import { ApiError, api, setStepUpHandler, STEP_UP_REQUIRED } from "@/lib/api";
import { cleanStepUpCode, createStepUpPrompt, verifyStepUpCode } from "@/lib/step-up";

const stepUpResponse = () =>
  new Response(
    JSON.stringify({
      statusCode: 403,
      code: STEP_UP_REQUIRED,
      message: "Confirm it's you to change single sign-on settings.",
    }),
    { status: 403 },
  );
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("api() step-up", () => {
  const originalFetch = globalThis.fetch;
  let responses: Response[];
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    responses = [];
    fetchMock = mock(async () => responses.shift() ?? ok({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setStepUpHandler(null);
  });

  test("asks to confirm, then retries the original request with the same body", async () => {
    responses = [stepUpResponse(), ok({ saved: true })];
    const handler = mock(async () => true);
    setStepUpHandler(handler);

    const result = await api("/schools/current/sso/providers/google", {
      method: "PUT",
      body: { enabled: true },
      stepUp: true,
    });

    expect(result).toEqual({ saved: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[1][1].method).toBe("PUT");
    expect(calls[1][1].body).toBe(JSON.stringify({ enabled: true }));
  });

  test("cancelling the dialog throws the STEP_UP_REQUIRED error without retrying", async () => {
    responses = [stepUpResponse()];
    setStepUpHandler(async () => false);
    const err = await api("/schools/email-domains", { method: "POST", stepUp: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe(STEP_UP_REQUIRED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("only requests that opt in are retried", async () => {
    responses = [stepUpResponse()];
    const handler = mock(async () => true);
    setStepUpHandler(handler);
    await expect(api("/schools/email-domains", { method: "POST" })).rejects.toThrow(
      "Confirm it's you",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  test("no registered dialog: the error is thrown", async () => {
    responses = [stepUpResponse()];
    await expect(api("/x", { method: "POST", stepUp: true })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries once: a second STEP_UP_REQUIRED is thrown, not looped on", async () => {
    responses = [stepUpResponse(), stepUpResponse()];
    const handler = mock(async () => true);
    setStepUpHandler(handler);
    const err = await api("/x", { method: "PATCH", stepUp: true }).catch((e) => e);
    expect((err as ApiError).code).toBe(STEP_UP_REQUIRED);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("other errors are not step-up", async () => {
    responses = [new Response(JSON.stringify({ message: "Nope" }), { status: 403 })];
    const handler = mock(async () => true);
    setStepUpHandler(handler);
    await expect(api("/x", { method: "PATCH", stepUp: true })).rejects.toThrow("Nope");
    expect(handler).not.toHaveBeenCalled();
  });

  test("requests waiting at the same time share one confirmation", async () => {
    responses = [stepUpResponse(), stepUpResponse(), ok({ n: 1 }), ok({ n: 2 })];
    let confirm!: (ok: boolean) => void;
    const handler = mock(() => new Promise<boolean>((r) => (confirm = r)));
    setStepUpHandler(handler);
    const a = api("/a", { method: "PATCH", stepUp: true });
    const b = api("/b", { method: "PATCH", stepUp: true });
    await new Promise((r) => setTimeout(r, 10));
    confirm(true);
    await Promise.all([a, b]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("verifying sends the trimmed code", async () => {
    responses = [ok({ elevatedUntil: "2026-11-02T10:10:00.000Z" })];
    await verifyStepUpCode(" 12345678 ");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/api/auth/step-up/verify");
    expect(init.body).toBe(JSON.stringify({ code: "12345678" }));
  });
});

describe("createStepUpPrompt", () => {
  test("shows on request and settles with the answer", async () => {
    const shown: boolean[] = [];
    const prompt = createStepUpPrompt((open) => shown.push(open));
    const first = prompt.request();
    const again = prompt.request();
    expect(again).toBe(first);
    prompt.confirmed();
    expect(await first).toBe(true);
    expect(shown).toEqual([true, false]);

    const second = prompt.request();
    prompt.dismissed();
    expect(await second).toBe(false);
  });

  test("cleanStepUpCode keeps 8 digits of a pasted code", () => {
    expect(cleanStepUpCode("1234 5678 9")).toBe("12345678");
    expect(cleanStepUpCode("12-34")).toBe("1234");
  });
});

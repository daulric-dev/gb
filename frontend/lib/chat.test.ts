import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chatConnected, connectChat, disconnectChat, reconnectDelay } from "./chat";

describe("reconnectDelay", () => {
  test("grows exponentially and caps at 30s", () => {
    const max = () => 1;
    expect(reconnectDelay(1, max)).toBe(1_000);
    expect(reconnectDelay(2, max)).toBe(2_000);
    expect(reconnectDelay(4, max)).toBe(8_000);
    expect(reconnectDelay(6, max)).toBe(30_000);
    expect(reconnectDelay(50, max)).toBe(30_000);
  });

  test("jitters within the upper half of the window", () => {
    expect(reconnectDelay(3, () => 0)).toBe(2_000);
    expect(reconnectDelay(3, () => 0.5)).toBe(3_000);
    for (let i = 0; i < 20; i++) {
      const d = reconnectDelay(6);
      expect(d).toBeGreaterThanOrEqual(15_000);
      expect(d).toBeLessThanOrEqual(30_000);
    }
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

describe("chat stream", () => {
  const realEventSource = globalThis.EventSource;
  const realFetch = globalThis.fetch;
  const realRandom = Math.random;

  beforeEach(() => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch = mock(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    // Shortest jitter: the first retry comes after 500ms.
    Math.random = () => 0;
  });

  afterEach(() => {
    disconnectChat();
    globalThis.EventSource = realEventSource;
    globalThis.fetch = realFetch;
    Math.random = realRandom;
  });

  test("connects to the API's chat stream", () => {
    connectChat("u1");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toEndWith("/api/chat/stream");
  });

  test("reconnects after an error instead of staying dead", async () => {
    connectChat("u1");
    const first = FakeEventSource.instances[0];
    first.onopen?.();
    expect(chatConnected.value).toBe(true);

    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(chatConnected.value).toBe(false);

    await Bun.sleep(600);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1].onopen?.();
    expect(chatConnected.value).toBe(true);
  });

  test("disconnectChat cancels a pending reconnect", async () => {
    connectChat("u1");
    FakeEventSource.instances[0].onerror?.();
    disconnectChat();
    await Bun.sleep(600);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

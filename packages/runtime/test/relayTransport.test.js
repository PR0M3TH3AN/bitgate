import { afterEach, describe, expect, it, vi } from "vitest";

import { createRelayTransport } from "../src/relayTransport.js";

const NOW = 1_750_000_000;

/** Every socket built during a test, so assertions can drive them. */
let sockets = [];

/** A scriptable WebSocket stand-in. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    sockets.push(this);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.closed = true;
  }

  /** Simulate the relay accepting the connection. */
  open() {
    this.onopen?.();
  }

  /** Simulate a frame arriving from the relay. */
  deliver(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Simulate the connection dropping. */
  drop() {
    this.onclose?.();
  }

  /** Frames of a given verb that this socket was asked to send. */
  sentOf(verb) {
    return this.sent.filter((frame) => frame[0] === verb);
  }
}

const event = (id) => ({
  id,
  pubkey: "a1".repeat(32),
  kind: 1,
  created_at: NOW,
  tags: [],
  content: "",
});

function makeTransport(urls = ["wss://one.example"], options = {}) {
  return createRelayTransport(urls, { WebSocketImpl: /** @type {any} */ (FakeSocket), ...options });
}

afterEach(() => {
  sockets = [];
  vi.useRealTimers();
});

describe("construction", () => {
  it("requires at least one relay", () => {
    expect(() => makeTransport([])).toThrow(/at least one relay/);
    expect(() => makeTransport([" ", ""])).toThrow(/at least one relay/);
  });

  it("requires a usable WebSocket implementation", () => {
    // Node 22 has a global WebSocket, so passing null correctly falls back to
    // it. The guard is for environments that have neither.
    expect(() =>
      createRelayTransport(["wss://one.example"], { WebSocketImpl: /** @type {any} */ (42) }),
    ).toThrow(/WebSocket implementation/);
  });

  it("falls back to the global WebSocket when none is injected", () => {
    expect(() => createRelayTransport(["wss://one.example"])).not.toThrow();
  });

  it("opens one socket per relay", () => {
    makeTransport(["wss://one.example", "wss://two.example"]);
    expect(sockets.map((socket) => socket.url)).toEqual([
      "wss://one.example",
      "wss://two.example",
    ]);
  });

  it("trims and drops blank relay URLs", () => {
    const transport = makeTransport(["  wss://one.example  ", ""]);
    expect(transport.relays).toEqual(["wss://one.example"]);
  });
});

describe("connection lifecycle", () => {
  it("issues a subscription exactly once when it opens", () => {
    const transport = makeTransport();
    transport.subscribe([{ kinds: [1] }], {});

    // Nothing can be sent yet — the socket has not opened.
    expect(sockets[0].sent).toHaveLength(0);

    sockets[0].open();
    // Re-issued from the subscription map, not also flushed from the queue.
    expect(sockets[0].sentOf("REQ")).toHaveLength(1);
  });

  it("queues a publish made before the socket opens", async () => {
    const transport = makeTransport();
    const published = event("bb".repeat(32));
    const pending = transport.publish(published);

    expect(sockets[0].sentOf("EVENT")).toHaveLength(0);
    sockets[0].open();
    expect(sockets[0].sentOf("EVENT")).toHaveLength(1);

    sockets[0].deliver(["OK", published.id, true, ""]);
    expect((await pending).ok).toBe(true);
  });

  it("re-opens live subscriptions after a reconnect", () => {
    vi.useFakeTimers();
    const transport = makeTransport(["wss://one.example"], { reconnectDelay: 10 });
    sockets[0].open();
    transport.subscribe([{ kinds: [1] }], {});
    expect(sockets[0].sentOf("REQ")).toHaveLength(1);

    sockets[0].drop();
    vi.advanceTimersByTime(20);

    // A fresh socket was created and the subscription re-issued on open.
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].sentOf("REQ")).toHaveLength(1);
  });

  it("backs off between reconnect attempts", () => {
    vi.useFakeTimers();
    makeTransport(["wss://one.example"], { reconnectDelay: 100 });

    sockets[0].drop();
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);

    // Second failure waits longer than the first.
    sockets[1].drop();
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(3);
  });

  it("stops reconnecting once closed", () => {
    vi.useFakeTimers();
    const transport = makeTransport(["wss://one.example"], { reconnectDelay: 10 });
    transport.close();
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(1);
  });

  it("closes every socket on close", () => {
    const transport = makeTransport(["wss://one.example", "wss://two.example"]);
    transport.close();
    expect(sockets.every((socket) => socket.closed)).toBe(true);
  });
});

describe("list", () => {
  it("resolves with stored events once every relay sends EOSE", async () => {
    const transport = makeTransport(["wss://one.example", "wss://two.example"]);
    sockets.forEach((socket) => socket.open());

    const pending = transport.list([{ kinds: [1] }]);
    const id = sockets[0].sentOf("REQ")[0][1];

    sockets[0].deliver(["EVENT", id, event("aa".repeat(32))]);
    sockets[0].deliver(["EOSE", id]);
    sockets[1].deliver(["EOSE", id]);

    expect(await pending).toHaveLength(1);
  });

  it("deduplicates events served by more than one relay", async () => {
    const transport = makeTransport(["wss://one.example", "wss://two.example"]);
    sockets.forEach((socket) => socket.open());

    const pending = transport.list([{ kinds: [1] }]);
    const id = sockets[0].sentOf("REQ")[0][1];
    const duplicate = event("aa".repeat(32));

    sockets[0].deliver(["EVENT", id, duplicate]);
    sockets[1].deliver(["EVENT", id, duplicate]);
    sockets[0].deliver(["EOSE", id]);
    sockets[1].deliver(["EOSE", id]);

    expect(await pending).toHaveLength(1);
  });

  it("returns what it has when a relay never answers", async () => {
    vi.useFakeTimers();
    const transport = makeTransport(["wss://one.example", "wss://slow.example"], {
      listTimeout: 1_000,
    });
    sockets.forEach((socket) => socket.open());

    const pending = transport.list([{ kinds: [1] }]);
    const id = sockets[0].sentOf("REQ")[0][1];

    sockets[0].deliver(["EVENT", id, event("aa".repeat(32))]);
    sockets[0].deliver(["EOSE", id]);
    // The second relay stays silent; the timeout must not discard what arrived.
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toHaveLength(1);
  });

  it("closes the subscription when it resolves", async () => {
    const transport = makeTransport();
    sockets[0].open();

    const pending = transport.list([{ kinds: [1] }]);
    const id = sockets[0].sentOf("REQ")[0][1];
    sockets[0].deliver(["EOSE", id]);
    await pending;

    expect(sockets[0].sentOf("CLOSE")[0][1]).toBe(id);
  });

  it("ignores malformed frames", async () => {
    const transport = makeTransport();
    sockets[0].open();

    const pending = transport.list([{ kinds: [1] }]);
    const id = sockets[0].sentOf("REQ")[0][1];

    sockets[0].onmessage?.({ data: "not json" });
    sockets[0].onmessage?.({ data: JSON.stringify({ not: "an array" }) });
    sockets[0].deliver(["EOSE", id]);

    expect(await pending).toEqual([]);
  });
});

describe("subscribe", () => {
  it("delivers events to the handler", () => {
    const transport = makeTransport();
    sockets[0].open();

    const onEvent = vi.fn();
    transport.subscribe([{ kinds: [1] }], { onEvent });
    const id = sockets[0].sentOf("REQ")[0][1];

    sockets[0].deliver(["EVENT", id, event("aa".repeat(32))]);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("deduplicates across relays", () => {
    const transport = makeTransport(["wss://one.example", "wss://two.example"]);
    sockets.forEach((socket) => socket.open());

    const onEvent = vi.fn();
    transport.subscribe([{ kinds: [1] }], { onEvent });
    const id = sockets[0].sentOf("REQ")[0][1];
    const duplicate = event("aa".repeat(32));

    sockets[0].deliver(["EVENT", id, duplicate]);
    sockets[1].deliver(["EVENT", id, duplicate]);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("reports EOSE", () => {
    const transport = makeTransport();
    sockets[0].open();

    const onEose = vi.fn();
    transport.subscribe([{ kinds: [1] }], { onEose });
    sockets[0].deliver(["EOSE", sockets[0].sentOf("REQ")[0][1]]);
    expect(onEose).toHaveBeenCalled();
  });

  it("stops delivering after close", () => {
    const transport = makeTransport();
    sockets[0].open();

    const onEvent = vi.fn();
    const handle = transport.subscribe([{ kinds: [1] }], { onEvent });
    const id = sockets[0].sentOf("REQ")[0][1];

    handle.close();
    sockets[0].deliver(["EVENT", id, event("aa".repeat(32))]);

    expect(onEvent).not.toHaveBeenCalled();
    expect(sockets[0].sentOf("CLOSE")).toHaveLength(1);
  });
});

describe("publish", () => {
  it("succeeds when a relay accepts", async () => {
    const transport = makeTransport();
    sockets[0].open();

    const published = event("bb".repeat(32));
    const pending = transport.publish(published);
    sockets[0].deliver(["OK", published.id, true, ""]);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual(["wss://one.example"]);
  });

  it("treats partial acceptance as success and keeps failures visible", async () => {
    const transport = makeTransport(["wss://one.example", "wss://two.example"]);
    sockets.forEach((socket) => socket.open());

    const published = event("bb".repeat(32));
    const pending = transport.publish(published);
    sockets[0].deliver(["OK", published.id, true, ""]);
    sockets[1].deliver(["OK", published.id, false, "blocked: spam"]);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual(["wss://one.example"]);
    expect(result.failed).toEqual([{ relay: "wss://two.example", error: "blocked: spam" }]);
  });

  it("fails when every relay rejects", async () => {
    const transport = makeTransport();
    sockets[0].open();

    const published = event("bb".repeat(32));
    const pending = transport.publish(published);
    sockets[0].deliver(["OK", published.id, false, "rejected"]);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.failed).toHaveLength(1);
  });

  it("reports silent relays as timed out rather than omitting them", async () => {
    vi.useFakeTimers();
    const transport = makeTransport(["wss://one.example", "wss://quiet.example"], {
      listTimeout: 500,
    });
    sockets.forEach((socket) => socket.open());

    const published = event("bb".repeat(32));
    const pending = transport.publish(published);
    sockets[0].deliver(["OK", published.id, true, ""]);
    await vi.advanceTimersByTimeAsync(500);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([{ relay: "wss://quiet.example", error: "timeout" }]);
  });

  it("ignores OK frames for a different event", async () => {
    vi.useFakeTimers();
    const transport = makeTransport(["wss://one.example"], { listTimeout: 200 });
    sockets[0].open();

    const published = event("bb".repeat(32));
    const pending = transport.publish(published);
    sockets[0].deliver(["OK", "cc".repeat(32), true, ""]);
    await vi.advanceTimersByTimeAsync(200);

    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it("does not stack handlers across repeated publishes", async () => {
    const transport = makeTransport();
    sockets[0].open();

    for (const id of ["aa", "bb", "cc"]) {
      const published = event(id.repeat(32));
      const pending = transport.publish(published);
      sockets[0].deliver(["OK", published.id, true, ""]);
      expect((await pending).ok).toBe(true);
    }

    expect(sockets[0].sentOf("EVENT")).toHaveLength(3);
  });
});

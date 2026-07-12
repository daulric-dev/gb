---
sidebar_label: 2026-07-12 · Chat realtime fix
sidebar_position: 4
---

# 2026-07-12 - Chat realtime delivery fix

Follow-up to [Real-time chat](./realtime-chat.md): messages weren't reaching the other user live — they only appeared after clicking into the conversation. Fixed, and the Redis pub/sub transport was extracted into a dedicated, reusable service.

## The bug: SSE was CORS-blocked

`GET /chat/stream` calls `reply.hijack()` to take over the socket and stream Server-Sent Events. Hijacking **skips Fastify's onSend hooks — including the global CORS plugin** — so the stream response carried no `Access-Control-Allow-Origin` header. Because the frontend (`:3000`) and API (`:3001`, or the Cloudflare/API host in prod) are different origins, the browser silently blocked the `EventSource`. Nothing was delivered in real time; the conversation only updated on the fetch that runs when you open it — exactly the reported "only shows when you click the user" symptom. (Redis mode vs. in-process was irrelevant: no events reached the browser either way.)

**Fix** ([chat.controller.ts](../../../../backend/src/chat/chat.controller.ts)): the stream handler now writes the CORS headers itself — `Access-Control-Allow-Origin` set to the exact `FRONTEND_URL` (never `*`, since the request carries credentials) and `Access-Control-Allow-Credentials: true`. With those present the browser accepts the stream, and publishes fan out live over SSE.

## Dedicated Redis pub/sub service

The pub/sub transport was pulled out of the chat module into a generic, `@Global` service so any feature can use it:

- **`RedisPubSubService`** ([realtime/redis-pubsub.service.ts](../../../../backend/src/realtime/redis-pubsub.service.ts)) — owns the dedicated ioredis publisher + subscriber, exposes `publish(channel, payload)` / `subscribe(channel, handler)`, reference-counts subscriptions per channel, and falls back to in-process delivery when `USE_REDIS` is off. Provided by the new `RealtimeModule`.
- **`ChatRealtimeService`** is now a thin layer over it that maps a user id to a `chat:u:<id>` channel. Chat's publish/subscribe behavior is unchanged; the Redis mechanics live in one reusable place.

## Tests

Added `realtime/redis-pubsub.service.test.ts` (publish/subscribe/unsubscribe/fan-out on the in-process bus) and reworked `chat-realtime.service.test.ts` to drive `ChatRealtimeService` over a real in-process bus. Backend suite: 249 → 252 tests, all passing.

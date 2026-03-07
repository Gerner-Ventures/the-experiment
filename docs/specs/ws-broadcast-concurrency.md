---
priority: P3
review_status: approved
status: todo
tags:
- stream-2
- backend
- performance
title: Optimize WS broadcast concurrency at scale
---

# Optimize WS Broadcast Concurrency

## Problem

WebSocket broadcasts are currently sequential at two levels:

1. **Per-socket sends in `ConnectionManager.broadcast()`** — Iterates connected sockets and `await`s each `send_json()` one at a time. With high fan-out (many connected clients), this serializes all sends.

2. **Multi-message sequences in hooks** — `_StreamingHook.on_round_start()` sends three sequential broadcasts (`round_start`, `gm_plan`, `crisis_event`). Each waits for all sockets before sending the next message.

At current scale (1-3 connected clients), this is negligible — each send is sub-millisecond to localhost. This becomes relevant when:
- Multiple browser tabs or spectators are connected
- External integrations consume the WS feed
- Round broadcasts include many events (large agent count)

## Solution

### 1. Parallelize per-socket sends in `ConnectionManager.broadcast()`

```python
async def broadcast(self, experiment_id: str, payload: dict[str, Any]) -> None:
    sockets = list(self.connections.get(experiment_id, ()))
    if not sockets:
        return
    encoded = jsonable_encoder(payload)
    results = await asyncio.gather(
        *(self._send_safe(socket, encoded) for socket in sockets),
        return_exceptions=True,
    )
    for socket, result in zip(sockets, results):
        if isinstance(result, Exception):
            self.disconnect(experiment_id, socket)
```

### 2. Batch independent broadcasts with `asyncio.gather`

In `_StreamingHook.on_round_start()`, the three messages are independent and can be sent concurrently:

```python
async def on_round_start(self, round_number, gm_plan):
    await asyncio.gather(
        cm.broadcast(eid, msg("round_start", ...)),
        cm.broadcast(eid, msg("gm_plan", ...)),
        cm.broadcast(eid, msg("crisis_event", ...)),
    )
```

## Acceptance Criteria

- [ ] `ConnectionManager.broadcast()` sends to all sockets concurrently
- [ ] Dead socket cleanup still works after concurrent sends
- [ ] Independent message sequences use `asyncio.gather`
- [ ] No change in message ordering guarantees (messages within a gather are unordered, but that is acceptable for independent messages)
- [ ] Benchmark shows improvement with 10+ connected clients

## Key Files

- `backend/app/api/runtime.py` — `ConnectionManager.broadcast()`, `_StreamingHook`
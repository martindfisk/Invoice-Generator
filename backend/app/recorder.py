import asyncio
import contextlib
from collections import deque
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

PING_INTERVAL_S = 15.0
SUBSCRIBER_QUEUE_LIMIT = 1000


def _now():
    return datetime.now(UTC).isoformat(timespec="milliseconds")


class CallRequest(BaseModel):
    headers: dict[str, str]
    body: Any = None


class CallResponse(BaseModel):
    status: int
    headers: dict[str, str]
    body: Any = None


class CallRecord(BaseModel):
    id: str = ""
    ts: str = Field(default_factory=_now)
    step: str
    persona: str
    mode: str
    method: str
    url: str
    request: CallRequest
    response: CallResponse | None = None
    duration_ms: float
    curl: str
    error: str | None = None
    record_id: str | None = None
    run_id: str | None = None
    step_name: str | None = None


class Recorder:
    def __init__(self, capacity=500):
        self._records = deque(maxlen=capacity)
        self._queues = set()
        self._next_id = 1

    def add(self, record):
        record.id = str(self._next_id)
        self._next_id += 1
        self._records.append(record)
        for queue in self._queues:
            try:
                queue.put_nowait(record)
            except asyncio.QueueFull:
                # A stalled subscriber (sleeping laptop, paused tab) must not grow memory without
                # bound; its next delivered id skips ahead and the browser's Last-Event-ID replay
                # closes the gap on reconnect.
                pass
        return record

    def list(self, since_id=None):
        records = list(self._records)
        if since_id is None:
            return records
        return [record for record in records if int(record.id) > int(since_id)]

    @contextlib.asynccontextmanager
    async def subscribe(self):
        queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_LIMIT)
        self._queues.add(queue)
        try:
            yield queue
        finally:
            self.unsubscribe(queue)

    def unsubscribe(self, queue):
        self._queues.discard(queue)

    async def sse(self, request, last_event_id=None):
        async with self.subscribe() as queue:
            # A Last-Event-ID from before a backend restart is larger than anything this recorder
            # has numbered; taken verbatim it would silence the stream forever. An id from another
            # epoch means the client has seen nothing of this instance — replay the whole buffer.
            if last_event_id is None:
                last_sent = self._next_id - 1
            else:
                last_sent = int(last_event_id)
                if last_sent > self._next_id - 1:
                    last_sent = 0
            for record in self.list(since_id=last_sent):
                last_sent = int(record.id)
                yield _event(record)
            while not await request.is_disconnected():
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=PING_INTERVAL_S)
                except TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
                    continue
                if int(record.id) <= last_sent:
                    continue
                if int(record.id) > last_sent + 1:
                    # The subscriber's queue overflowed and records were dropped from it. The
                    # ring buffer usually still holds them — replay the gap from there; when
                    # even the ring has rotated past, say how many are gone rather than skipping
                    # silently.
                    missed = self.list(since_id=last_sent)
                    if missed and int(missed[0].id) > last_sent + 1:
                        dropped = int(missed[0].id) - last_sent - 1
                        yield f'event: notice\ndata: {{"dropped": {dropped}}}\n\n'
                    for entry in missed:
                        last_sent = int(entry.id)
                        yield _event(entry)
                    continue
                last_sent = int(record.id)
                yield _event(record)


def _event(record):
    return f"id: {record.id}\nevent: call\ndata: {record.model_dump_json()}\n\n"

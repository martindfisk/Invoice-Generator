import asyncio
import contextlib
from collections import deque
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

PING_INTERVAL_S = 15.0


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
            queue.put_nowait(record)
        return record

    def list(self, since_id=None):
        records = list(self._records)
        if since_id is None:
            return records
        return [record for record in records if int(record.id) > int(since_id)]

    @contextlib.asynccontextmanager
    async def subscribe(self):
        queue = asyncio.Queue()
        self._queues.add(queue)
        try:
            yield queue
        finally:
            self.unsubscribe(queue)

    def unsubscribe(self, queue):
        self._queues.discard(queue)

    async def sse(self, request, last_event_id=None):
        async with self.subscribe() as queue:
            last_sent = self._next_id - 1 if last_event_id is None else int(last_event_id)
            for record in self.list(since_id=last_sent):
                last_sent = int(record.id)
                yield _event(record)
            while not await request.is_disconnected():
                try:
                    record = await asyncio.wait_for(queue.get(), timeout=PING_INTERVAL_S)
                except TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
                    continue
                if int(record.id) > last_sent:
                    last_sent = int(record.id)
                    yield _event(record)


def _event(record):
    return f"id: {record.id}\nevent: call\ndata: {record.model_dump_json()}\n\n"

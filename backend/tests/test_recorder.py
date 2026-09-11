import asyncio

from app import recorder as recorder_module
from app.recorder import CallRecord, CallRequest, Recorder


def make_record(step="setup"):
    return CallRecord(
        step=step,
        mode="mock",
        method="GET",
        url="https://test.api.fiskaly.com/systems/x",
        request=CallRequest(headers={}),
        duration_ms=1.5,
        curl="curl",
    )


class FakeRequest:
    def __init__(self, disconnect_after):
        self.checks = 0
        self.disconnect_after = disconnect_after

    async def is_disconnected(self):
        self.checks += 1
        return self.checks > self.disconnect_after


def test_ids_increase_and_since_filters():
    recorder = Recorder(capacity=10)
    ids = [recorder.add(make_record()).id for _ in range(3)]
    assert ids == ["1", "2", "3"]
    assert [record.id for record in recorder.list()] == ids
    assert [record.id for record in recorder.list(since_id="1")] == ["2", "3"]
    assert recorder.list(since_id=3) == []


def test_capacity_evicts_oldest_but_keeps_ids():
    recorder = Recorder(capacity=2)
    for _ in range(3):
        recorder.add(make_record())
    assert [record.id for record in recorder.list()] == ["2", "3"]


async def test_subscribers_receive_new_records_until_unsubscribed():
    recorder = Recorder()
    async with recorder.subscribe() as queue:
        recorder.add(make_record())
        assert (await queue.get()).id == "1"
    recorder.add(make_record())
    assert queue.empty()


async def test_sse_replays_after_last_event_id_then_pings(monkeypatch):
    monkeypatch.setattr(recorder_module, "PING_INTERVAL_S", 0.01)
    recorder = Recorder()
    for _ in range(3):
        recorder.add(make_record())
    request = FakeRequest(disconnect_after=1)
    events = [chunk async for chunk in recorder.sse(request, last_event_id="1")]
    assert len(events) == 3
    assert events[0].startswith("id: 2\nevent: call\ndata: {")
    assert events[1].startswith("id: 3\nevent: call\n")
    assert events[2] == "event: ping\ndata: {}\n\n"


async def test_sse_survives_a_stale_last_event_id_from_before_a_restart(monkeypatch):
    monkeypatch.setattr(recorder_module, "PING_INTERVAL_S", 0.01)
    recorder = Recorder()
    recorder.add(make_record())
    request = FakeRequest(disconnect_after=1)
    events = [chunk async for chunk in recorder.sse(request, last_event_id="437")]
    assert any(chunk.startswith("id: 1\nevent: call\n") for chunk in events)

    async def consume(stream):
        collected = []
        async for chunk in stream:
            collected.append(chunk)
        return collected

    task = asyncio.create_task(
        consume(recorder.sse(FakeRequest(disconnect_after=2), last_event_id="437"))
    )
    await asyncio.sleep(0.005)
    recorder.add(make_record(step="poll"))
    live = await task
    assert any('"step":"poll"' in chunk for chunk in live)


async def test_sse_streams_live_records_without_replay(monkeypatch):
    monkeypatch.setattr(recorder_module, "PING_INTERVAL_S", 0.2)
    recorder = Recorder()
    recorder.add(make_record())
    events = []

    async def consume():
        async for chunk in recorder.sse(FakeRequest(disconnect_after=2)):
            events.append(chunk)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    recorder.add(make_record(step="poll"))
    await task
    assert len(events) == 2
    assert events[0].startswith("id: 2\nevent: call\n")
    assert '"step":"poll"' in events[0]
    assert events[1] == "event: ping\ndata: {}\n\n"


async def test_sse_backfills_a_queue_overflow_from_the_ring(monkeypatch):
    monkeypatch.setattr(recorder_module, "SUBSCRIBER_QUEUE_LIMIT", 1)
    monkeypatch.setattr(recorder_module, "PING_INTERVAL_S", 0.05)
    recorder = Recorder()
    events = []

    async def consume():
        async for chunk in recorder.sse(FakeRequest(disconnect_after=3)):
            events.append(chunk)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    # Three adds with no await between them: the 1-slot queue keeps only the first.
    recorder.add(make_record(step="setup"))
    recorder.add(make_record(step="poll"))
    recorder.add(make_record(step="artifact"))
    await asyncio.sleep(0.01)
    recorder.add(make_record(step="list"))
    await task
    ids = [chunk.split("\n", 1)[0] for chunk in events if chunk.startswith("id: ")]
    # The dropped records 2 and 3 are replayed from the ring buffer, in order, no notice needed.
    assert ids == ["id: 1", "id: 2", "id: 3", "id: 4"]
    assert not any("event: notice" in chunk for chunk in events)


async def test_sse_names_the_records_lost_beyond_the_ring(monkeypatch):
    monkeypatch.setattr(recorder_module, "SUBSCRIBER_QUEUE_LIMIT", 1)
    monkeypatch.setattr(recorder_module, "PING_INTERVAL_S", 0.05)
    recorder = Recorder(capacity=2)
    events = []

    async def consume():
        async for chunk in recorder.sse(FakeRequest(disconnect_after=4)):
            events.append(chunk)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    recorder.add(make_record(step="setup"))  # 1 — delivered
    await asyncio.sleep(0.01)
    recorder.add(make_record(step="poll"))  # 2 — delivered
    recorder.add(make_record(step="poll"))  # 3 — dropped, then rotated out of the ring
    recorder.add(make_record(step="poll"))  # 4 — dropped, then rotated out of the ring
    recorder.add(make_record(step="poll"))  # 5 — dropped from the queue, still in the ring
    await asyncio.sleep(0.01)
    recorder.add(make_record(step="list"))  # 6 — delivered, exposes the gap
    await task
    ids = [chunk.split("\n", 1)[0] for chunk in events if chunk.startswith("id: ")]
    assert ids == ["id: 1", "id: 2", "id: 5", "id: 6"]
    # Records 3 and 4 are gone for good; the stream says so instead of skipping silently.
    assert any(chunk == 'event: notice\ndata: {"dropped": 2}\n\n' for chunk in events)

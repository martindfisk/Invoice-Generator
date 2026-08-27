import asyncio

from app import recorder as recorder_module
from app.recorder import CallRecord, CallRequest, Recorder


def make_record(step="setup"):
    return CallRecord(
        step=step,
        persona="seller",
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

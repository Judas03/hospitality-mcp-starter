from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from server.repository import ReservationRepository
from server.service import ReservationService


@dataclass
class MutableClock:
    current: datetime

    def __call__(self) -> datetime:
        return self.current

    def advance(self, *, seconds: int) -> None:
        self.current += timedelta(seconds=seconds)


@pytest.fixture
def clock() -> MutableClock:
    return MutableClock(datetime(2026, 10, 22, 3, 0, tzinfo=timezone.utc))


@pytest.fixture
def repository(tmp_path) -> ReservationRepository:
    repo = ReservationRepository(str(tmp_path / "hospitality-test.db"))
    repo.initialize()
    return repo


@pytest.fixture
def service(repository: ReservationRepository, clock: MutableClock) -> ReservationService:
    return ReservationService(repository, hold_ttl_seconds=300, clock=clock)

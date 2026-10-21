"""SQLite persistence and deterministic demo inventory."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, time
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from server.models import (
    AvailabilityOccurrence,
    AvailabilityTemplate,
    Booking,
    BookingStatus,
    Listing,
    ProviderType,
)


SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    listing_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    location TEXT NOT NULL,
    timezone TEXT NOT NULL,
    description TEXT NOT NULL,
    features_json TEXT NOT NULL,
    service_types_json TEXT NOT NULL,
    room_types_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_templates (
    template_id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(listing_id),
    local_start TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    max_party_size INTEGER NOT NULL,
    service_type TEXT,
    room_type TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_occurrences (
    availability_id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES availability_templates(template_id),
    listing_id TEXT NOT NULL REFERENCES listings(listing_id),
    provider_type TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    max_party_size INTEGER NOT NULL,
    service_type TEXT,
    room_type TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id TEXT PRIMARY KEY,
    availability_id TEXT NOT NULL REFERENCES availability_occurrences(availability_id),
    listing_id TEXT NOT NULL REFERENCES listings(listing_id),
    provider_type TEXT NOT NULL,
    status TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    guest_contact TEXT NOT NULL,
    party_size INTEGER NOT NULL,
    service_type TEXT,
    room_type TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_availability_status
ON bookings(availability_id, status);
"""


LISTING_SEEDS = (
    (
        "rest_001",
        "Siam Serenity",
        "restaurant",
        "Bangkok",
        "Asia/Bangkok",
        "A calm Thai dining room designed for quiet dinners.",
        ["quiet", "indoor seating", "thai cuisine"],
        [],
        [],
    ),
    (
        "rest_002",
        "Riverside Social",
        "restaurant",
        "Bangkok",
        "Asia/Bangkok",
        "A lively riverside restaurant with group seating.",
        ["river view", "lively", "outdoor seating"],
        [],
        [],
    ),
    (
        "salon_001",
        "Lotus Glow Salon",
        "salon",
        "Bangkok",
        "Asia/Bangkok",
        "A neighborhood salon offering hair and nail appointments.",
        ["quiet", "accessible"],
        ["haircut", "manicure"],
        [],
    ),
    (
        "salon_002",
        "Sukhumvit Style Studio",
        "salon",
        "Bangkok",
        "Asia/Bangkok",
        "A modern salon specializing in styling and manicures.",
        ["modern", "near transit"],
        ["haircut", "manicure"],
        [],
    ),
    (
        "hotel_001",
        "Chao Phraya Stay",
        "hotel",
        "Bangkok",
        "Asia/Bangkok",
        "A compact riverside hotel with one-night demo inventory.",
        ["river view", "breakfast"],
        [],
        ["standard", "deluxe"],
    ),
    (
        "hotel_002",
        "Old Town House",
        "hotel",
        "Bangkok",
        "Asia/Bangkok",
        "A small hotel near Bangkok's historic district.",
        ["quiet", "historic district"],
        [],
        ["standard", "suite"],
    ),
)


def _restaurant_templates(listing_id: str, capacity: int) -> Iterable[tuple[object, ...]]:
    for start in ("18:00", "18:30", "19:00", "19:30", "20:00"):
        token = start.replace(":", "")
        yield (f"{listing_id}_{token}", listing_id, start, 120, capacity, None, None, 0, "THB")


TEMPLATE_SEEDS = (
    *_restaurant_templates("rest_001", 4),
    *_restaurant_templates("rest_002", 6),
    ("salon_001_1000_haircut", "salon_001", "10:00", 60, 1, "haircut", None, 700, "THB"),
    ("salon_001_1300_haircut", "salon_001", "13:00", 60, 1, "haircut", None, 700, "THB"),
    ("salon_001_1600_haircut", "salon_001", "16:00", 60, 1, "haircut", None, 700, "THB"),
    ("salon_001_1100_manicure", "salon_001", "11:00", 45, 1, "manicure", None, 500, "THB"),
    ("salon_001_1400_manicure", "salon_001", "14:00", 45, 1, "manicure", None, 500, "THB"),
    ("salon_002_1300_haircut", "salon_002", "13:00", 60, 1, "haircut", None, 900, "THB"),
    ("salon_002_1500_manicure", "salon_002", "15:00", 45, 1, "manicure", None, 650, "THB"),
    ("hotel_001_1500_standard", "hotel_001", "15:00", 1200, 2, None, "standard", 2800, "THB"),
    ("hotel_001_1500_deluxe", "hotel_001", "15:00", 1200, 3, None, "deluxe", 4200, "THB"),
    ("hotel_002_1500_standard", "hotel_002", "15:00", 1200, 2, None, "standard", 2400, "THB"),
    ("hotel_002_1500_suite", "hotel_002", "15:00", 1200, 4, None, "suite", 5100, "THB"),
)


class ReservationRepository:
    def __init__(self, database_path: str) -> None:
        self.database_path = database_path

    def initialize(self) -> None:
        if self.database_path != ":memory:":
            Path(self.database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(SCHEMA)
            self._seed(connection)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _seed(self, connection: sqlite3.Connection) -> None:
        for seed in LISTING_SEEDS:
            connection.execute(
                """
                INSERT INTO listings (
                    listing_id, name, provider_type, location, timezone,
                    description, features_json, service_types_json, room_types_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(listing_id) DO UPDATE SET
                    name=excluded.name,
                    provider_type=excluded.provider_type,
                    location=excluded.location,
                    timezone=excluded.timezone,
                    description=excluded.description,
                    features_json=excluded.features_json,
                    service_types_json=excluded.service_types_json,
                    room_types_json=excluded.room_types_json
                """,
                (*seed[:6], json.dumps(seed[6]), json.dumps(seed[7]), json.dumps(seed[8])),
            )
        for seed in TEMPLATE_SEEDS:
            connection.execute(
                """
                INSERT INTO availability_templates (
                    template_id, listing_id, local_start, duration_minutes,
                    max_party_size, service_type, room_type, price, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(template_id) DO UPDATE SET
                    listing_id=excluded.listing_id,
                    local_start=excluded.local_start,
                    duration_minutes=excluded.duration_minutes,
                    max_party_size=excluded.max_party_size,
                    service_type=excluded.service_type,
                    room_type=excluded.room_type,
                    price=excluded.price,
                    currency=excluded.currency
                """,
                seed,
            )

    def list_candidates(
        self, provider_type: ProviderType, location: str
    ) -> list[tuple[Listing, AvailabilityTemplate]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT l.*, t.*
                FROM listings AS l
                JOIN availability_templates AS t ON t.listing_id = l.listing_id
                WHERE l.provider_type = ? AND lower(l.location) = lower(?)
                ORDER BY l.listing_id, t.local_start, t.template_id
                """,
                (provider_type.value, location),
            ).fetchall()
        return [(self._listing_from_row(row), self._template_from_row(row)) for row in rows]

    def get_listing(self, listing_id: str) -> Listing | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM listings WHERE listing_id = ?", (listing_id,)
            ).fetchone()
        return self._listing_from_row(row) if row else None

    def upsert_occurrence(self, occurrence: AvailabilityOccurrence) -> None:
        values = occurrence.model_dump(mode="json")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO availability_occurrences (
                    availability_id, template_id, listing_id, provider_type,
                    start_time, end_time, max_party_size, service_type,
                    room_type, price, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(availability_id) DO UPDATE SET
                    template_id=excluded.template_id,
                    listing_id=excluded.listing_id,
                    provider_type=excluded.provider_type,
                    start_time=excluded.start_time,
                    end_time=excluded.end_time,
                    max_party_size=excluded.max_party_size,
                    service_type=excluded.service_type,
                    room_type=excluded.room_type,
                    price=excluded.price,
                    currency=excluded.currency
                """,
                (
                    values["availability_id"],
                    values["template_id"],
                    values["listing_id"],
                    values["provider_type"],
                    values["start_time"],
                    values["end_time"],
                    values["max_party_size"],
                    values["service_type"],
                    values["room_type"],
                    values["price"],
                    values["currency"],
                ),
            )

    def get_occurrence(self, availability_id: str) -> AvailabilityOccurrence | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM availability_occurrences WHERE availability_id = ?",
                (availability_id,),
            ).fetchone()
        return self._occurrence_from_row(row) if row else None

    def is_available(
        self, availability_id: str, now: datetime, *, exclude_booking_id: str | None = None
    ) -> bool:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            parameters: list[object] = [availability_id]
            exclusion = ""
            if exclude_booking_id is not None:
                exclusion = " AND booking_id <> ?"
                parameters.append(exclude_booking_id)
            row = connection.execute(
                f"""
                SELECT 1 FROM bookings
                WHERE availability_id = ?
                  AND status IN ('held', 'confirmed')
                  {exclusion}
                LIMIT 1
                """,
                parameters,
            ).fetchone()
            connection.commit()
        return row is None

    def create_booking(
        self,
        occurrence: AvailabilityOccurrence,
        *,
        guest_name: str,
        guest_contact: str,
        party_size: int,
        expires_at: datetime,
        now: datetime,
    ) -> Booking | None:
        booking_id = f"booking_{uuid4().hex[:12]}"
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            conflict = connection.execute(
                """
                SELECT 1 FROM bookings
                WHERE availability_id = ? AND status IN ('held', 'confirmed')
                LIMIT 1
                """,
                (occurrence.availability_id,),
            ).fetchone()
            if conflict:
                connection.rollback()
                return None
            connection.execute(
                """
                INSERT INTO bookings (
                    booking_id, availability_id, listing_id, provider_type,
                    status, start_time, end_time, guest_name, guest_contact,
                    party_size, service_type, room_type, expires_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    booking_id,
                    occurrence.availability_id,
                    occurrence.listing_id,
                    occurrence.provider_type.value,
                    occurrence.start_time.isoformat(),
                    occurrence.end_time.isoformat(),
                    guest_name,
                    guest_contact,
                    party_size,
                    occurrence.service_type,
                    occurrence.room_type,
                    expires_at.isoformat(),
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            connection.commit()
        return self._booking_from_row(row)

    def get_booking(self, booking_id: str, now: datetime) -> Booking | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            connection.commit()
        return self._booking_from_row(row) if row else None

    def confirm_booking(self, booking_id: str, now: datetime) -> Booking | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            if row and row["status"] == BookingStatus.HELD.value:
                connection.execute(
                    """
                    UPDATE bookings
                    SET status = 'confirmed', expires_at = NULL, updated_at = ?
                    WHERE booking_id = ?
                    """,
                    (now.isoformat(), booking_id),
                )
                row = connection.execute(
                    "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
                ).fetchone()
            connection.commit()
        return self._booking_from_row(row) if row else None

    def cancel_booking(self, booking_id: str, now: datetime) -> Booking | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            if row and row["status"] in (BookingStatus.HELD.value, BookingStatus.CONFIRMED.value):
                connection.execute(
                    """
                    UPDATE bookings
                    SET status = 'cancelled', expires_at = NULL, updated_at = ?
                    WHERE booking_id = ?
                    """,
                    (now.isoformat(), booking_id),
                )
                row = connection.execute(
                    "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
                ).fetchone()
            connection.commit()
        return self._booking_from_row(row) if row else None

    def modify_booking(
        self,
        booking_id: str,
        occurrence: AvailabilityOccurrence | None,
        party_size: int | None,
        now: datetime,
    ) -> tuple[Booking | None, bool]:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._expire_holds(connection, now)
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            if row is None:
                connection.rollback()
                return None, False
            if row["status"] not in (BookingStatus.HELD.value, BookingStatus.CONFIRMED.value):
                connection.commit()
                return self._booking_from_row(row), False

            target_availability_id = occurrence.availability_id if occurrence else row["availability_id"]
            conflict = connection.execute(
                """
                SELECT 1 FROM bookings
                WHERE availability_id = ?
                  AND status IN ('held', 'confirmed')
                  AND booking_id <> ?
                LIMIT 1
                """,
                (target_availability_id, booking_id),
            ).fetchone()
            if conflict:
                connection.commit()
                return self._booking_from_row(row), True

            values = {
                "availability_id": target_availability_id,
                "listing_id": occurrence.listing_id if occurrence else row["listing_id"],
                "provider_type": occurrence.provider_type.value if occurrence else row["provider_type"],
                "start_time": occurrence.start_time.isoformat() if occurrence else row["start_time"],
                "end_time": occurrence.end_time.isoformat() if occurrence else row["end_time"],
                "service_type": occurrence.service_type if occurrence else row["service_type"],
                "room_type": occurrence.room_type if occurrence else row["room_type"],
                "party_size": party_size if party_size is not None else row["party_size"],
            }
            connection.execute(
                """
                UPDATE bookings SET
                    availability_id = :availability_id,
                    listing_id = :listing_id,
                    provider_type = :provider_type,
                    start_time = :start_time,
                    end_time = :end_time,
                    service_type = :service_type,
                    room_type = :room_type,
                    party_size = :party_size,
                    updated_at = :updated_at
                WHERE booking_id = :booking_id
                """,
                {**values, "updated_at": now.isoformat(), "booking_id": booking_id},
            )
            row = connection.execute(
                "SELECT * FROM bookings WHERE booking_id = ?", (booking_id,)
            ).fetchone()
            connection.commit()
        return self._booking_from_row(row), False

    @staticmethod
    def _expire_holds(connection: sqlite3.Connection, now: datetime) -> None:
        connection.execute(
            """
            UPDATE bookings
            SET status = 'expired', expires_at = NULL, updated_at = ?
            WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= ?
            """,
            (now.isoformat(), now.isoformat()),
        )

    @staticmethod
    def make_availability_id(
        listing: Listing, template: AvailabilityTemplate, occurrence_date: date
    ) -> str:
        start = template.local_start.strftime("%H%M")
        identifier = f"avail_{listing.listing_id}_{occurrence_date:%Y%m%d}_{start}"
        qualifier = template.service_type or template.room_type
        if qualifier:
            identifier += "_" + qualifier.lower().replace(" ", "_")
        return identifier

    @staticmethod
    def _listing_from_row(row: sqlite3.Row) -> Listing:
        return Listing(
            listing_id=row["listing_id"],
            name=row["name"],
            provider_type=row["provider_type"],
            location=row["location"],
            timezone=row["timezone"],
            description=row["description"],
            features=json.loads(row["features_json"]),
            service_types=json.loads(row["service_types_json"]),
            room_types=json.loads(row["room_types_json"]),
        )

    @staticmethod
    def _template_from_row(row: sqlite3.Row) -> AvailabilityTemplate:
        return AvailabilityTemplate(
            template_id=row["template_id"],
            listing_id=row["listing_id"],
            local_start=time.fromisoformat(row["local_start"]),
            duration_minutes=row["duration_minutes"],
            max_party_size=row["max_party_size"],
            service_type=row["service_type"],
            room_type=row["room_type"],
            price=row["price"],
            currency=row["currency"],
        )

    @staticmethod
    def _occurrence_from_row(row: sqlite3.Row) -> AvailabilityOccurrence:
        return AvailabilityOccurrence(
            availability_id=row["availability_id"],
            template_id=row["template_id"],
            listing_id=row["listing_id"],
            provider_type=row["provider_type"],
            start_time=datetime.fromisoformat(row["start_time"]),
            end_time=datetime.fromisoformat(row["end_time"]),
            max_party_size=row["max_party_size"],
            service_type=row["service_type"],
            room_type=row["room_type"],
            price=row["price"],
            currency=row["currency"],
        )

    @staticmethod
    def _booking_from_row(row: sqlite3.Row) -> Booking:
        return Booking(
            booking_id=row["booking_id"],
            availability_id=row["availability_id"],
            listing_id=row["listing_id"],
            provider_type=row["provider_type"],
            status=row["status"],
            start_time=datetime.fromisoformat(row["start_time"]),
            end_time=datetime.fromisoformat(row["end_time"]),
            guest_name=row["guest_name"],
            guest_contact=row["guest_contact"],
            party_size=row["party_size"],
            service_type=row["service_type"],
            room_type=row["room_type"],
            expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

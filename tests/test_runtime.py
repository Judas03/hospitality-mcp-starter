from __future__ import annotations

from zoneinfo import ZoneInfo, reset_tzpath


def test_bundled_timezone_data_supports_windows() -> None:
    reset_tzpath(())
    ZoneInfo.clear_cache()
    try:
        assert ZoneInfo("Asia/Bangkok").key == "Asia/Bangkok"
    finally:
        reset_tzpath()
        ZoneInfo.clear_cache()

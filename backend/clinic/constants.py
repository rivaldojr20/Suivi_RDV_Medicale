# clinic/constants.py
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Indian/Antananarivo")     # UTC+3 fixe
OPEN_MIN = 7 * 60 + 30                   # 07:30
CLOSE_MIN = 18 * 60                      # 18:00
SLOT_MIN = 20


def local_to_utc(day: date, minutes: int) -> datetime:
    """Jour local + minutes depuis minuit (heure d'Antananarivo) -> datetime UTC."""
    local = datetime.combine(day, time(minutes // 60, minutes % 60), tzinfo=TZ)
    return local.astimezone(timezone.utc)


def slot_starts():
    """Débuts de créneaux en minutes : 07:30 ... 17:30 (31 créneaux)."""
    return range(OPEN_MIN, CLOSE_MIN - SLOT_MIN + 1, SLOT_MIN)
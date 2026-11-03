# syncapi/serialization.py
from datetime import datetime, date, timezone as dt_tz
from decimal import Decimal
from uuid import UUID

from clinic.models import Patient, Appointment, ConsultationNote

SYNC_FIELDS = ["version", "server_rev", "is_deleted", "created_at", "updated_at"]

ENTITIES = {
    "patients": (Patient, ["id", "last_name", "first_name", "sex", "birth_year", "phone", "village"]),
    "appointments": (Appointment, ["id", "patient_id", "practitioner_id", "scheduled_at",
                                   "duration_min", "reason", "status", "has_conflict"]),
    "consultation_notes": (ConsultationNote, ["id", "appointment_id", "author_id", "temperature_c",
                                              "bp_systolic", "bp_diastolic", "weight_kg",
                                              "observation", "next_visit_date"]),
}


def iso_utc(dt):
    return dt.astimezone(dt_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_json(value):
    if isinstance(value, datetime):
        return iso_utc(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    return value


def serialize_row(row):
    return {k: to_json(v) for k, v in row.items()}


def serialize_obj(entity, obj):
    _, fields = ENTITIES[entity]
    return serialize_row({f: getattr(obj, f) for f in [*fields, *SYNC_FIELDS]})
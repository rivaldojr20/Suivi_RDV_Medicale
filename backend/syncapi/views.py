from django.shortcuts import render
from datetime import datetime, date, timezone as dt_tz
from decimal import Decimal
from uuid import UUID

from rest_framework.decorators import api_view
from rest_framework.response import Response

from accounts.models import User
from clinic.models import Patient, Appointment, ConsultationNote
from .rules import allowed_entities
from .serialization import ENTITIES, SYNC_FIELDS, iso_utc, serialize_row
from .services import MAX_BYTES, LotTooLarge, parse_lot, process_lot
# Create your views here.

# SYNC_FIELDS = ["version", "server_rev", "is_deleted", "created_at", "updated_at"]

# ENTITIES = {
#     "patients": (Patient, ["id", "last_name", "first_name", "sex", "birth_year", "phone", "village"]),
#     "appointments": (Appointment, ["id", "patient_id", "practitioner_id", "scheduled_at",
#                                    "duration_min", "reason", "status", "has_conflict"]),
#     "consultation_notes": (ConsultationNote, ["id", "appointment_id", "author_id", "temperature_c",
#                                               "bp_systolic", "bp_diastolic", "weight_kg",
#                                               "observation", "next_visit_date"]),
# }


# def iso_utc(dt):
#     return dt.astimezone(dt_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# def to_json(value):
#     """DRF encode Decimal en chaîne : on convertit nous-mêmes en nombre JSON."""
#     if isinstance(value, datetime):
#         return iso_utc(value)
#     if isinstance(value, date):
#         return value.isoformat()
#     if isinstance(value, Decimal):
#         return float(value)
#     if isinstance(value, UUID):
#         return str(value)
#     return value


# def serialize_row(row):
#     return {k: to_json(v) for k, v in row.items()}


def parse_int(request, name, default, lo, hi):
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        n = int(raw)
    except ValueError:
        raise ValueError(f"'{name}' doit être un entier.")
    if not lo <= n <= hi:
        raise ValueError(f"'{name}' doit être entre {lo} et {hi}.")
    return n


@api_view(["GET"])
def pull(request):
    user = request.user
    if user.center_id is None:
        return Response({"detail": "Aucun centre associé à ce compte."}, status=403)
    try:
        since = parse_int(request, "since", 0, 0, 2**62)
        limit = parse_int(request, "limit", 200, 1, 500)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    # 1) Pour chaque table autorisée : limit+1 lignes après le curseur, triées par server_rev
    merged = []                                   # [(server_rev, entity, row)]
    for name in allowed_entities(user):
        model, fields = ENTITIES[name]
        rows = (model.objects
                .filter(center_id=user.center_id, server_rev__gt=since)
                .order_by("server_rev")
                .values(*fields, *SYNC_FIELDS)[: limit + 1])
        merged.extend((r["server_rev"], name, r) for r in rows)

    # 2) Fusion globale (server_rev est unique grâce à la séquence commune), on garde `limit`
    merged.sort(key=lambda t: t[0])
    has_more = len(merged) > limit
    kept = merged[:limit]

    changes = {name: [] for name in ENTITIES}
    for _, name, row in kept:
        changes[name].append(serialize_row(row))

    practitioners = [
        {"id": str(u.id), "full_name": u.full_name, "role": u.role, "profession": u.profession}
        for u in User.objects.filter(center_id=user.center_id, role="practitioner", is_active=True)
                             .order_by("last_name", "first_name")
    ]

    return Response({
        "server_time": iso_utc(datetime.now(dt_tz.utc)),
        "changes": changes,
        "reference": {"practitioners": practitioners},
        "next_cursor": kept[-1][0] if kept else since,
        "has_more": has_more,
    })

@api_view(["POST"])
def push(request):
    user = request.user
    if user.center_id is None:
        return Response({"detail": "Aucun centre associé à ce compte."}, status=403)
    try:
        if int(request.META.get("CONTENT_LENGTH") or 0) > MAX_BYTES:
            return Response({"detail": "Lot trop volumineux (1 Mo maximum)."}, status=413)
    except ValueError:
        pass
    try:
        device_id, ops = parse_lot(request.data)
    except LotTooLarge as e:
        return Response({"detail": str(e)}, status=413)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    results = process_lot(user, device_id, ops)
    return Response({"server_time": iso_utc(datetime.now(dt_tz.utc)), "results": results})
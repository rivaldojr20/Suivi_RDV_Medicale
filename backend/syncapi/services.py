# syncapi/services.py
import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_tz
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import IntegrityError, transaction

from accounts.models import User
from clinic.constants import TZ, OPEN_MIN, CLOSE_MIN
from clinic.models import Patient, Appointment, ConsultationNote
from .models import ProcessedOperation, SyncConflict
from .rules import allowed_entities, check_appointment_rights
from .serialization import serialize_obj, to_json

log = logging.getLogger(__name__)

MAX_OPS = 100
MAX_BYTES = 1_000_000
RANK = {"patients": 0, "appointments": 1, "consultation_notes": 2}
READ_ONLY = {"id", "center_id", "version", "server_rev", "is_deleted", "created_at",
             "updated_at", "has_conflict", "author_id", "created_by_id", "field_versions"}
SLOT_FIELDS = {"scheduled_at", "duration_min", "practitioner_id", "status"}


class Rejected(Exception):
    def __init__(self, code, message, fields=None):
        super().__init__(message)
        self.code, self.message, self.fields = code, message, fields


class Invalid(Exception):
    pass


class LotTooLarge(ValueError):
    pass


# ---------------------------------------------------------------- validateurs
def v_str(max_len, *, blank=True, nullable=False, none_as_blank=False):
    def check(v):
        if v is None:
            if nullable:
                return None
            if none_as_blank:
                return ""
            raise Invalid("Valeur requise.")
        if not isinstance(v, str):
            raise Invalid("Texte attendu.")
        v = v.strip()
        if not blank and not v:
            raise Invalid("Ne peut pas être vide.")
        if len(v) > max_len:
            raise Invalid(f"{max_len} caractères maximum.")
        return v
    return check


def v_choice(choices):
    def check(v):
        if v not in choices:
            raise Invalid("Valeur autorisée : " + " ou ".join(choices) + ".")
        return v
    return check


def v_int(lo, hi, nullable=False):
    def check(v):
        if v is None:
            if nullable:
                return None
            raise Invalid("Valeur requise.")
        if isinstance(v, bool) or not isinstance(v, int):
            raise Invalid("Entier attendu.")
        if not lo <= v <= hi:
            raise Invalid(f"Doit être entre {lo} et {hi}.")
        return v
    return check


def v_decimal(lo, hi, places, nullable=True):
    def check(v):
        if v is None:
            if nullable:
                return None
            raise Invalid("Valeur requise.")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise Invalid("Nombre attendu.")
        try:
            d = Decimal(str(v)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
        except InvalidOperation:
            raise Invalid("Nombre invalide.")
        if not lo <= d <= hi:
            raise Invalid(f"Doit être entre {lo} et {hi}.")
        return d
    return check


def v_uuid(v):
    try:
        return uuid.UUID(str(v))
    except ValueError:
        raise Invalid("UUID invalide.")


def v_datetime(v):
    if not isinstance(v, str):
        raise Invalid("Date ISO 8601 attendue.")
    s = v.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise Invalid("Date ISO 8601 attendue.")
    if dt.tzinfo is None:
        raise Invalid("Fuseau horaire requis (suffixe Z).")
    return dt.astimezone(dt_tz.utc)


def v_date(nullable=True):
    def check(v):
        if v is None:
            if nullable:
                return None
            raise Invalid("Valeur requise.")
        try:
            return date.fromisoformat(v)
        except (TypeError, ValueError):
            raise Invalid("Date AAAA-MM-JJ attendue.")
    return check


SPECS = {
    "patients": {
        "model": Patient,
        "fields": {
            "last_name": v_str(100, blank=False),
            "first_name": v_str(100, none_as_blank=True),
            "sex": v_choice(("M", "F")),
            "birth_year": v_int(1900, 2100, nullable=True),
            "phone": v_str(30, nullable=True),
            "village": v_str(120, nullable=True),
        },
        "required": ("last_name", "sex"),
        "create_only": (),
    },
    "appointments": {
        "model": Appointment,
        "fields": {
            "patient_id": v_uuid,
            "practitioner_id": v_uuid,
            "scheduled_at": v_datetime,
            "duration_min": v_int(5, 240),
            "reason": v_str(200, none_as_blank=True),
            "status": v_choice(("planned", "done", "missed", "cancelled")),
        },
        "required": ("patient_id", "practitioner_id", "scheduled_at"),
        "create_only": ("patient_id",),
    },
    "consultation_notes": {
        "model": ConsultationNote,
        "fields": {
            "appointment_id": v_uuid,
            "temperature_c": v_decimal(30, 45, 1),
            "bp_systolic": v_int(40, 300, nullable=True),
            "bp_diastolic": v_int(20, 200, nullable=True),
            "weight_kg": v_decimal(0, 999.99, 2),
            "observation": v_str(10000, none_as_blank=True),
            "next_visit_date": v_date(),
        },
        "required": ("appointment_id",),
        "create_only": ("appointment_id",),
    },
}


def validate(entity, data, creating):
    spec = SPECS[entity]
    clean, errors = {}, {}
    for key, value in data.items():
        if key in READ_ONLY:
            continue                       # ignoré silencieusement (contrat §3.2)
        validator = spec["fields"].get(key)
        if validator is None:
            errors[key] = ["Champ inconnu."]
            continue
        try:
            clean[key] = validator(value)
        except Invalid as e:
            errors[key] = [str(e)]
    if creating:
        for key in spec["required"]:
            if key not in clean and key not in errors:
                errors[key] = ["Champ requis."]
    if errors:
        raise Rejected("VALIDATION_ERROR", "Données invalides.", errors)
    return clean


def check_references(entity, clean, user, creating):
    center = user.center_id
    if entity == "appointments":
        if "practitioner_id" in clean and not User.objects.filter(
                id=clean["practitioner_id"], center_id=center, role="practitioner", is_active=True).exists():
            raise Rejected("VALIDATION_ERROR", "Praticien inconnu.",
                           {"practitioner_id": ["Praticien introuvable dans ce centre."]})
        if creating and not Patient.objects.filter(
                id=clean["patient_id"], center_id=center, is_deleted=False).exists():
            raise Rejected("DEPENDENCY_MISSING", "Patient introuvable ou supprimé.",
                           {"patient_id": ["Introuvable."]})
    elif entity == "consultation_notes" and creating:
        if not Appointment.objects.filter(
                id=clean["appointment_id"], center_id=center, is_deleted=False).exists():
            raise Rejected("DEPENDENCY_MISSING", "RDV introuvable ou supprimé.",
                           {"appointment_id": ["Introuvable."]})


# ------------------------------------------------------------ chevauchements
def slot_key(appt):
    """(praticien, jour LOCAL d'Antananarivo) : périmètre de recalcul des chevauchements."""
    return (appt.practitioner_id, appt.scheduled_at.astimezone(TZ).date())


def outside_hours(appt):
    local = appt.scheduled_at.astimezone(TZ)
    start = local.hour * 60 + local.minute
    return start < OPEN_MIN or start + appt.duration_min > CLOSE_MIN


def recompute_overlaps(center_id, scopes):
    """Recalcule has_conflict pour chaque (praticien, jour). Ne sauvegarde que les lignes
    dont la valeur change. Retourne {id_rdv: [ids des RDV avec lesquels il chevauche]}."""
    result = {}
    for practitioner_id, day in scopes:
        start = datetime.combine(day, time(0), tzinfo=TZ).astimezone(dt_tz.utc)
        rows = list(Appointment.objects
                    .filter(center_id=center_id, practitioner_id=practitioner_id,
                            scheduled_at__gte=start, scheduled_at__lt=start + timedelta(days=1))
                    .only("id", "scheduled_at", "duration_min", "status", "is_deleted", "has_conflict"))
        active = sorted((r for r in rows if r.status == "planned" and not r.is_deleted),
                        key=lambda r: r.scheduled_at)
        others = {r.id: [] for r in active}
        for i, a in enumerate(active):
            a_end = a.scheduled_at + timedelta(minutes=a.duration_min)
            for b in active[i + 1:]:
                if b.scheduled_at >= a_end:
                    break
                others[a.id].append(b.id)
                others[b.id].append(a.id)
        to_true = [r.id for r in rows if others.get(r.id) and not r.has_conflict]
        to_false = [r.id for r in rows if r.has_conflict and not others.get(r.id)]
        if to_true:   # update() SQL : le trigger incrémente version/server_rev
            Appointment.objects.filter(id__in=to_true).update(has_conflict=True)
        if to_false:
            Appointment.objects.filter(id__in=to_false).update(has_conflict=False)
        result.update({k: [str(x) for x in v] for k, v in others.items() if v})
    return result


# ------------------------------------------------------------ traitement d'une op
def _replay(prior, user):
    if prior.user_id != user.id:
        raise Rejected("VALIDATION_ERROR", "Identifiant d'opération déjà utilisé.")
    if prior.status == "rejected":
        return prior.response                       # même rejet qu'à la 1re réception
    result = {"op_id": str(prior.op_id), "status": "duplicate"}
    if prior.entity in SPECS:
        obj = SPECS[prior.entity]["model"].objects.filter(
            id=prior.record_id, center_id=user.center_id).first()
        if obj is not None:
            result["record"] = serialize_obj(prior.entity, obj)
    return result


def _apply(op, user, device_id, priors):
    op_id, entity, action = op["op_id"], op["entity"], op["action"]
    with transaction.atomic():                      # savepoint par opération
        prior = (priors.get(op_id) if priors is not None
                 else ProcessedOperation.objects.filter(op_id=op_id).first())
        if prior is not None:
            return _replay(prior, user)

        if entity not in SPECS or action not in ("UPSERT", "DELETE"):
            raise Rejected("UNSUPPORTED_ACTION", "Entité ou action non supportée.")
        if user.center_id is None or entity not in allowed_entities(user):
            raise Rejected("FORBIDDEN", "Accès refusé à cette ressource.")

        spec = SPECS[entity]
        model = spec["model"]
        obj = model.objects.select_for_update().filter(id=op["record_id"]).first()
        if obj is not None and obj.center_id != user.center_id:
            raise Rejected("FORBIDDEN", "Enregistrement inaccessible.")

        previous_slot = slot_key(obj) if (entity == "appointments" and obj) else None
        result = {"op_id": str(op_id), "status": "applied"}
        touched_slot = False

        if action == "DELETE":
            if obj is None:
                raise Rejected("VALIDATION_ERROR", "Enregistrement introuvable.")
            if entity == "appointments":
                msg = check_appointment_rights(user, False, "DELETE", {})
                if msg:
                    raise Rejected("FORBIDDEN", msg)
            if not obj.is_deleted:
                obj.is_deleted = True
                obj.save(update_fields=["is_deleted"])
            touched_slot = True

        else:
            creating = obj is None
            clean = validate(entity, op["data"], creating)
            if entity == "appointments":
                msg = check_appointment_rights(user, creating, "UPSERT", clean)
                if msg:
                    raise Rejected("FORBIDDEN", msg)

            if creating:
                check_references(entity, clean, user, True)
                kwargs = {**clean, "id": op["record_id"], "center_id": user.center_id}
                if entity == "consultation_notes":
                    kwargs["author_id"] = user.id
                else:
                    kwargs["created_by_id"] = user.id
                obj = model(**kwargs)
                obj.save(force_insert=True)
                touched_slot = True
            else:
                if obj.is_deleted:
                    raise Rejected("RECORD_DELETED", "Cet enregistrement a été supprimé.")
                for f in spec["create_only"]:
                    if f in clean and getattr(obj, f) != clean[f]:
                        raise Rejected("VALIDATION_ERROR", "Champ non modifiable.",
                                       {f: ["Non modifiable après création."]})
                    clean.pop(f, None)
                check_references(entity, clean, user, False)

                changed = {f: v for f, v in clean.items() if getattr(obj, f) != v}
                # Vrai conflit = champ modifié sur le serveur APRÈS la base_version du client
                replaced = {
                    f: {"server_value": to_json(getattr(obj, f)), "client_value": to_json(v)}
                    for f, v in changed.items()
                    if obj.field_versions.get(f, 0) > op["base_version"]
                }
                version_before = obj.version
                if changed:
                    for f, v in changed.items():
                        setattr(obj, f, v)
                    obj.save(update_fields=list(changed))     # un seul UPDATE
                touched_slot = bool(changed.keys() & SLOT_FIELDS)
                if replaced:
                    details = {"base_version": op["base_version"],
                               "server_version_before": version_before,
                               "replaced_values": replaced}
                    result["status"] = "merged"
                    result["conflict"] = {"kind": "VERSION_MISMATCH", **details}
                    SyncConflict.objects.create(
                        op_id=op_id, entity=entity, record_id=obj.id,
                        kind="VERSION_MISMATCH", details=details,
                        user_id=user.id, device_id=device_id)

        overlaps = {}
        if entity == "appointments":
            scopes = {slot_key(obj)}
            if previous_slot:
                scopes.add(previous_slot)
            overlaps = recompute_overlaps(user.center_id, scopes)

        obj.refresh_from_db()                       # récupère version / server_rev / has_conflict

        warnings = []
        if entity == "appointments" and touched_slot and not obj.is_deleted:
            with_ids = overlaps.get(obj.id)
            if with_ids:
                warnings.append({"code": "SLOT_OVERLAP",
                                 "message": "Chevauche un autre RDV du même praticien.",
                                 "with": with_ids})
                SyncConflict.objects.create(
                    op_id=op_id, entity=entity, record_id=obj.id, kind="SLOT_OVERLAP",
                    details={"with": with_ids}, user_id=user.id, device_id=device_id)
            if outside_hours(obj):
                warnings.append({"code": "OUTSIDE_HOURS",
                                 "message": "RDV en dehors des horaires d'ouverture (07:30-18:00)."})

        result["record"] = serialize_obj(entity, obj)
        if warnings:
            result["warnings"] = warnings

        ProcessedOperation.objects.create(
            op_id=op_id, user=user, device_id=device_id, entity=entity,
            record_id=obj.id, status=result["status"], response=result)
        return result


def _reject(op, user, device_id, exc):
    result = {"op_id": str(op["op_id"]), "status": "rejected",
              "error": {"code": exc.code, "message": exc.message}}
    if exc.fields:
        result["error"]["fields"] = exc.fields
    try:   # mémorisé pour que le rejeu soit cohérent (transaction séparée)
        with transaction.atomic():
            ProcessedOperation.objects.get_or_create(
                op_id=op["op_id"],
                defaults=dict(user=user, device_id=device_id, entity=op["entity"][:30],
                              record_id=op["record_id"], status="rejected", response=result))
    except IntegrityError:
        pass
    return result


def _server_error(op):
    return {"op_id": str(op["op_id"]), "status": "rejected",
            "error": {"code": "SERVER_ERROR", "message": "Erreur interne du serveur."}}


def process_one(op, user, device_id, priors):
    for attempt in (1, 2):
        try:
            return _apply(op, user, device_id, priors if attempt == 1 else None)
        except Rejected as e:
            return _reject(op, user, device_id, e)
        except IntegrityError:
            # création concurrente du même record_id / du même op_id : on rejoue une fois
            if attempt == 2:
                log.exception("push: IntegrityError persistante (op %s)", op["op_id"])
                return _server_error(op)
        except Exception:
            log.exception("push: erreur inattendue (op %s)", op["op_id"])
            return _server_error(op)


def process_lot(user, device_id, ops):
    priors = {p.op_id: p for p in
              ProcessedOperation.objects.filter(op_id__in=[o["op_id"] for o in ops])}
    order = sorted(range(len(ops)), key=lambda i: (RANK.get(ops[i]["entity"], 99), i))
    results = [None] * len(ops)
    for i in order:                                 # patients -> RDV -> notes
        results[i] = process_one(ops[i], user, device_id, priors)
    return results                                  # ordre de la requête


# ------------------------------------------------------------ lecture du lot
def parse_lot(body):
    if not isinstance(body, dict):
        raise ValueError("Corps JSON (objet) attendu.")
    try:
        device_id = uuid.UUID(str(body.get("device_id")))
    except ValueError:
        raise ValueError("device_id invalide.")
    raw = body.get("operations")
    if not isinstance(raw, list):
        raise ValueError("'operations' doit être une liste.")
    if len(raw) > MAX_OPS:
        raise LotTooLarge(f"{MAX_OPS} opérations maximum par lot.")
    ops = []
    for n, o in enumerate(raw):
        if not isinstance(o, dict):
            raise ValueError(f"operations[{n}] doit être un objet.")
        try:
            op_id = uuid.UUID(str(o.get("op_id")))
            record_id = uuid.UUID(str(o.get("record_id")))
        except ValueError:
            raise ValueError(f"operations[{n}] : op_id ou record_id invalide.")
        entity, action = o.get("entity"), o.get("action")
        if not isinstance(entity, str) or not isinstance(action, str):
            raise ValueError(f"operations[{n}] : entity et action sont requis.")
        base = o.get("base_version", 0)
        if isinstance(base, bool) or not isinstance(base, int) or base < 0:
            raise ValueError(f"operations[{n}] : base_version invalide.")
        data = o.get("data")
        if action == "UPSERT" and not isinstance(data, dict):
            raise ValueError(f"operations[{n}] : 'data' (objet) requis pour UPSERT.")
        ops.append({"op_id": op_id, "record_id": record_id, "entity": entity, "action": action,
                    "base_version": base, "data": data if isinstance(data, dict) else {}})
    return device_id, ops
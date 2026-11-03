from django.db import models
import uuid
from django.conf import settings
from django.utils import timezone
from django.db import models
# Create your models here.
class SyncModel(models.Model):
    """Colonnes de synchro communes. version, server_rev et updated_at sont posés par le trigger SQL."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    center = models.ForeignKey("accounts.Center", on_delete=models.PROTECT, related_name="+")
    version = models.IntegerField(default=1, editable=False)
    server_rev = models.BigIntegerField(default=0, editable=False)
    is_deleted = models.BooleanField(default=False)
    field_versions = models.JSONField(default=dict, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        abstract = True


class Patient(SyncModel):
    class Sex(models.TextChoices):
        M = "M", "Masculin"
        F = "F", "Féminin"

    last_name = models.CharField(max_length=100)
    first_name = models.CharField(max_length=100, blank=True, default="")
    sex = models.CharField(max_length=1, choices=Sex.choices)
    birth_year = models.PositiveSmallIntegerField(null=True, blank=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    village = models.CharField(max_length=120, blank=True, null=True)   # Fokontany / village
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "patients"
        indexes = [models.Index(fields=["center", "server_rev"], name="ix_patients_pull")]
        constraints = [
            models.CheckConstraint(condition=models.Q(sex__in=["M", "F"]), name="ck_patients_sex"),
            models.CheckConstraint(
                condition=models.Q(birth_year__isnull=True) | models.Q(birth_year__range=(1900, 2100)),
                name="ck_patients_birth_year"),
        ]

    def __str__(self):
        return f"{self.last_name} {self.first_name}".strip()


class Appointment(SyncModel):
    class Status(models.TextChoices):
        PLANNED = "planned", "Planifié"
        DONE = "done", "Honoré"
        MISSED = "missed", "Manqué"
        CANCELLED = "cancelled", "Annulé"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="appointments")
    practitioner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                     related_name="appointments")
    scheduled_at = models.DateTimeField()
    duration_min = models.SmallIntegerField(default=20)
    reason = models.CharField(max_length=200, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PLANNED)
    has_conflict = models.BooleanField(default=False)    # écrit UNIQUEMENT par le serveur
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "appointments"
        indexes = [
            models.Index(fields=["center", "server_rev"], name="ix_appt_pull"),
            models.Index(fields=["practitioner", "scheduled_at"], name="ix_appt_slot"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(duration_min__range=(5, 240)), name="ck_appt_duration"),
            models.CheckConstraint(
                condition=models.Q(status__in=["planned", "done", "missed", "cancelled"]),
                name="ck_appt_status"),
        ]


class ConsultationNote(SyncModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    temperature_c = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    bp_systolic = models.SmallIntegerField(null=True, blank=True)
    bp_diastolic = models.SmallIntegerField(null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    observation = models.TextField(blank=True, default="")
    next_visit_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "consultation_notes"
        indexes = [models.Index(fields=["center", "server_rev"], name="ix_notes_pull")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(temperature_c__isnull=True) | models.Q(temperature_c__range=(30, 45)),
                name="ck_notes_temp"),
            models.CheckConstraint(
                condition=models.Q(bp_systolic__isnull=True) | models.Q(bp_systolic__range=(40, 300)),
                name="ck_notes_sys"),
            models.CheckConstraint(
                condition=models.Q(bp_diastolic__isnull=True) | models.Q(bp_diastolic__range=(20, 200)),
                name="ck_notes_dia"),
        ]
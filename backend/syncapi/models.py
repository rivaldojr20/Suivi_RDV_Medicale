from django.db import models
from django.conf import settings
# Create your models here.
class ProcessedOperation(models.Model):
    op_id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    device_id = models.UUIDField()
    entity = models.CharField(max_length=30)
    record_id = models.UUIDField()
    status = models.CharField(max_length=10)
    response = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "processed_operations"


class SyncConflict(models.Model):
    class Kind(models.TextChoices):
        VERSION_MISMATCH = "VERSION_MISMATCH"
        SLOT_OVERLAP = "SLOT_OVERLAP"

    op_id = models.UUIDField()
    entity = models.CharField(max_length=30)
    record_id = models.UUIDField()
    kind = models.CharField(max_length=20, choices=Kind.choices)
    details = models.JSONField()
    user_id = models.UUIDField()
    device_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sync_conflicts"
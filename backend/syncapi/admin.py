from django.contrib import admin
from .models import ProcessedOperation, SyncConflict

@admin.register(ProcessedOperation)
class ProcessedOperationAdmin(admin.ModelAdmin):
    list_display = ("op_id", "user", "device_id", "entity", "record_id", "status", "received_at")
    list_filter = ("status", "entity")

@admin.register(SyncConflict)
class SyncConflictAdmin(admin.ModelAdmin):
    list_display = ("op_id", "entity", "record_id", "kind", "user_id", "device_id", "created_at")
    list_filter = ("kind", "entity")

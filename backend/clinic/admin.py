from django.contrib import admin
from .models import Patient, Appointment, ConsultationNote
from syncapi.services import recompute_overlaps, slot_key
# Register your models here.
class SyncAdmin(admin.ModelAdmin):
    readonly_fields = ("version", "server_rev", "created_at", "updated_at")

    def delete_model(self, request, obj):
        obj.is_deleted = True
        obj.save()

    def delete_queryset(self, request, queryset):
        queryset.update(is_deleted=True)      # l'UPDATE SQL déclenche le trigger

@admin.register(Patient)
class PatientAdmin(SyncAdmin):
    list_display = ("last_name", "first_name", "sex","version","server_rev", "birth_year", "village", "phone", "is_deleted")
    search_fields = ("last_name", "first_name", "phone")
    list_filter = ("village", "is_deleted")

@admin.register(Appointment)
class AppointmentAdmin(SyncAdmin):
    readonly_fields = SyncAdmin.readonly_fields + ("has_conflict",)
    list_display = ("scheduled_at", "patient", "practitioner", "status", "has_conflict", "is_deleted")
    list_filter = ("status", "has_conflict", "practitioner")
    date_hierarchy = "scheduled_at"

    def save_model(self, request, obj, form, change):
        previous = slot_key(Appointment.objects.get(pk=obj.pk)) if change else None
        super().save_model(request, obj, form, change)
        scopes = {slot_key(obj)} | ({previous} if previous else set())
        recompute_overlaps(obj.center_id, scopes)

        
@admin.register(ConsultationNote)
class ConsultationNoteAdmin(SyncAdmin):
    list_display = ("appointment", "author", "created_at", "is_deleted")


from django.contrib import admin
from .models import User, Center
from django.contrib.auth.admin import UserAdmin
# Register your models here.


admin.site.register(Center)
@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("CSB", {"fields": ("role", "profession", "center")}),)
    add_fieldsets = UserAdmin.add_fieldsets + (("CSB", {"fields": ("role", "profession", "center")}),)
    list_display = ("username", "last_name", "first_name", "role", "profession", "center", "is_active")
    list_filter = ("role", "profession", "center")
from django.test import TestCase
from accounts.models import Center
from clinic.models import Patient


class SyncTriggerTest(TestCase):
    def test_version_et_server_rev(self):
        c = Center.objects.create(name="CSB Test")
        p = Patient.objects.create(center=c, last_name="TEST", sex="M")
        p.refresh_from_db()
        assert p.version == 1 and p.server_rev > 0
        rev1 = p.server_rev

        p.village = "Isotry"
        p.save()
        p.refresh_from_db()
        assert p.version == 2
        assert p.server_rev > rev1

    def test_update_sql_declenche_aussi_le_trigger(self):
        c = Center.objects.create(name="CSB Test")
        p = Patient.objects.create(center=c, last_name="TEST", sex="F")
        Patient.objects.filter(id=p.id).update(is_deleted=True)
        p.refresh_from_db()
        assert p.version == 2 and p.is_deleted

    def test_field_versions(self):
        c = Center.objects.create(name="CSB Test")
        p = Patient.objects.create(center=c, last_name="TEST", sex="M")
        p.village = "Isotry"
        p.save()
        p.refresh_from_db()
        assert p.field_versions.get("village") == 2
        assert "last_name" not in p.field_versions
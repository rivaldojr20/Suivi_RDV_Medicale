from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Center, User
from clinic.models import Patient, Appointment, ConsultationNote

ENTITIES = ("patients", "appointments", "consultation_notes")


class PullTest(TestCase):
    def setUp(self):
        self.c1 = Center.objects.create(name="C1")
        self.c2 = Center.objects.create(name="C2")
        self.reception = User.objects.create_user("rec", password="x", role="reception", center=self.c1)
        self.doc = User.objects.create_user("doc", password="x", role="practitioner", center=self.c1,
                                            last_name="Rasoanaivo", first_name="Miora")
        self.other = User.objects.create_user("oth", password="x", role="practitioner", center=self.c2)
        self.p = Patient.objects.create(center=self.c1, last_name="A", sex="M")
        self.p_other = Patient.objects.create(center=self.c2, last_name="B", sex="F")
        self.appt = Appointment.objects.create(center=self.c1, patient=self.p, practitioner=self.doc,
                                               scheduled_at=timezone.now())
        self.note = ConsultationNote.objects.create(center=self.c1, appointment=self.appt,
                                                    author=self.doc, observation="x")

    def get(self, user, qs=""):
        c = APIClient()
        if user:
            c.force_authenticate(user)
        return c.get(f"/api/sync/pull{qs}")

    def ids(self, data, entity):
        return {x["id"] for x in data["changes"][entity]}

    def test_authentification_requise(self):
        self.assertEqual(self.get(None).status_code, 401)

    def test_praticien_voit_son_centre_seulement(self):
        data = self.get(self.doc).json()
        self.assertEqual(self.ids(data, "patients"), {str(self.p.id)})
        self.assertEqual(self.ids(data, "consultation_notes"), {str(self.note.id)})
        self.assertEqual([u["id"] for u in data["reference"]["practitioners"]], [str(self.doc.id)])

    def test_accueil_ne_recoit_jamais_de_notes(self):
        data = self.get(self.reception).json()
        self.assertEqual(data["changes"]["consultation_notes"], [])
        self.assertEqual(self.ids(data, "appointments"), {str(self.appt.id)})

    def test_admin_sans_centre_refuse(self):
        admin = User.objects.create_user("adm", password="x", role="admin")
        self.assertEqual(self.get(admin).status_code, 403)

    def test_parametres_invalides(self):
        self.assertEqual(self.get(self.doc, "?since=abc").status_code, 400)
        self.assertEqual(self.get(self.doc, "?limit=0").status_code, 400)
        self.assertEqual(self.get(self.doc, "?limit=501").status_code, 400)

    def test_delta_ne_renvoie_que_les_changements(self):
        cursor = self.get(self.doc).json()["next_cursor"]
        self.p.village = "Isotry"
        self.p.save()
        data = self.get(self.doc, f"?since={cursor}").json()
        self.assertEqual(self.ids(data, "patients"), {str(self.p.id)})
        self.assertEqual(data["changes"]["appointments"], [])
        self.assertEqual(data["changes"]["patients"][0]["version"], 2)
        # rien de nouveau : le curseur reste inchangé
        again = self.get(self.doc, f"?since={data['next_cursor']}").json()
        self.assertEqual(again["next_cursor"], data["next_cursor"])
        self.assertFalse(again["has_more"])

    def test_tombstone(self):
        Patient.objects.filter(id=self.p.id).update(is_deleted=True)
        data = self.get(self.doc).json()
        row = next(x for x in data["changes"]["patients"] if x["id"] == str(self.p.id))
        self.assertTrue(row["is_deleted"])

    def test_pagination_sans_perte_ni_doublon(self):
        for i in range(4):
            Patient.objects.create(center=self.c1, last_name=f"P{i}", sex="M")
        seen, since, pages = [], 0, 0
        while True:
            data = self.get(self.doc, f"?since={since}&limit=2").json()
            pages += 1
            for e in ENTITIES:
                seen += [x["id"] for x in data["changes"][e]]
            since = data["next_cursor"]
            if not data["has_more"]:
                break
            self.assertLess(pages, 20)
        # 5 patients + 1 RDV + 1 note
        self.assertEqual(len(seen), 7)
        self.assertEqual(len(set(seen)), 7)

    def test_format_des_valeurs(self):
        n = ConsultationNote.objects.get(id=self.note.id)
        n.temperature_c = "37.5"
        n.save()
        row = self.get(self.doc).json()["changes"]["consultation_notes"][0]
        self.assertEqual(row["temperature_c"], 37.5)          # nombre, pas chaîne
        appt = self.get(self.doc).json()["changes"]["appointments"][0]
        self.assertTrue(appt["scheduled_at"].endswith("Z"))
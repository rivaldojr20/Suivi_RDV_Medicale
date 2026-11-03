# syncapi/tests/test_push.py
import uuid
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Center, User
from clinic.models import Patient, Appointment, ConsultationNote
from syncapi.models import ProcessedOperation, SyncConflict

T0800 = "2025-03-15T05:00:00Z"      # 08:00 à Antananarivo
T0820 = "2025-03-15T05:20:00Z"


def new_id():
    return str(uuid.uuid4())


def op(entity, record_id, data=None, base=0, action="UPSERT"):
    o = {"op_id": new_id(), "entity": entity, "record_id": str(record_id),
         "action": action, "base_version": base}
    if data is not None:
        o["data"] = data
    return o


class PushTest(TestCase):
    def setUp(self):
        self.c1 = Center.objects.create(name="C1")
        self.c2 = Center.objects.create(name="C2")
        self.rec = User.objects.create_user("rec", password="x", role="reception", center=self.c1)
        self.doc = User.objects.create_user("doc", password="x", role="practitioner", center=self.c1)
        self.other = User.objects.create_user("oth", password="x", role="reception", center=self.c2)
        self.p = Patient.objects.create(center=self.c1, last_name="A", sex="M")

    def push(self, user, *ops, expect=200):
        c = APIClient()
        c.force_authenticate(user)
        r = c.post("/api/sync/push", {"device_id": new_id(), "operations": list(ops)}, format="json")
        self.assertEqual(r.status_code, expect, r.content)
        return r.json()["results"] if expect == 200 else r

    def appt_data(self, when=T0800, **extra):
        return {"patient_id": str(self.p.id), "practitioner_id": str(self.doc.id),
                "scheduled_at": when, "duration_min": 20, "reason": "Test", **extra}

    def make_appt(self):
        return Appointment.objects.create(center=self.c1, patient=self.p, practitioner=self.doc,
                                          scheduled_at=timezone.now())

    # T1 : création en chaîne (RDV listé AVANT son patient : l'ordre est rétabli par le serveur)
    def test_t1_creation_en_chaine(self):
        pid, rid, nid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        res = self.push(
            self.rec,
            op("appointments", rid, {**self.appt_data(), "patient_id": str(pid)}),
            op("patients", pid, {"last_name": "RAKOTO", "sex": "F", "birth_year": 1990}))
        self.assertEqual([r["status"] for r in res], ["applied", "applied"])
        self.assertEqual(res[1]["record"]["version"], 1)
        res = self.push(self.doc, op("consultation_notes", nid,
                                     {"appointment_id": str(rid), "observation": "RAS",
                                      "temperature_c": 37.5}))
        self.assertEqual(res[0]["status"], "applied")
        self.assertEqual(ConsultationNote.objects.get().author_id, self.doc.id)

    # T2 : rejeu
    def test_t2_rejeu_idempotent(self):
        o = op("patients", uuid.uuid4(), {"last_name": "X", "sex": "M"})
        self.assertEqual(self.push(self.rec, o)[0]["status"], "applied")
        again = self.push(self.rec, o)
        self.assertEqual(again[0]["status"], "duplicate")
        self.assertIn("record", again[0])
        self.assertEqual(Patient.objects.filter(last_name="X").count(), 1)

    # T3 : champs différents -> fusion sans conflit
    def test_t3_champs_differents(self):
        self.assertEqual(self.push(self.rec, op("patients", self.p.id, {"village": "X"}, base=1))[0]["status"], "applied")
        r = self.push(self.rec, op("patients", self.p.id, {"phone": "034"}, base=1))[0]
        self.assertEqual(r["status"], "applied")
        self.assertEqual((r["record"]["village"], r["record"]["phone"], r["record"]["version"]),
                         ("X", "034", 3))
        self.assertEqual(SyncConflict.objects.count(), 0)

    # T4 : même champ -> merged
    def test_t4_meme_champ(self):
        self.push(self.rec, op("patients", self.p.id, {"village": "X"}, base=1))
        r = self.push(self.rec, op("patients", self.p.id, {"village": "Y"}, base=1))[0]
        self.assertEqual(r["status"], "merged")
        self.assertEqual(r["conflict"]["replaced_values"]["village"],
                         {"server_value": "X", "client_value": "Y"})
        self.assertEqual(r["record"]["village"], "Y")
        self.assertEqual(SyncConflict.objects.filter(kind="VERSION_MISMATCH").count(), 1)

    # T5 : chevauchement puis replanification
    def test_t5_chevauchement(self):
        id1, id2 = uuid.uuid4(), uuid.uuid4()
        r1 = self.push(self.rec, op("appointments", id1, self.appt_data()))[0]
        self.assertFalse(r1["record"]["has_conflict"])
        r2 = self.push(self.rec, op("appointments", id2, self.appt_data()))[0]
        self.assertTrue(r2["record"]["has_conflict"])
        self.assertEqual(r2["warnings"][0]["code"], "SLOT_OVERLAP")
        self.assertTrue(Appointment.objects.get(id=id1).has_conflict)
        # replanifier le 2e à 08:20 efface le badge des deux
        r3 = self.push(self.rec, op("appointments", id2, {"scheduled_at": T0820},
                                    base=r2["record"]["version"]))[0]
        self.assertFalse(r3["record"]["has_conflict"])
        self.assertFalse(Appointment.objects.get(id=id1).has_conflict)

    # T7 : l'accueil ne peut pas écrire de note
    def test_t7_accueil_note_interdite(self):
        a = self.make_appt()
        r = self.push(self.rec, op("consultation_notes", uuid.uuid4(),
                                   {"appointment_id": str(a.id), "observation": "x"}))[0]
        self.assertEqual((r["status"], r["error"]["code"]), ("rejected", "FORBIDDEN"))
        self.assertEqual(ConsultationNote.objects.count(), 0)

    # T8 : patient invalide puis RDV qui en dépend
    def test_t8_dependance(self):
        pid = uuid.uuid4()
        res = self.push(
            self.rec,
            op("patients", pid, {"last_name": "Z", "sex": "X"}),
            op("appointments", uuid.uuid4(), {**self.appt_data(), "patient_id": str(pid)}))
        self.assertEqual(res[0]["error"]["code"], "VALIDATION_ERROR")
        self.assertIn("sex", res[0]["error"]["fields"])
        self.assertEqual(res[1]["error"]["code"], "DEPENDENCY_MISSING")

    # T12 : hors horaires = accepté + avertissement
    def test_t12_hors_horaires(self):
        r = self.push(self.rec, op("appointments", uuid.uuid4(),
                                   self.appt_data(when="2025-03-15T15:20:00Z")))[0]       # 18:20 locale
        self.assertEqual(r["status"], "applied")
        self.assertEqual([w["code"] for w in r["warnings"]], ["OUTSIDE_HOURS"])
        self.assertFalse(r["record"]["has_conflict"])

    def test_champs_inconnus_et_lecture_seule(self):
        bad = self.push(self.rec, op("patients", uuid.uuid4(),
                                     {"last_name": "A", "sex": "M", "bogus": 1}))[0]
        self.assertEqual(bad["error"]["code"], "VALIDATION_ERROR")
        self.assertIn("bogus", bad["error"]["fields"])
        ok = self.push(self.rec, op("patients", uuid.uuid4(),
                                    {"last_name": "B", "sex": "M", "version": 99, "is_deleted": True}))[0]
        self.assertEqual(ok["status"], "applied")
        self.assertEqual((ok["record"]["version"], ok["record"]["is_deleted"]), (1, False))

    def test_isolation_entre_centres(self):
        r = self.push(self.other, op("patients", self.p.id, {"village": "Hack"}, base=1))[0]
        self.assertEqual(r["error"]["code"], "FORBIDDEN")
        self.p.refresh_from_db()
        self.assertNotEqual(self.p.village, "Hack")

    def test_praticien_statut_seulement(self):
        a = self.make_appt()
        ok = self.push(self.doc, op("appointments", a.id, {"status": "done"}, base=a.version))[0]
        self.assertEqual(ok["status"], "applied")
        no = self.push(self.doc, op("appointments", a.id, {"reason": "x"}, base=a.version))[0]
        self.assertEqual(no["error"]["code"], "FORBIDDEN")
        cr = self.push(self.doc, op("appointments", uuid.uuid4(), self.appt_data()))[0]
        self.assertEqual(cr["error"]["code"], "FORBIDDEN")

    def test_suppression_douce(self):
        r = self.push(self.rec, op("patients", self.p.id, base=1, action="DELETE"))[0]
        self.assertEqual(r["status"], "applied")
        self.assertTrue(Patient.objects.get(id=self.p.id).is_deleted)
        r = self.push(self.rec, op("patients", self.p.id, {"village": "X"}, base=2))[0]
        self.assertEqual(r["error"]["code"], "RECORD_DELETED")

    def test_rejeu_d_un_rejet(self):
        o = op("patients", uuid.uuid4(), {"last_name": "A", "sex": "Z"})
        a, b = self.push(self.rec, o)[0], self.push(self.rec, o)[0]
        self.assertEqual((a["status"], b["status"]), ("rejected", "rejected"))
        self.assertEqual(ProcessedOperation.objects.filter(op_id=o["op_id"]).count(), 1)

    def test_lot_mal_forme(self):
        c = APIClient()
        c.force_authenticate(self.rec)
        self.assertEqual(c.post("/api/sync/push", {"operations": []}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/sync/push", {"device_id": new_id(), "operations": "x"},
                                format="json").status_code, 400)
        self.assertEqual(c.post("/api/sync/push", {"device_id": new_id(), "operations": [
            op("patients", uuid.uuid4(), {"last_name": "A", "sex": "M"})] * 101},
            format="json").status_code, 413)
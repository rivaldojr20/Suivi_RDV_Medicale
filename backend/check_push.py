# backend/check_push.py
import uuid, requests

BASE = "http://localhost:8000/api"
login = requests.post(f"{BASE}/auth/login", json={"username": "accueil", "password": "demo1234"}).json()
H = {"Authorization": f"Bearer {login['access']}"}
doc = requests.get(f"{BASE}/sync/pull?since=0&limit=1", headers=H).json()["reference"]["practitioners"][0]["id"]

pid = str(uuid.uuid4())
def appt_op():
    return {"op_id": str(uuid.uuid4()), "entity": "appointments", "record_id": str(uuid.uuid4()),
            "action": "UPSERT", "base_version": 0,
            "data": {"patient_id": pid, "practitioner_id": doc,
                     "scheduled_at": "2030-01-01T05:00:00Z", "reason": "Test push"}}

lot = {"device_id": str(uuid.uuid4()), "operations": [
    appt_op(),
    {"op_id": str(uuid.uuid4()), "entity": "patients", "record_id": pid, "action": "UPSERT",
     "base_version": 0, "data": {"last_name": "TEST", "first_name": "Push", "sex": "F"}}]}

push = lambda body: requests.post(f"{BASE}/sync/push", json=body, headers=H).json()["results"]

r = push(lot);  print("1er envoi :", [x["status"] for x in r])                # applied, applied
r = push(lot);  print("rejeu     :", [x["status"] for x in r])                # duplicate, duplicate
lot2 = {"device_id": str(uuid.uuid4()), "operations": [appt_op()]}
r = push(lot2); print("même créneau :", r[0]["status"], r[0].get("warnings"))  # SLOT_OVERLAP
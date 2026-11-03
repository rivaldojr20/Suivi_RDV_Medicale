import requests

BASE = "http://localhost:8000/api"


def login(username):
    r = requests.post(f"{BASE}/auth/login",
                      json={"username": username, "password": "demo1234"}, timeout=30)
    r.raise_for_status()
    return r.json()["access"]


def pull(token, since=0, limit=500):
    r = requests.get(f"{BASE}/sync/pull", params={"since": since, "limit": limit},
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def counts(data):
    return {k: len(v) for k, v in data["changes"].items()}


# --- Test 1 : dr_miora ---
doc = pull(login("dr_miora"))
print("dr_miora  :", counts(doc))
print("praticiens:", doc["reference"]["practitioners"])
assert len(doc["changes"]["patients"]) > 0
assert len(doc["changes"]["appointments"]) > 0
assert len(doc["changes"]["consultation_notes"]) >= 1
assert all("profession" in p for p in doc["reference"]["practitioners"])
print("OK 1 : dr_miora reçoit patients, RDV, notes et praticiens avec profession\n")

# --- Test 2 : accueil ---
acc = pull(login("accueil"))
print("accueil   :", counts(acc))
assert acc["changes"]["consultation_notes"] == []
assert len(acc["changes"]["patients"]) > 0
assert len(acc["changes"]["appointments"]) > 0
print("OK 2 : accueil ne reçoit aucune note\n")

# --- Test 3 : delta avec since=next_cursor ---
token = login("dr_miora")
first = pull(token)
again = pull(token, since=first["next_cursor"])
print("curseur   :", first["next_cursor"], "->", again["next_cursor"])
print("2e pull   :", counts(again))
assert all(len(v) == 0 for v in again["changes"].values())
assert again["next_cursor"] == first["next_cursor"]
assert again["has_more"] is False
print("OK 3 : aucun changement renvoyé après le curseur")
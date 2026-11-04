import Dexie from "dexie";
import { uuid } from "../lib/uuid";

export const db = new Dexie("csb_app");

db.version(1).stores({
  patients: "id, last_name, village, search",
  appointments:
    "id, patient_id, practitioner_id, scheduled_at, status, [practitioner_id+scheduled_at]",
  consultation_notes: "id, appointment_id",
  practitioners: "id",
  outbox: "++seq, &op_id, status, [entity+record_id]",
  notices: "++id, seen",
  meta: "key",
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

// Généré une seule fois, puis stable. La transaction évite deux ids si deux appels se croisent.
export function getDeviceId() {
  return db.transaction("rw", db.meta, async () => {
    const row = await db.meta.get("device_id");
    if (row) return row.value;
    const value = uuid();
    await db.meta.put({ key: "device_id", value });
    return value;
  });
}

// À appeler une fois au démarrage, avant d'afficher l'application.
export async function initDb() {
  await db.open();
  const deviceId = await getDeviceId();
  if ((await getMeta("cursor")) === null) await setMeta("cursor", 0);
  // Une op restée 'sending' (appli fermée en plein envoi) est rejouée : sans risque grâce à l'idempotence
  await db.outbox
    .where("status")
    .equals("sending")
    .modify({ status: "pending" });
  return deviceId;
}

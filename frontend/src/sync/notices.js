import { db } from "../db/db";
import { nowIso } from "../lib/dates";

const FIELD_LABELS = {
  last_name: "nom",
  first_name: "prénom",
  sex: "sexe",
  birth_year: "année de naissance",
  phone: "téléphone",
  village: "village",
  practitioner_id: "praticien",
  scheduled_at: "date et heure",
  duration_min: "durée",
  reason: "motif",
  status: "statut",
  temperature_c: "température",
  bp_systolic: "tension systolique",
  bp_diastolic: "tension diastolique",
  weight_kg: "poids",
  observation: "observation",
  next_visit_date: "prochaine visite",
};

export const fieldLabel = (f) => FIELD_LABELS[f] ?? f;
export const showValue = (v) =>
  v === null || v === undefined || v === "" ? "(vide)" : String(v);

/** type : 'merged' | 'rejected' | 'warning'. seen : 0 ou 1 (les booléens ne sont pas indexables). */
export function addNotice({
  type,
  code = null,
  entity = null,
  record_id = null,
  message,
  details = null,
}) {
  return db.notices.add({
    type,
    code,
    entity,
    record_id,
    message,
    details,
    seen: 0,
    created_at: nowIso(),
  });
}

export function markAllSeen() {
  return db.notices.where("seen").equals(0).modify({ seen: 1 });
}

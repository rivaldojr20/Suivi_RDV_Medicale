import { db } from "./db";
import { saveLocal } from "./saveLocal";
import { uuid } from "../lib/uuid";
import { DAY_RE } from "../lib/planning";

const LAST = "\uffff";

/** Notes d'un RDV : celles connues du serveur (created_at) d'abord, les locales ensuite. */
export async function getNotesFor(appointmentId) {
  const notes = await db.consultation_notes
    .where("appointment_id")
    .equals(appointmentId)
    .toArray();
  return notes.sort(
    (a, b) =>
      (a.created_at ?? LAST).localeCompare(b.created_at ?? LAST) ||
      a.id.localeCompare(b.id),
  );
}

export async function getNoteFor(appointmentId) {
  return (await getNotesFor(appointmentId))[0] ?? null;
}

const NUM = /^\d+(\.\d+)?$/;

function readNumber(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (s === "") return { empty: true };
  if (!NUM.test(s)) return { bad: true };
  return { value: Number(s) };
}

function intField(raw, min, max, label, errors, key, data) {
  const r = readNumber(raw);
  if (r.empty) {
    data[key] = null;
    return;
  }
  if (r.bad || !Number.isInteger(r.value)) {
    errors[key] = "Nombre entier attendu.";
    return;
  }
  if (r.value < min || r.value > max) {
    errors[key] = `${label} : entre ${min} et ${max}.`;
    return;
  }
  data[key] = r.value;
}

/**
 * Valide le formulaire (valeurs en texte) et produit les données prêtes pour le contrat.
 * Retourne { errors, data, empty } ; empty = rien de renseigné.
 */
export function parseNoteForm(f) {
  const errors = {};
  const data = {};

  const t = readNumber(f.temperature_c);
  if (t.empty) data.temperature_c = null;
  else if (t.bad) errors.temperature_c = "Nombre invalide.";
  else if (t.value < 30 || t.value > 45)
    errors.temperature_c = "Température : entre 30 et 45 °C.";
  else data.temperature_c = Math.round(t.value * 10) / 10;

  intField(f.bp_systolic, 40, 300, "Systolique", errors, "bp_systolic", data);
  intField(
    f.bp_diastolic,
    20,
    200,
    "Diastolique",
    errors,
    "bp_diastolic",
    data,
  );
  if (!errors.bp_systolic && !errors.bp_diastolic) {
    const s = data.bp_systolic;
    const d = data.bp_diastolic;
    if ((s === null) !== (d === null)) {
      errors[s === null ? "bp_systolic" : "bp_diastolic"] =
        "Renseignez les deux valeurs de la tension.";
    } else if (s !== null && d >= s) {
      errors.bp_diastolic =
        "La diastolique doit être inférieure à la systolique.";
    }
  }

  const w = readNumber(f.weight_kg);
  if (w.empty) data.weight_kg = null;
  else if (w.bad) errors.weight_kg = "Nombre invalide.";
  else if (w.value <= 0 || w.value > 300)
    errors.weight_kg = "Poids : entre 0 et 300 kg.";
  else data.weight_kg = Math.round(w.value * 100) / 100;

  data.observation = String(f.observation ?? "").trim();

  const nv = String(f.next_visit_date ?? "").trim();
  if (nv === "") data.next_visit_date = null;
  else if (!DAY_RE.test(nv)) errors.next_visit_date = "Date invalide.";
  else data.next_visit_date = nv;

  const empty = Object.values(data).every((v) => v === null || v === "");
  return { errors, data, empty };
}

function same(key, a, b) {
  if (key === "observation") return (a ?? "") === b;
  if (key === "next_visit_date") return (a ?? null) === b;
  if (a === null || a === undefined || a === "") return b === null;
  return Number(a) === b;
}

/** Crée ou modifie la note du RDV. Relit la base locale pour éviter un doublon. */
export async function saveNote(appointmentId, data) {
  const existing = await getNoteFor(appointmentId);

  if (!existing) {
    const changes = { appointment_id: appointmentId };
    for (const [k, v] of Object.entries(data))
      if (v !== null && v !== "") changes[k] = v;
    const id = uuid();
    await saveLocal({
      entity: "consultation_notes",
      mode: "create",
      id,
      changes,
    });
    return { mode: "create", id };
  }

  const changes = {};
  for (const k of Object.keys(data))
    if (!same(k, existing[k], data[k])) changes[k] = data[k];
  if (Object.keys(changes).length === 0)
    return { mode: "none", id: existing.id };
  await saveLocal({
    entity: "consultation_notes",
    mode: "update",
    id: existing.id,
    changes,
  });
  return { mode: "update", id: existing.id };
}

/** « 37.5 °C · TA 120/80 · 62 kg » */
export function noteSummary(n) {
  const parts = [];
  if (n.temperature_c != null) parts.push(`${Number(n.temperature_c)} °C`);
  if (n.bp_systolic != null && n.bp_diastolic != null)
    parts.push(`TA ${n.bp_systolic}/${n.bp_diastolic}`);
  if (n.weight_kg != null) parts.push(`${Number(n.weight_kg)} kg`);
  return parts.join(" · ");
}

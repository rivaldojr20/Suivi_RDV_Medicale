import { db } from "./db";
import { ENTITY } from "./schema";
import { searchKey } from "../lib/text";
import { nowIso } from "../lib/dates";
import { uuid } from "../lib/uuid";
import { bus, LOCAL_WRITE } from "../lib/events";

const eq = (a, b) => (a ?? null) === (b ?? null);
const pick = (obj, keys) =>
  Object.fromEntries(
    keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]),
  );
const withSearch = (entity, rec) =>
  entity === "patients" ? { ...rec, search: searchKey(rec) } : rec;
const opsOf = (entity, id) =>
  db.outbox.where("[entity+record_id]").equals([entity, id]).sortBy("seq");

// Ne garde que les champs envoyables, nettoie les textes, convertit les nombres saisis en formulaire
function clean(cfg, input) {
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!cfg.writable.includes(key) || raw === undefined) continue;
    let v = typeof raw === "string" ? raw.trim() : raw;
    if (v === "" && cfg.nullable.includes(key)) v = null;
    if (v !== null && (cfg.ints.includes(key) || cfg.floats.includes(key))) {
      if (typeof v === "string") v = Number(v);
      if (typeof v !== "number" || Number.isNaN(v))
        throw new Error(`${key} : nombre invalide.`);
      if (cfg.ints.includes(key) && !Number.isInteger(v))
        throw new Error(`${key} : entier attendu.`);
    }
    out[key] = v;
  }
  return out;
}

// Dernière op en attente, sinon dernière op en échec (qu'on ressuscite : règle 9)
function pickTarget(ops) {
  const rev = [...ops].reverse();
  return (
    rev.find((o) => o.status === "pending") ??
    rev.find((o) => o.status === "failed")
  );
}
const revive = (op) =>
  op.status === "failed"
    ? { op_id: uuid(), status: "pending", attempts: 0, last_error: null }
    : {};

async function createFlow(entity, cfg, id, changes, localExtra) {
  const full = { ...cfg.defaults, ...clean(cfg, changes) };
  for (const k of cfg.required) {
    if (full[k] === undefined || full[k] === null || full[k] === "")
      throw new Error(`${k} : champ requis.`);
  }
  const now = nowIso();
  const record = withSearch(entity, {
    ...full,
    ...localExtra,
    id,
    version: 0,
    server_rev: 0,
    is_deleted: false,
    created_at: now,
    updated_at: now,
  });
  await db[entity].add(record);
  await db.outbox.add({
    op_id: uuid(),
    entity,
    record_id: id,
    action: "UPSERT",
    base_version: 0,
    data: pick(full, cfg.writable),
    client_created_at: now,
    status: "pending",
    attempts: 0,
    last_error: null,
  });
  return record;
}

async function updateFlow(entity, cfg, existing, changes) {
  if (existing.is_deleted)
    throw new Error("Enregistrement supprimé : modification impossible.");
  const diff = {};
  for (const [k, v] of Object.entries(clean(cfg, changes))) {
    if (cfg.createOnly.includes(k)) {
      if (!eq(existing[k], v))
        throw new Error(`${k} : non modifiable après création.`);
      continue;
    }
    if (!eq(existing[k], v)) diff[k] = v;
  }
  if (Object.keys(diff).length === 0) return existing; // rien à faire : aucune op

  const updated = withSearch(entity, { ...existing, ...diff });
  await db[entity].put(updated);

  const target = pickTarget(await opsOf(entity, existing.id));
  if (target) {
    // coalescence : on garde op_id et base_version, on fusionne les champs
    await db.outbox.update(target.seq, {
      data: { ...target.data, ...diff },
      ...revive(target),
    });
  } else {
    await db.outbox.add({
      op_id: uuid(),
      entity,
      record_id: existing.id,
      action: "UPSERT",
      base_version: existing.version,
      data: diff,
      client_created_at: nowIso(),
      status: "pending",
      attempts: 0,
      last_error: null,
    });
  }
  return updated;
}

async function deleteFlow(entity, existing) {
  if (existing.is_deleted) return existing;
  const ops = await opsOf(entity, existing.id);

  // Règle 10 : jamais connu du serveur et rien en vol -> on efface tout, sans rien envoyer
  if (existing.version === 0 && !ops.some((o) => o.status === "sending")) {
    await db.outbox.bulkDelete(ops.map((o) => o.seq));
    await db[entity].delete(existing.id);
    return null;
  }

  const deleted = { ...existing, is_deleted: true };
  await db[entity].put(deleted);

  const target = pickTarget(ops);
  if (target) {
    const { data, ...rest } = target; // un DELETE n'a pas de `data`
    await db.outbox.put({ ...rest, action: "DELETE", ...revive(target) });
  } else {
    await db.outbox.add({
      op_id: uuid(),
      entity,
      record_id: existing.id,
      action: "DELETE",
      base_version: existing.version,
      client_created_at: nowIso(),
      status: "pending",
      attempts: 0,
      last_error: null,
    });
  }
  return deleted;
}

/**
 * Point d'entrée UNIQUE de toute écriture locale.
 * Écrit l'enregistrement ET l'op d'outbox dans la même transaction (tout ou rien).
 * mode : 'create' | 'update' | 'delete'
 */
export async function saveLocal({
  entity,
  mode,
  id,
  changes = {},
  localExtra = {},
}) {
  const cfg = ENTITY[entity];
  if (!cfg) throw new Error(`Entité inconnue : ${entity}`);
  if (!id) throw new Error("id requis.");

  const result = await db.transaction("rw", db[entity], db.outbox, async () => {
    const existing = await db[entity].get(id);
    if (mode === "create") {
      if (existing) throw new Error("Cet identifiant existe déjà.");
      return createFlow(entity, cfg, id, changes, localExtra);
    }
    if (!existing) throw new Error("Enregistrement introuvable.");
    if (mode === "update") return updateFlow(entity, cfg, existing, changes);
    if (mode === "delete") return deleteFlow(entity, existing);
    throw new Error(`Mode inconnu : ${mode}`);
  });

  bus.dispatchEvent(new Event(LOCAL_WRITE)); // après le commit : la synchro peut se planifier
  return result;
}

export const createRecord = (entity, data, localExtra) =>
  saveLocal({ entity, mode: "create", id: uuid(), changes: data, localExtra });
export const updateRecord = (entity, id, changes) =>
  saveLocal({ entity, mode: "update", id, changes });
export const deleteRecord = (entity, id) =>
  saveLocal({ entity, mode: "delete", id });

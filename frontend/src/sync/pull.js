import { db, getMeta, setMeta } from "../db/db";
import { apiFetch } from "../api/client";
import { SYNC } from "../config";
import { prepareRecord } from "./prepare";

const ENTITIES = ["patients", "appointments", "consultation_notes"];

/** Applique une page dans UNE transaction (incluant meta.cursor). Retourne le nombre de lignes touchées. */
export async function applyPage(data) {
  let count = 0;
  await db.transaction(
    "rw",
    db.patients,
    db.appointments,
    db.consultation_notes,
    db.practitioners,
    db.outbox,
    db.meta,
    async () => {
      const busy = new Set(
        (await db.outbox.toArray()).map((o) => `${o.entity}:${o.record_id}`),
      );

      for (const entity of ENTITIES) {
        const rows = data.changes?.[entity] ?? [];
        if (!rows.length) continue;
        const table = db[entity];
        const locals = await table.bulkGet(rows.map((r) => r.id));
        const puts = [];
        const dels = [];

        rows.forEach((r, i) => {
          const local = locals[i];
          const isBusy = busy.has(`${entity}:${r.id}`); // op en attente, tout statut
          if (r.is_deleted) {
            if (!isBusy && local) dels.push(r.id);
            return;
          }
          if (isBusy) return;
          if (local && (local.version ?? 0) > r.version) return;
          puts.push(prepareRecord(entity, r));
        });

        if (dels.length) await table.bulkDelete(dels);
        if (puts.length) await table.bulkPut(puts);
        count += dels.length + puts.length;
      }

      if (Array.isArray(data.reference?.practitioners)) {
        await db.practitioners.clear();
        await db.practitioners.bulkPut(data.reference.practitioners);
      }

      const cur = (await getMeta("cursor")) ?? 0;
      await setMeta("cursor", Math.max(cur, data.next_cursor ?? cur));
    },
  );
  return count;
}

/** Tire tout jusqu'à has_more = false. Recul de 50 sur la première page. */
export async function pullAll() {
  const start = (await getMeta("cursor")) ?? 0;
  let since = Math.max(0, start - SYNC.CURSOR_OVERLAP);
  let pages = 0;
  let records = 0;

  for (;;) {
    const data = await apiFetch(
      `/sync/pull?since=${since}&limit=${SYNC.PULL_LIMIT}`,
    );
    if (!data || typeof data.next_cursor !== "number")
      throw new Error("Réponse pull invalide");
    records += await applyPage(data);
    pages++;
    if (!data.has_more) break;
    if (data.next_cursor <= since) throw new Error("Curseur de pull bloqué");
    since = data.next_cursor;
  }
  return { pages, records };
}

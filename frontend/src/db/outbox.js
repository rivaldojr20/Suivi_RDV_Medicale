import { db } from "./db";
import { uuid } from "../lib/uuid";
import { bus, LOCAL_WRITE } from "../lib/events";

// "N modifications en attente" de l'écran d'accueil
export const pendingCount = () =>
  db.outbox.where("status").anyOf("pending", "sending").count();
export const failedCount = () =>
  db.outbox.where("status").equals("failed").count();

// Règle 4 : après une réponse du serveur (record.version = N), les ops encore en attente
// sur ce même enregistrement partent de la version N, sinon ce serait de faux conflits.
export function rebasePending(entity, recordId, version) {
  return db.outbox
    .where("[entity+record_id]")
    .equals([entity, recordId])
    .and((o) => o.status === "pending")
    .modify({ base_version: version });
}

// Renvoyer une op en échec : nouvel op_id (le serveur a mémorisé le rejet de l'ancien)
export async function retryOp(seq) {
  const n = await db.outbox
    .where("seq")
    .equals(seq)
    .and((o) => o.status === "failed")
    .modify({
      op_id: uuid(),
      status: "pending",
      attempts: 0,
      last_error: null,
    });
  if (n) bus.dispatchEvent(new Event(LOCAL_WRITE));
}

// Règles 8 et 11 : abandon = on supprime l'op, on retire l'orphelin jamais synchronisé,
// et on remet le curseur à 0 pour que le re-pull écrase la version locale par celle du serveur.
export function abandonOp(seq) {
  return db.transaction(
    "rw",
    db.outbox,
    db.patients,
    db.appointments,
    db.consultation_notes,
    db.meta,
    async () => {
      const op = await db.outbox.get(seq);
      if (!op) return;
      await db.outbox.delete(seq);
      const table = db[op.entity];
      const rec = await table.get(op.record_id);
      if (rec && rec.version === 0) {
        const remaining = await db.outbox
          .where("[entity+record_id]")
          .equals([op.entity, op.record_id])
          .count();
        if (remaining === 0) await table.delete(op.record_id);
      }
      await db.meta.put({ key: "cursor", value: 0 });
    },
  );
}

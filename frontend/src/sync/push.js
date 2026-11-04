import { db, getDeviceId } from "../db/db";
import { apiFetch, ApiError, isNetworkError } from "../api/client";
import { SYNC } from "../config";
import { nowIso } from "../lib/dates";
import { prepareRecord } from "./prepare";
import { addNotice, fieldLabel, showValue } from "./notices";

const backoffMs = (attempts) =>
  SYNC.BACKOFF_MS[Math.min(Math.max(attempts, 1), SYNC.BACKOFF_MS.length) - 1];

function toWire(o) {
  const w = {
    op_id: o.op_id,
    entity: o.entity,
    record_id: o.record_id,
    action: o.action,
    base_version: o.base_version ?? 0,
    client_created_at: o.client_created_at,
  };
  if (o.action !== "DELETE") w.data = o.data ?? {};
  return w;
}

/** Règle S1 : on prend les ops pending dans l'ordre, et on s'arrête à la première en backoff. */
async function claimBatch(size, force) {
  const now = Date.now();
  return db.transaction("rw", db.outbox, async () => {
    const pending = await db.outbox
      .where("status")
      .equals("pending")
      .sortBy("seq");
    const batch = [];
    for (const o of pending) {
      if (!force && o.next_try_at && Date.parse(o.next_try_at) > now) break;
      batch.push(o);
      if (batch.length >= size) break;
    }
    for (const o of batch) await db.outbox.update(o.seq, { status: "sending" });
    return batch;
  });
}

/** Remet des ops en pending. bump = true : attempts++ et backoff. */
async function release(ops, { bump }) {
  await db.transaction("rw", db.outbox, async () => {
    for (const o of ops) {
      if (!bump) {
        await db.outbox.update(o.seq, { status: "pending" });
      } else {
        const attempts = (o.attempts ?? 0) + 1;
        await db.outbox.update(o.seq, {
          status: "pending",
          attempts,
          next_try_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
        });
      }
    }
  });
}

const recordLabel = (entity, rec) => {
  if (entity === "patients")
    return rec
      ? `patient ${rec.last_name ?? ""} ${rec.first_name ?? ""}`.trim()
      : "patient";
  if (entity === "appointments") return "rendez-vous";
  return "note de consultation";
};

export function describeError(err = {}) {
  switch (err.code) {
    case "VALIDATION_ERROR": {
      const f = err.fields
        ? Object.entries(err.fields)
            .map(([k, v]) => `${fieldLabel(k)} : ${v}`)
            .join(" ; ")
        : "";
      return `données invalides${f ? ` (${f})` : ""}`;
    }
    case "FORBIDDEN":
      return "action non autorisée pour votre profil";
    case "DEPENDENCY_MISSING":
      return "élément lié introuvable (patient ou rendez-vous non enregistré)";
    case "RECORD_DELETED":
      return "élément supprimé sur le serveur";
    case "UNSUPPORTED_ACTION":
      return "action non prise en charge";
    case "TOO_LARGE":
      return "opération trop volumineuse";
    default:
      return err.message || "erreur du serveur";
  }
}

function warningMessage(code) {
  if (code === "SLOT_OVERLAP")
    return "Ce rendez-vous chevauche un autre rendez-vous (badge orange).";
  if (code === "OUTSIDE_HOURS")
    return "Ce rendez-vous est en dehors des horaires d'ouverture (7h30-18h).";
  return `Avertissement : ${code}`;
}

/** Règle S2 : remplace le local par la version serveur, rebase et réapplique les ops restantes. */
async function applyServerRecord(op, record) {
  if (!record) return;
  const table = db[op.entity];
  const others = await db.outbox
    .where("[entity+record_id]")
    .equals([op.entity, op.record_id])
    .sortBy("seq");
  for (const o of others)
    await db.outbox.update(o.seq, { base_version: record.version });

  if (op.action === "DELETE" || record.is_deleted) {
    await table.delete(op.record_id);
    return;
  }
  if (others.some((o) => o.action === "DELETE")) return; // déjà supprimé localement

  const merged = { ...record };
  for (const o of others) if (o.data) Object.assign(merged, o.data);
  await table.put(prepareRecord(op.entity, merged));
}

async function fail(op, last_error) {
  await db.outbox.update(op.seq, {
    status: "failed",
    last_error,
    next_try_at: null,
  });
}

async function handleResult(op, r, out) {
  switch (r.status) {
    case "applied":
    case "duplicate":
    case "merged": {
      await db.outbox.delete(op.seq);
      await applyServerRecord(op, r.record);
      const label = recordLabel(op.entity, r.record);

      if (r.status === "merged") {
        out.merged++;
        const replaced = r.conflict?.replaced_values ?? {};
        const lines = Object.entries(replaced).map(
          ([field, v]) =>
            `${fieldLabel(field)} : votre valeur « ${showValue(v.client_value)} » et celle d'un autre appareil ` +
            `« ${showValue(v.server_value)} » différaient ; valeur retenue : « ${showValue(r.record?.[field])} ».`,
        );
        await addNotice({
          type: "merged",
          entity: op.entity,
          record_id: op.record_id,
          details: replaced,
          message: `Conflit sur ${label}. ${lines.join(" ")}`,
        });
      } else {
        out.applied++;
      }

      for (const w of r.warnings ?? []) {
        const code = typeof w === "string" ? w : w.code;
        await addNotice({
          type: "warning",
          code,
          entity: op.entity,
          record_id: op.record_id,
          details: typeof w === "object" ? w : null,
          message: warningMessage(code),
        });
      }
      return;
    }
    case "rejected": {
      out.rejected++;
      const err = r.error ?? { code: "UNKNOWN" };
      await fail(op, {
        code: err.code,
        message: err.message ?? null,
        fields: err.fields ?? null,
      });
      const local = await db[op.entity].get(op.record_id);
      await addNotice({
        type: "rejected",
        code: err.code,
        entity: op.entity,
        record_id: op.record_id,
        details: err,
        message: `Modification refusée pour ${recordLabel(op.entity, local)} : ${describeError(err)}.`,
      });
      return;
    }
    default: {
      out.rejected++;
      await fail(op, {
        code: "UNKNOWN_STATUS",
        message: String(r.status),
        fields: null,
      });
    }
  }
}

/**
 * Envoie toutes les ops pending par lots.
 * Retourne { sent, applied, merged, rejected, error } ; error = null | 'network' | 'reauth' | 'server' | 'forbidden' | 'bad_request'
 */
export async function pushAll({ force = false } = {}) {
  const deviceId = await getDeviceId();
  const out = { sent: 0, applied: 0, merged: 0, rejected: 0, error: null };
  let size = SYNC.PUSH_BATCH;

  for (;;) {
    const ops = await claimBatch(size, force);
    if (ops.length === 0) break;

    let data;
    try {
      data = await apiFetch("/sync/push", {
        method: "POST",
        body: {
          device_id: deviceId,
          client_time: nowIso(),
          operations: ops.map(toWire),
        },
      });
    } catch (e) {
      if (!(e instanceof ApiError)) {
        await release(ops, { bump: false });
        throw e;
      }

      if (e.kind === "reauth") {
        // outbox intacte, pas de tentative comptée
        await release(ops, { bump: false });
        out.error = "reauth";
        break;
      }
      if (e.status === 413) {
        // lot trop gros : on divise par deux
        if (ops.length > 1) {
          await release(ops, { bump: false });
          size = Math.max(1, Math.floor(ops.length / 2));
          continue;
        }
        await fail(ops[0], {
          code: "TOO_LARGE",
          message: "Opération trop volumineuse",
          fields: null,
        });
        out.rejected++;
        continue;
      }
      await release(ops, { bump: true }); // réseau, timeout, 5xx, 400, 403 : on garde tout
      out.error = isNetworkError(e)
        ? "network"
        : e.status >= 500
          ? "server"
          : e.status === 403
            ? "forbidden"
            : e.status === 400
              ? "bad_request"
              : "server";
      break;
    }

    if (!Array.isArray(data?.results)) {
      await release(ops, { bump: true });
      out.error = "server";
      break;
    }

    const byId = new Map(data.results.map((r) => [r.op_id, r]));
    const missing = [];
    try {
      await db.transaction(
        "rw",
        db.outbox,
        db.patients,
        db.appointments,
        db.consultation_notes,
        db.notices,
        async () => {
          for (const op of ops) {
            const r = byId.get(op.op_id);
            if (!r) {
              missing.push(op);
              continue;
            }
            await handleResult(op, r, out);
          }
        },
      );
    } catch (e) {
      await release(ops, { bump: false });
      throw e;
    }

    out.sent += ops.length - missing.length;
    if (missing.length) {
      await release(missing, { bump: true });
      out.error = "server";
      break;
    }
  }
  return out;
}

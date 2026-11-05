import { db } from "./db";
import { saveLocal } from "./saveLocal";
import { localParts, dayRange } from "../lib/planning";

/**
 * RDV du même praticien qui chevauchent [scheduled_at, scheduled_at + duration_min[.
 * Indicatif : le serveur recalcule et fait foi. Les RDV annulés sont ignorés.
 */
export async function findOverlaps({
  practitioner_id,
  scheduled_at,
  duration_min,
  excludeId = null,
}) {
  const [from, to] = dayRange(localParts(scheduled_at).day);
  const start = Date.parse(scheduled_at);
  const end = start + duration_min * 60000;
  const same = await db.appointments
    .where("[practitioner_id+scheduled_at]")
    .between([practitioner_id, from], [practitioner_id, to], true, false)
    .toArray();
  return same.filter((a) => {
    if (a.id === excludeId || a.status === "cancelled") return false;
    const s = Date.parse(a.scheduled_at);
    return s < end && start < s + a.duration_min * 60000;
  });
}

export const setAppointmentStatus = (id, status) =>
  saveLocal({
    entity: "appointments",
    mode: "update",
    id,
    changes: { status },
  });

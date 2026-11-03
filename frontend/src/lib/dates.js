import { CLINIC } from "../config";

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const pad = (n) => String(n).padStart(2, "0");

// ISO UTC sans millisecondes : "2025-03-15T05:00:00Z".
// Indispensable : ".000Z" et "Z" ne se trient pas correctement comme chaînes,
// et les requêtes Dexie par plage de dates comparent des chaînes.
export const toIsoZ = (date) => date.toISOString().replace(".000Z", "Z");

export const nowIso = () => toIsoZ(new Date());

// Jour "AAAA-MM-JJ" à Antananarivo, quel que soit le fuseau du téléphone
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC.TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const todayLocal = () => dayFmt.format(new Date());
export const localDateOf = (iso) => dayFmt.format(new Date(iso));

export function addDays(dateLocal, n) {
  const d = new Date(`${dateLocal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Bornes UTC [start, end[ du jour local, pour interroger scheduled_at
export function dayRangeUtc(dateLocal) {
  const at = (d) => toIsoZ(new Date(`${d}T00:00:00${CLINIC.UTC_OFFSET}`));
  return { start: at(dateLocal), end: at(addDays(dateLocal, 1)) };
}

// 31 créneaux : 07:30, 07:50, ... 17:30 (un créneau à 17:50 finirait à 18:10)
export function slotsOfDay(dateLocal) {
  const slots = [];
  for (
    let t = toMin(CLINIC.OPEN);
    t + CLINIC.SLOT_MIN <= toMin(CLINIC.CLOSE);
    t += CLINIC.SLOT_MIN
  ) {
    const label = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    slots.push({
      label,
      scheduled_at: toIsoZ(
        new Date(`${dateLocal}T${label}:00${CLINIC.UTC_OFFSET}`),
      ),
    });
  }
  return slots;
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: CLINIC.TZ,
  hour: "2-digit",
  minute: "2-digit",
});
export const fmtTime = (iso) => timeFmt.format(new Date(iso));

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: CLINIC.TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});
export const fmtDay = (iso) => dateFmt.format(new Date(iso));
export const fmtDayFromLocal = (dateLocal) =>
  dateFmt.format(new Date(`${dateLocal}T12:00:00${CLINIC.UTC_OFFSET}`));

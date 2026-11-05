import { CLINIC } from "../config";

// Décalage fixe de Madagascar, déduit de CLINIC.UTC_OFFSET ('+03:00')
const m = /^([+-])(\d{2}):(\d{2})$/.exec(CLINIC.UTC_OFFSET);
const OFFSET_MIN = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));

const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => {
  const [h, mi] = hhmm.split(":").map(Number);
  return h * 60 + mi;
};
const fmtMin = (x) => `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
const isoZ = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const OPEN = toMin(CLINIC.OPEN);
const CLOSE = toMin(CLINIC.CLOSE);

/** Créneaux de début : un RDV de 20 min doit finir avant la fermeture → 07:30 … 17:30 (31). */
export const SLOTS = [];
for (let x = OPEN; x + CLINIC.SLOT_MIN <= CLOSE; x += CLINIC.SLOT_MIN)
  SLOTS.push(fmtMin(x));

/** Index du créneau qui contient `time` ('HH:MM'), -1 si hors horaires. */
export function slotIndex(time) {
  const x = toMin(time);
  if (x < OPEN) return -1;
  const i = Math.floor((x - OPEN) / CLINIC.SLOT_MIN);
  return i < SLOTS.length ? i : -1;
}

/** ISO UTC → { day: 'AAAA-MM-JJ', time: 'HH:MM' } à Madagascar. */
export function localParts(iso) {
  const s = new Date(Date.parse(iso) + OFFSET_MIN * 60000).toISOString();
  return { day: s.slice(0, 10), time: s.slice(11, 16) };
}

/** Jour + heure locaux → ISO UTC avec Z. */
export const toUtcIso = (day, time) =>
  isoZ(new Date(Date.parse(`${day}T${time}:00Z`) - OFFSET_MIN * 60000));

export const todayDay = () => localParts(new Date().toISOString()).day;

export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** [début, fin[ du jour local, en ISO UTC (comparables comme du texte). */
export const dayRange = (day) => [
  toUtcIso(day, "00:00"),
  toUtcIso(shiftDay(day, 1), "00:00"),
];

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const fmtDayLong = (day) => dayFmt.format(new Date(`${day}T12:00:00Z`));

export const STATUS = {
  planned: { label: "Prévu", cls: "bg-blue-100 text-blue-800" },
  done: { label: "Fait", cls: "bg-green-100 text-green-800" },
  missed: { label: "Absent", cls: "bg-red-100 text-red-800" },
  cancelled: { label: "Annulé", cls: "bg-slate-200 text-slate-700" },
};

/** « Dr Rasoanaivo (médecin) » */
export function practitionerLabel(p) {
  if (!p) return "Praticien inconnu";
  const prof =
    p.profession === "doctor"
      ? "médecin"
      : p.profession === "midwife"
        ? "sage-femme"
        : null;
  return prof ? `${p.full_name} (${prof})` : p.full_name;
}

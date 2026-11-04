import { CLINIC } from "../config";

const dtf = new Intl.DateTimeFormat("fr-FR", {
  timeZone: CLINIC.TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO UTC → « 06/01 11:02 » (heure de Madagascar). */
export const fmtDateTime = (iso) =>
  iso ? dtf.format(new Date(iso)).replace(",", "") : "—";

export function roleLabel(user) {
  if (!user) return "";
  if (user.role === "reception") return "Accueil";
  if (user.role === "practitioner") {
    if (user.profession === "doctor") return "Médecin";
    if (user.profession === "midwife") return "Sage-femme";
    return "Praticien";
  }
  return user.role;
}

export const ageOf = (birthYear) =>
  birthYear ? new Date().getFullYear() - birthYear : null;

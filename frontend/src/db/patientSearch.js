import { db } from "./db";
import { normalize } from "../lib/text";

const words = (s) =>
  normalize(s ?? "")
    .split(/\s+/)
    .filter(Boolean);

/** Recherche locale instantanée : tous les mots saisis doivent figurer dans `search`. */
export async function searchPatients(query, limit = 100) {
  const tokens = words(query);
  let all = await db.patients.toArray();
  if (tokens.length)
    all = all.filter((p) => tokens.every((t) => (p.search ?? "").includes(t)));
  all.sort(
    (a, b) =>
      (a.last_name ?? "").localeCompare(b.last_name ?? "", "fr") ||
      (a.first_name ?? "").localeCompare(b.first_name ?? "", "fr"),
  );
  return { total: all.length, items: all.slice(0, limit) };
}

/**
 * Patients déjà enregistrés avec les mêmes mots de nom et prénom (mots entiers, sans accent ni casse).
 * Insensible à l'ordre : « Jean Rakoto » trouve « Rakoto Jean ».
 */
export async function findDuplicates({
  last_name,
  first_name,
  excludeId = null,
  limit = 5,
}) {
  const wanted = [...words(last_name), ...words(first_name)];
  if (words(last_name).join("").length < 2) return [];
  return db.patients
    .filter((p) => {
      if (p.id === excludeId) return false;
      const have = new Set([...words(p.last_name), ...words(p.first_name)]);
      return wanted.every((w) => have.has(w));
    })
    .limit(limit)
    .toArray();
}

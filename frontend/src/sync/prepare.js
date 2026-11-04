import { searchKey } from "../lib/text";

/** Prépare un enregistrement serveur avant écriture locale. */
export function prepareRecord(entity, record) {
  if (entity !== "patients") return record;
  // IMPORTANT : doit produire exactement le même `search` que saveLocal (un test le vérifie)
  return { ...record, search: searchKey(record) };
}

// Minuscules, sans accents, espaces normalisés. Sert à la recherche locale
// et à la détection de doublons. Jamais envoyé au serveur.
export function normalize(str) {
  return (str ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const searchKey = (p) =>
  normalize(`${p.last_name ?? ""} ${p.first_name ?? ""}`);

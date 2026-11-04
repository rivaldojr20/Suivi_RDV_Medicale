import { db, setMeta } from "../db/db";
import { apiFetch, ApiError } from "./client";
import { getSession, saveSession, clearSession } from "./session";

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/** Vide les données métier locales (garde device_id, et garde l'outbox sauf si demandé). */
export async function resetLocalData({ includeOutbox = false } = {}) {
  const tables = db.tables.filter(
    (t) => t.name !== "meta" && (includeOutbox || t.name !== "outbox"),
  );
  await db.transaction("rw", [...tables, db.meta], async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await setMeta("cursor", 0);
    await setMeta("last_sync_at", null);
  });
}

export async function login(username, password) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });

  const prev = getSession();
  if (prev && String(prev.user.id) !== String(data.user.id)) {
    const pending = await db.outbox.count();
    if (pending > 0) {
      throw new AuthError(
        "OUTBOX_OTHER_USER",
        `${pending} modification(s) non synchronisée(s) appartiennent à ${prev.user.full_name}. ` +
          `Reconnectez-vous avec ce compte pour les envoyer.`,
      );
    }
    await resetLocalData({ includeOutbox: true }); // autre utilisateur : on repart de zéro
  }

  await saveSession({
    access: data.access,
    refresh: data.refresh,
    user: data.user,
    username,
    reauth: false,
  });
  return data.user;
}

/**
 * Sans force : refuse s'il reste des opérations (tous statuts) dans l'outbox.
 * Avec force : efface tout, y compris l'outbox (données non synchronisées PERDUES).
 */
export async function logout({ force = false } = {}) {
  const pending = await db.outbox.count();
  if (pending > 0 && !force) return { ok: false, pending };
  await resetLocalData({ includeOutbox: true });
  await clearSession();
  return { ok: true, pending: 0 };
}

export function loginErrorMessage(e) {
  if (e instanceof AuthError) return e.message;
  if (e instanceof ApiError) {
    if (e.kind === "network")
      return "Serveur injoignable. La première connexion nécessite du réseau.";
    if (e.kind === "timeout")
      return "Le serveur met trop de temps à répondre. Réessayez.";
    if (e.status === 401) return "Identifiant ou mot de passe incorrect.";
    if (e.status === 403) return "Ce compte n'a pas accès à l'application.";
  }
  return "Erreur inattendue. Réessayez.";
}

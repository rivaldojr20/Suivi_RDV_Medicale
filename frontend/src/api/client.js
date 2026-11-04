import { API_URL, SYNC } from "../config";
import { setOnline } from "./connectivity";
import { getSession, updateAccess, markReauth } from "./session";

/**
 * kind : 'http' | 'network' | 'timeout' | 'reauth'
 * status : code HTTP (0 si pas de réponse)
 */
export class ApiError extends Error {
  constructor({
    message,
    status = 0,
    code = null,
    body = null,
    kind = "http",
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.kind = kind;
  }
}

export const isNetworkError = (e) =>
  e instanceof ApiError && (e.kind === "network" || e.kind === "timeout");
export const isReauth = (e) => e instanceof ApiError && e.kind === "reauth";

const reauthError = () =>
  new ApiError({
    message: "Reconnexion requise",
    status: 401,
    code: "REAUTH_REQUIRED",
    kind: "reauth",
  });

async function rawFetch(
  path,
  { method = "GET", body, token, timeout = SYNC.REQUEST_TIMEOUT_MS } = {},
) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    let res;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      });
    } catch {
      if (timedOut)
        throw new ApiError({ message: "Délai dépassé", kind: "timeout" });
      setOnline(false);
      throw new ApiError({ message: "Serveur injoignable", kind: "network" });
    }

    if (res.status < 500) setOnline(true);

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      throw new ApiError({
        message:
          data?.detail || data?.error?.message || `Erreur HTTP ${res.status}`,
        status: res.status,
        code: data?.error?.code ?? data?.code ?? null,
        body: data,
      });
    }
    return data; // null si 204
  } catch (e) {
    // lecture du corps interrompue par le timeout
    if (!(e instanceof ApiError) && timedOut) {
      throw new ApiError({ message: "Délai dépassé", kind: "timeout" });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Un seul refresh à la fois, partagé par tous les appels concurrents.
let refreshing = null;

function refreshAccess() {
  if (refreshing) return refreshing;
  refreshing = doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh() {
  const s = getSession();
  if (!s || s.reauth) throw reauthError();
  try {
    const { access } = await rawFetch("/auth/refresh", {
      method: "POST",
      body: { refresh: s.refresh },
    });
    await updateAccess(access);
    return access;
  } catch (e) {
    // Seul un refus explicite du serveur impose de se reconnecter.
    // Une panne réseau ne doit JAMAIS invalider la session.
    if (e instanceof ApiError && e.status === 401) {
      await markReauth();
      throw reauthError();
    }
    throw e;
  }
}

/**
 * apiFetch('/sync/pull?since=0', { method, body, auth = true, timeout })
 * Retourne le JSON (ou null pour 204). Lève ApiError.
 * Ne touche jamais à l'outbox.
 */
export async function apiFetch(path, opts = {}) {
  const { auth = true, ...rest } = opts;
  if (!auth) return rawFetch(path, rest);

  const s = getSession();
  if (!s || s.reauth) throw reauthError();

  try {
    return await rawFetch(path, { ...rest, token: s.access });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
  }

  // 401 : jeton expiré. Si un autre appel a déjà renouvelé le jeton, on le réutilise.
  const current = getSession();
  const access =
    current && current.access !== s.access
      ? current.access
      : await refreshAccess();

  try {
    return await rawFetch(path, { ...rest, token: access });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await markReauth();
      throw reauthError();
    }
    throw e;
  }
}

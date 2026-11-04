import { API_URL, SYNC } from "../config";

const RECHECK_WHEN_OFFLINE_MS = 15000;

let online =
  typeof navigator !== "undefined" ? navigator.onLine !== false : true;
const listeners = new Set();
const backOnlineHandlers = new Set();
let inflight = null;
let started = false;

export const isOnline = () => online;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Appelé quand on passe de hors ligne à en ligne (utilisé par la synchro en F3). */
export function onBackOnline(fn) {
  backOnlineHandlers.add(fn);
  return () => backOnlineHandlers.delete(fn);
}

export function setOnline(value) {
  if (value === online) return;
  const was = online;
  online = value;
  listeners.forEach((fn) => fn());
  if (!was && value) {
    backOnlineHandlers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* un handler ne doit pas casser les autres */
      }
    });
  }
}

/** Ping GET /health (204). Une seule vérification à la fois. */
export function checkHealth() {
  if (inflight) return inflight;
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SYNC.HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    setOnline(res.ok);
    return res.ok;
  } catch {
    setOnline(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** À appeler une seule fois au démarrage (main.jsx). */
export function startConnectivityWatch() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("offline", () => setOnline(false));
  // « online » du navigateur ne prouve rien : on confirme par /health
  window.addEventListener("online", () => {
    checkHealth();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkHealth();
  });
  setInterval(() => {
    if (
      !online &&
      document.visibilityState === "visible" &&
      navigator.onLine !== false
    ) {
      checkHealth();
    }
  }, RECHECK_WHEN_OFFLINE_MS);

  if (navigator.onLine === false) setOnline(false);
  else checkHealth();
}

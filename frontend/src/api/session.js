import { getMeta, setMeta } from "../db/db";

// session = { access, refresh, user, username, reauth }
let session = null;
let snapshot = { status: "anonymous", user: null, username: null };
const listeners = new Set();

function compute() {
  if (!session) return { status: "anonymous", user: null, username: null };
  return {
    status: session.reauth ? "reauth" : "active",
    user: session.user,
    username: session.username ?? null,
  };
}

function publish() {
  snapshot = compute();
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getSnapshot = () => snapshot;
export const getSession = () => session;

export async function loadSession() {
  session = (await getMeta("session")) ?? null;
  publish();
}

export async function saveSession(next) {
  session = next;
  publish();
  await setMeta("session", next);
}

export async function updateAccess(access) {
  if (!session) return;
  await saveSession({ ...session, access });
}

/** Refresh refusé : on garde l'utilisateur et l'outbox, on exige un nouveau login. */
export async function markReauth() {
  if (!session) return;
  await saveSession({ ...session, reauth: true });
}

export async function clearSession() {
  session = null;
  publish();
  await setMeta("session", null);
}

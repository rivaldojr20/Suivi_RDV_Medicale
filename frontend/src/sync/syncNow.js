import { getSession } from "../api/session";
import { isOnline, checkHealth } from "../api/connectivity";
import { isNetworkError, isReauth } from "../api/client";
import { setMeta } from "../db/db";
import { nowIso } from "../lib/dates";
import { pushAll } from "./push";
import { pullAll } from "./pull";

let running = null;
let state = { phase: "idle", lastResult: null }; // phase : idle | pushing | pulling
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export const subscribeSync = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getSyncState = () => state;

async function core(force) {
  const s = getSession();
  if (!s) return { status: "skipped", reason: "anonymous" };
  if (s.reauth) return { status: "reauth" };
  if (!isOnline() && !(await checkHealth())) return { status: "offline" };

  setState({ phase: "pushing" });
  const push = await pushAll({ force });
  if (push.error) {
    const status =
      push.error === "network"
        ? "offline"
        : push.error === "reauth"
          ? "reauth"
          : "error";
    return { status, detail: push.error, push };
  }

  setState({ phase: "pulling" });
  const pull = await pullAll();
  await setMeta("last_sync_at", nowIso());
  return { status: "ok", push, pull };
}

async function run(force) {
  let result;
  try {
    result = await core(force);
  } catch (e) {
    if (isReauth(e)) result = { status: "reauth" };
    else if (isNetworkError(e)) result = { status: "offline" };
    else {
      console.error("[sync]", e);
      result = { status: "error", detail: e.message };
    }
  }
  setState({ phase: "idle", lastResult: result });
  return result;
}

/** Verrou unique : un appel pendant une synchro retourne la même promesse. Ne rejette jamais. */
export function syncNow({ force = false } = {}) {
  if (running) return running;
  running = run(force).finally(() => {
    running = null;
  });
  return running;
}

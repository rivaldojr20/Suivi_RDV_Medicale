import { syncNow } from "./syncNow";
import { onBackOnline } from "../api/connectivity";
import { subscribe as subscribeSession, getSnapshot } from "../api/session";
import { bus, LOCAL_WRITE } from "../lib/events";
import { SYNC } from "../config";

// Adaptateur : fonctionne que `bus` soit un EventTarget ou un émetteur on/off
function onLocalWrite(fn) {
  if (typeof bus.addEventListener === "function") {
    bus.addEventListener(LOCAL_WRITE, fn);
    return () => bus.removeEventListener(LOCAL_WRITE, fn);
  }
  if (typeof bus.on === "function") {
    const r = bus.on(LOCAL_WRITE, fn);
    return typeof r === "function" ? r : () => bus.off?.(LOCAL_WRITE, fn);
  }
  throw new Error("events.js : bus incompatible (ni addEventListener ni on)");
}

let started = false;

/** À appeler une seule fois (main.jsx). */
export function startSyncTriggers() {
  if (started) return;
  started = true;

  const active = () => getSnapshot().status === "active";
  const go = (force = false) => {
    if (active()) syncNow({ force });
  };

  onBackOnline(() => go(true));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") go(false);
  });

  setInterval(() => {
    if (document.visibilityState === "visible") go(false);
  }, SYNC.INTERVAL_MS);

  let timer = null;
  onLocalWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(() => go(false), SYNC.DEBOUNCE_MS);
  });

  let prev = getSnapshot().status;
  subscribeSession(() => {
    const now = getSnapshot().status;
    if (now === "active" && prev !== "active") go(true); // login ou reconnexion
    prev = now;
  });

  go(false); // ouverture de l'application
}

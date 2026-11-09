import { useSyncExternalStore } from "react";

/** Demande à Android de ne pas effacer les données locales (outbox comprise). */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export const isStandalone = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(display-mode: standalone)").matches;

// `beforeinstallprompt` peut se déclencher avant le montage de React : on l'écoute dès l'import.
let deferred = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getCanInstall = () => deferred !== null;

export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, getCanInstall);
  const install = async () => {
    if (!deferred) return;
    const d = deferred;
    d.prompt();
    await d.userChoice;
    deferred = null;
    emit();
  };
  return { canInstall, install };
}

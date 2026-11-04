import { useSyncExternalStore } from "react";

const subscribe = (fn) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const getPath = () => window.location.hash.slice(1) || "/";

/** Chemin courant, par exemple '/patients/abc'. */
export const useRoute = () => useSyncExternalStore(subscribe, getPath);

export const navigate = (path) => {
  window.location.hash = path;
};
export const back = () => window.history.back();

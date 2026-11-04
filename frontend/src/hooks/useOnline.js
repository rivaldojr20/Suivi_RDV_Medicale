import { useSyncExternalStore } from "react";
import { subscribe, isOnline } from "../api/connectivity";

export function useOnline() {
  return useSyncExternalStore(subscribe, isOnline);
}

import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot } from "../api/session";
import { login, logout } from "../api/auth";

/** status : 'anonymous' | 'active' | 'reauth' */
export function useSession() {
  const { status, user, username } = useSyncExternalStore(
    subscribe,
    getSnapshot,
  );
  return { status, user, username, login, logout };
}

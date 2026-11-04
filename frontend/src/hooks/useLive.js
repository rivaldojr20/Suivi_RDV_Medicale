import { useEffect, useState } from "react";
import { liveQuery } from "dexie";

/** Résultat réactif d'une requête Dexie. querier : () => Promise. */
export function useLive(querier, initial, deps = []) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const sub = liveQuery(querier).subscribe({
      next: setValue,
      error: (e) => console.error(e),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

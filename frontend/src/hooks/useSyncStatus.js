import { useSyncExternalStore } from "react";
import { db, getMeta } from "../db/db";
import { subscribeSync, getSyncState } from "../sync/syncNow";
import { useOnline } from "./useOnline";
import { useLive } from "./useLive";

const INITIAL = { pending: 0, failed: 0, unseen: 0, lastSyncAt: null };

export function useSyncStatus() {
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const online = useOnline();
  const counts = useLive(
    async () => ({
      pending: await db.outbox
        .where("status")
        .anyOf("pending", "sending")
        .count(),
      failed: await db.outbox.where("status").equals("failed").count(),
      unseen: await db.notices.where("seen").equals(0).count(),
      lastSyncAt: (await getMeta("last_sync_at")) ?? null,
    }),
    INITIAL,
  );

  // phase : idle | pushing | pulling ; lastResult.status : ok | offline | reauth | error | skipped
  return { ...counts, phase: sync.phase, lastResult: sync.lastResult, online };
}

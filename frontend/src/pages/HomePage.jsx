import { db } from "../db/db";
import { useSession } from "../hooks/useSession";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { useLive } from "../hooks/useLive";
import { syncNow } from "../sync/syncNow";
import { markAllSeen } from "../sync/notices";
import { describeError } from "../sync/push";
import { retryOp, abandonOp } from "../db/outbox";
import { getSession, saveSession } from "../api/session";
import { navigate } from "../lib/router";
import { fmtDateTime, roleLabel } from "../lib/format";

const RESULT_MSG = {
  offline:
    "Serveur injoignable. Vos données sont conservées et seront envoyées plus tard.",
  error:
    "La synchronisation a échoué. Une nouvelle tentative aura lieu automatiquement.",
};
const NOTICE_STYLE = {
  merged: ["Conflit résolu", "border-amber-400 bg-amber-50"],
  rejected: ["Refusé", "border-red-400 bg-red-50"],
  warning: ["Avertissement", "border-orange-400 bg-orange-50"],
};

function opLabel(o) {
  const verb =
    o.action === "DELETE"
      ? "Suppression"
      : o.base_version === 0
        ? "Création"
        : "Modification";
  if (o.entity === "patients")
    return `${verb} du patient ${o.local?.last_name ?? ""} ${o.local?.first_name ?? ""}`.trim();
  if (o.entity === "appointments") return `${verb} d'un rendez-vous`;
  return `${verb} d'une note de consultation`;
}

function FailedOps() {
  const failed = useLive(async () => {
    const ops = await db.outbox.where("status").equals("failed").sortBy("seq");
    return Promise.all(
      ops.map(async (o) => ({
        ...o,
        local: await db[o.entity].get(o.record_id),
      })),
    );
  }, []);
  if (failed.length === 0) return null;

  const retry = async (o) => {
    await retryOp(o.seq);
    syncNow({ force: true });
  };
  const abandon = async (o) => {
    const create = o.action === "UPSERT" && o.base_version === 0;
    const text = create
      ? "Abandonner supprimera aussi cet enregistrement de ce téléphone. Continuer ?"
      : "Vos modifications locales seront annulées à la prochaine synchronisation. Continuer ?";
    if (!window.confirm(text)) return;
    await abandonOp(o.seq);
    syncNow({ force: true });
  };

  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-red-700">
        À vérifier ({failed.length})
      </h2>
      {failed.map((o) => (
        <div
          key={o.seq}
          className="rounded border border-red-300 bg-red-50 p-3 text-sm"
        >
          <p className="font-medium">{opLabel(o)}</p>
          <p className="text-red-800">
            Refusé : {describeError(o.last_error ?? {})}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {o.entity === "patients" && o.local && (
              <button
                className="rounded bg-blue-700 px-3 py-1 text-white"
                onClick={() => navigate(`/patients/${o.record_id}`)}
              >
                Corriger
              </button>
            )}
            <button
              className="rounded bg-slate-600 px-3 py-1 text-white"
              onClick={() => retry(o)}
            >
              Réessayer
            </button>
            <button
              className="rounded border border-red-600 px-3 py-1 text-red-700"
              onClick={() => abandon(o)}
            >
              Abandonner
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Notices() {
  const notices = useLive(
    () => db.notices.orderBy("id").reverse().limit(20).toArray(),
    [],
  );
  const unseen = notices.filter((n) => !n.seen).length;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Notices{" "}
          {unseen > 0 && (
            <span className="text-blue-700">({unseen} non lue(s))</span>
          )}
        </h2>
        {unseen > 0 && (
          <button className="text-sm underline" onClick={markAllSeen}>
            Tout marquer comme lu
          </button>
        )}
      </div>
      {notices.length === 0 && (
        <p className="text-sm text-slate-500">Aucune notice.</p>
      )}
      {notices.map((n) => {
        const [label, style] = NOTICE_STYLE[n.type] ?? [
          "Information",
          "border-slate-300 bg-white",
        ];
        return (
          <div
            key={n.id}
            className={`rounded border p-2 text-sm ${style} ${n.seen ? "opacity-70" : ""}`}
          >
            <div className="flex justify-between text-xs text-slate-600">
              <b>{label}</b>
              <span>{fmtDateTime(n.created_at)}</span>
            </div>
            <p>{n.message}</p>
          </div>
        );
      })}
    </section>
  );
}

export default function HomePage() {
  const { user, logout } = useSession();
  const s = useSyncStatus();
  const nPatients = useLive(() => db.patients.count(), 0);
  const syncing = s.phase !== "idle";
  const lastMsg = RESULT_MSG[s.lastResult?.status];

  async function onLogout() {
    const r = await logout();
    if (r.ok) return;
    const text =
      `${r.pending} modification(s) ne sont pas encore envoyées au serveur et seront PERDUES. ` +
      `Synchronisez d'abord si possible. Se déconnecter quand même ?`;
    if (window.confirm(text)) await logout({ force: true });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{user.full_name}</h1>
        <p className="text-sm text-slate-600">{roleLabel(user)}</p>
      </div>

      <section className="space-y-2 rounded border bg-white p-3 text-sm">
        <p>
          Dernière synchronisation : <b>{fmtDateTime(s.lastSyncAt)}</b>
        </p>
        <p>
          {s.pending} modification(s) en attente · {nPatients} patient(s) sur ce
          téléphone
        </p>
        {lastMsg && <p className="text-amber-700">{lastMsg}</p>}
        <button
          disabled={syncing}
          onClick={() => syncNow({ force: true })}
          className="w-full rounded bg-blue-700 p-2 font-medium text-white disabled:opacity-50"
        >
          {syncing ? "Synchronisation..." : "Synchroniser maintenant"}
        </button>
      </section>

      <FailedOps />
      <Notices />

      <button
        onClick={onLogout}
        className="w-full rounded border border-slate-400 p-2 text-sm"
      >
        Se déconnecter
      </button>

      {localStorage.getItem("dev") === "1" && (
        <button
          className="w-full rounded bg-slate-200 p-2 text-xs"
          onClick={() =>
            saveSession({ ...getSession(), access: "x", refresh: "x" })
          }
        >
          [test] Corrompre les jetons
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import { db } from "../db/db";
import { useLive } from "../hooks/useLive";
import { useSession } from "../hooks/useSession";
import { navigate } from "../lib/router";
import { setAppointmentStatus } from "../db/appointmentQueries";
import { StatusBadge } from "../components/AppointmentBits";
import {
  SLOTS,
  slotIndex,
  localParts,
  dayRange,
  todayDay,
  shiftDay,
  fmtDayLong,
  practitionerLabel,
} from "../lib/planning";
import { CLINIC } from "../config";

const EMPTY = { apps: [] };

function Card({ a, prById, mark }) {
  const p = a.patient;
  const { time } = localParts(a.scheduled_at);
  return (
    <div
      className={`rounded border p-2 text-sm ${
        a.has_conflict ? "border-orange-400 bg-orange-50" : "bg-white"
      } ${a.status === "cancelled" ? "opacity-60" : ""}`}
    >
      <button
        onClick={() => navigate(`/rdv/a/${a.id}`)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">
            {p ? (
              <>
                <span className="uppercase">{p.last_name}</span> {p.first_name}
              </>
            ) : (
              "Patient non synchronisé"
            )}
          </span>
          <StatusBadge status={a.status} />
        </div>
        <div className="text-slate-600">
          {time} · {a.duration_min} min ·{" "}
          {practitionerLabel(prById.get(a.practitioner_id))}
        </div>
        {a.reason && <div className="text-xs text-slate-500">{a.reason}</div>}
        <div className="mt-1 flex flex-wrap gap-1">
          {a.has_conflict && (
            <span className="rounded bg-orange-200 px-2 text-xs text-orange-900">
              Chevauchement
            </span>
          )}
          {mark === "pending" && (
            <span className="rounded bg-blue-100 px-2 text-xs text-blue-800">
              en attente
            </span>
          )}
          {mark === "failed" && (
            <span className="rounded bg-red-100 px-2 text-xs text-red-800">
              à vérifier
            </span>
          )}
        </div>
      </button>
      {a.status === "planned" && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setAppointmentStatus(a.id, "done")}
            className="rounded bg-green-600 px-3 py-1 text-xs text-white"
          >
            Fait
          </button>
          <button
            onClick={() => setAppointmentStatus(a.id, "missed")}
            className="rounded bg-red-600 px-3 py-1 text-xs text-white"
          >
            Absent
          </button>
        </div>
      )}
    </div>
  );
}

export default function PlanningPage({ day }) {
  const { user } = useSession();
  const reception = user.role === "reception";
  const today = todayDay();
  const date = day ?? today;

  const practitioners = useLive(() => db.practitioners.toArray(), []);
  const [pf, setPf] = useState(
    () =>
      sessionStorage.getItem("planning_pf") ??
      (user.role === "practitioner" ? user.id : "all"),
  );
  const filter =
    pf === "all" || practitioners.some((p) => p.id === pf) ? pf : "all";
  const changeFilter = (v) => {
    sessionStorage.setItem("planning_pf", v);
    setPf(v);
  };
  const prById = new Map(practitioners.map((p) => [p.id, p]));

  const data = useLive(
    async () => {
      const [from, to] = dayRange(date);
      const apps = await db.appointments
        .where("scheduled_at")
        .between(from, to, true, false)
        .toArray();
      const pats = await db.patients.bulkGet([
        ...new Set(apps.map((a) => a.patient_id)),
      ]);
      const byId = new Map(pats.filter(Boolean).map((p) => [p.id, p]));
      return {
        apps: apps.map((a) => ({
          ...a,
          patient: byId.get(a.patient_id) ?? null,
        })),
      };
    },
    EMPTY,
    [date],
  );

  const marks = useLive(async () => {
    const m = {};
    for (const o of await db.outbox.toArray()) {
      if (o.entity === "appointments" && m[o.record_id] !== "failed") {
        m[o.record_id] = o.status === "failed" ? "failed" : "pending";
      }
    }
    return m;
  }, {});

  const shown = data.apps
    .filter((a) => filter === "all" || a.practitioner_id === filter)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const byIdx = new Map();
  const outside = [];
  for (const a of shown) {
    const i = slotIndex(localParts(a.scheduled_at).time);
    if (i < 0) outside.push(a);
    else byIdx.set(i, [...(byIdx.get(i) ?? []), a]);
  }

  // Créneaux couverts par un RDV plus long (seulement quand un praticien est filtré)
  const covered = new Set();
  if (filter !== "all") {
    for (const [i, list] of byIdx) {
      for (const a of list) {
        if (a.status === "cancelled") continue;
        for (let k = 1; k < Math.ceil(a.duration_min / CLINIC.SLOT_MIN); k++)
          covered.add(i + k);
      }
    }
  }

  const go = (d) => navigate(`/rdv/${d}`);
  const create = (slot) =>
    navigate(
      `/rdv/new/${date}/${slot.replace(":", "")}${filter !== "all" ? `/${filter}` : ""}`,
    );
  const planned = shown.filter((a) => a.status === "planned").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button
          aria-label="Jour précédent"
          onClick={() => go(shiftDay(date, -1))}
          className="rounded border bg-white px-3 py-2"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="min-w-0 flex-1 rounded border p-2 text-center"
        />
        <button
          aria-label="Jour suivant"
          onClick={() => go(shiftDay(date, 1))}
          className="rounded border bg-white px-3 py-2"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium capitalize">{fmtDayLong(date)}</span>
        {date !== today && (
          <button className="underline" onClick={() => go(today)}>
            Aujourd'hui
          </button>
        )}
      </div>

      <select
        value={filter}
        onChange={(e) => changeFilter(e.target.value)}
        className="w-full rounded border bg-white p-2 text-sm"
      >
        <option value="all">Tous les praticiens</option>
        {practitioners.map((p) => (
          <option key={p.id} value={p.id}>
            {practitionerLabel(p)}
          </option>
        ))}
      </select>

      <p className="text-xs text-slate-500">
        {shown.length} rendez-vous · {planned} prévu(s)
      </p>

      <ul className="space-y-1">
        {SLOTS.map((slot, i) => {
          const items = byIdx.get(i) ?? [];
          return (
            <li key={slot} className="flex gap-2">
              <div className="w-12 shrink-0 pt-2 text-xs text-slate-500">
                {slot}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {items.map((a) => (
                  <Card key={a.id} a={a} prById={prById} mark={marks[a.id]} />
                ))}
                {items.length === 0 && covered.has(i) && (
                  <div className="py-2 text-xs text-slate-400">occupé</div>
                )}
                {items.length === 0 &&
                  !covered.has(i) &&
                  (reception ? (
                    <button
                      onClick={() => create(slot)}
                      className="w-full rounded border border-dashed py-2 text-xs text-slate-400"
                    >
                      + Libre
                    </button>
                  ) : (
                    <div className="py-2 text-xs text-slate-300">—</div>
                  ))}
                {items.length > 0 && reception && (
                  <button
                    onClick={() => create(slot)}
                    className="text-xs text-blue-700 underline"
                  >
                    + ajouter ici
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {outside.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-orange-700">
            Hors horaires d'ouverture
          </h2>
          {outside.map((a) => (
            <Card key={a.id} a={a} prById={prById} mark={marks[a.id]} />
          ))}
        </section>
      )}
    </div>
  );
}

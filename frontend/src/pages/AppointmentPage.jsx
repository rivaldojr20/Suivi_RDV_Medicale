import { useState } from "react";
import { db } from "../db/db";
import { saveLocal } from "../db/saveLocal";
import { uuid } from "../lib/uuid";
import { useLive } from "../hooks/useLive";
import { useSession } from "../hooks/useSession";
import { searchPatients } from "../db/patientSearch";
import { findOverlaps } from "../db/appointmentQueries";
import { navigate } from "../lib/router";
import { CLINIC } from "../config";
import { StatusBadge, StatusButtons } from "../components/AppointmentBits";
import NoteSection from "../components/NoteSection";
import {
  SLOTS,
  STATUS,
  DAY_RE,
  localParts,
  toUtcIso,
  todayDay,
  fmtDayLong,
  practitionerLabel,
} from "../lib/planning";

const EMPTY = { total: 0, items: [] };
const input = "w-full rounded border p-2";
const TIME_RE = /^\d{2}:\d{2}$/;

function Field({ label, error, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

function PatientName({ p }) {
  return p ? (
    <>
      <span className="uppercase">{p.last_name}</span> {p.first_name}
    </>
  ) : (
    <>Patient non synchronisé</>
  );
}

function PatientPicker({ value, onChange, locked }) {
  const [q, setQ] = useState("");
  const chosen = useLive(
    async () => (value ? ((await db.patients.get(value)) ?? null) : null),
    null,
    [value],
  );
  const results = useLive(
    () => (q.trim() ? searchPatients(q, 6) : Promise.resolve(EMPTY)),
    EMPTY,
    [q],
  );

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border bg-white p-2 text-sm">
        <span className="font-medium">
          <PatientName p={chosen} />
        </span>
        {locked ? (
          <button
            type="button"
            className="underline"
            onClick={() => navigate(`/patients/${value}`)}
          >
            Fiche
          </button>
        ) : (
          <button
            type="button"
            className="underline"
            onClick={() => onChange("")}
          >
            Changer
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <input
        className={input}
        type="search"
        placeholder="Rechercher un patient..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.items.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className="block w-full rounded border bg-white p-2 text-left text-sm"
        >
          <PatientName p={p} />
          <span className="text-slate-500">
            {p.birth_year ? ` · ${p.birth_year}` : ""}
            {p.village ? ` · ${p.village}` : ""}
          </span>
        </button>
      ))}
      {q.trim() && results.total === 0 && (
        <p className="text-xs text-slate-500">
          Aucun patient. Créez-le d'abord dans l'onglet Patients.
        </p>
      )}
    </div>
  );
}

/** Accueil : création et modification complète. */
function AppointmentForm({ appt, day, time, practitionerId }) {
  const isNew = !appt;
  const free = localStorage.getItem("dev") === "1"; // heure libre (test T12)
  const init = appt
    ? localParts(appt.scheduled_at)
    : {
        day: DAY_RE.test(day ?? "") ? day : todayDay(),
        time: time ?? SLOTS[0],
      };

  const practitioners = useLive(() => db.practitioners.toArray(), []);
  const [f, setF] = useState({
    patient_id: appt?.patient_id ?? "",
    practitioner_id: appt?.practitioner_id ?? practitionerId ?? "",
    day: init.day,
    time: init.time,
    duration_min: appt?.duration_min ?? CLINIC.SLOT_MIN,
    reason: appt?.reason ?? "",
    status: appt?.status ?? "planned",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const timeOptions = SLOTS.includes(f.time)
    ? SLOTS
    : [...SLOTS, f.time].sort();
  const durations = CLINIC.DURATIONS.includes(Number(f.duration_min))
    ? CLINIC.DURATIONS
    : [...CLINIC.DURATIONS, Number(f.duration_min)].sort((a, b) => a - b);

  const ready = f.practitioner_id && DAY_RE.test(f.day) && TIME_RE.test(f.time);
  const overlaps = useLive(
    () =>
      ready
        ? findOverlaps({
            practitioner_id: f.practitioner_id,
            scheduled_at: toUtcIso(f.day, f.time),
            duration_min: Number(f.duration_min),
            excludeId: appt?.id ?? null,
          })
        : Promise.resolve([]),
    [],
    [f.practitioner_id, f.day, f.time, f.duration_min],
  );

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!f.patient_id) errs.patient = "Choisissez un patient.";
    if (!f.practitioner_id) errs.practitioner = "Choisissez un praticien.";
    if (!DAY_RE.test(f.day)) errs.day = "Date invalide.";
    if (!TIME_RE.test(f.time)) errs.time = "Heure invalide.";
    if (!f.reason.trim()) errs.reason = "Indiquez le motif.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const data = {
        practitioner_id: f.practitioner_id,
        scheduled_at: toUtcIso(f.day, f.time),
        duration_min: Number(f.duration_min),
        reason: f.reason.trim(),
        status: f.status,
      };
      if (isNew) {
        await saveLocal({
          entity: "appointments",
          mode: "create",
          id: uuid(),
          changes: { patient_id: f.patient_id, ...data },
        });
      } else {
        const changes = {};
        for (const k of Object.keys(data))
          if (appt[k] !== data[k]) changes[k] = data[k];
        if (Object.keys(changes).length) {
          await saveLocal({
            entity: "appointments",
            mode: "update",
            id: appt.id,
            changes,
          });
        }
      }
      navigate(`/rdv/${f.day}`);
    } catch (err) {
      setErrors({ form: err.message || "Échec de l'enregistrement." });
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Supprimer ce rendez-vous ?")) return;
    await saveLocal({ entity: "appointments", mode: "delete", id: appt.id });
    navigate(`/rdv/${init.day}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold">
        {isNew ? "Nouveau rendez-vous" : "Modifier le rendez-vous"}
      </h1>

      <Field label="Patient *" error={errors.patient}>
        <PatientPicker
          value={f.patient_id}
          locked={!isNew}
          onChange={(id) => setF({ ...f, patient_id: id })}
        />
      </Field>

      <Field label="Praticien *" error={errors.practitioner}>
        <select
          className={input}
          value={f.practitioner_id}
          onChange={set("practitioner_id")}
        >
          <option value="">Choisir...</option>
          {practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {practitionerLabel(p)}
            </option>
          ))}
        </select>
        {practitioners.length === 0 && (
          <span className="text-xs text-amber-700">
            Aucun praticien : synchronisez d'abord.
          </span>
        )}
      </Field>

      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="Jour *" error={errors.day}>
            <input
              className={input}
              type="date"
              value={f.day}
              onChange={set("day")}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Heure *" error={errors.time}>
            {free ? (
              <input
                className={input}
                type="time"
                value={f.time}
                onChange={set("time")}
              />
            ) : (
              <select className={input} value={f.time} onChange={set("time")}>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {SLOTS.includes(t) ? "" : " (hors grille)"}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </div>

      <Field label="Durée">
        <select
          className={input}
          value={f.duration_min}
          onChange={set("duration_min")}
        >
          {durations.map((d) => (
            <option key={d} value={d}>
              {d} min
            </option>
          ))}
        </select>
      </Field>

      <Field label="Motif *" error={errors.reason}>
        <input
          className={input}
          list="motifs"
          maxLength={200}
          value={f.reason}
          onChange={set("reason")}
        />
        <datalist id="motifs">
          {[
            "Consultation",
            "Consultation prénatale",
            "Vaccination",
            "Contrôle",
            "Suivi",
          ].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      {!isNew && (
        <Field label="Statut">
          <select className={input} value={f.status} onChange={set("status")}>
            {Object.entries(STATUS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {overlaps.length > 0 && (
        <div className="rounded border border-orange-400 bg-orange-50 p-2 text-sm">
          <p className="font-medium">
            Ce créneau chevauche un autre rendez-vous de ce praticien :
          </p>
          <ul className="list-disc pl-5">
            {overlaps.map((o) => (
              <li key={o.id}>
                {localParts(o.scheduled_at).time} · {o.duration_min} min
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-600">
            Vous pouvez enregistrer quand même : les deux rendez-vous recevront
            un badge orange.
          </p>
        </div>
      )}

      {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate(`/rdv/${f.day}`)}
          className="flex-1 rounded border p-3"
        >
          Annuler
        </button>
        <button
          disabled={saving}
          className="flex-1 rounded bg-blue-700 p-3 font-medium text-white disabled:opacity-50"
        >
          {overlaps.length > 0 ? "Enregistrer quand même" : "Enregistrer"}
        </button>
      </div>

      {!isNew && (
        <button
          type="button"
          onClick={remove}
          className="w-full rounded border border-red-600 p-2 text-sm text-red-700"
        >
          Supprimer ce rendez-vous
        </button>
      )}
    </form>
  );
}

/** Praticien : lecture seule, changement de statut uniquement. */
function AppointmentView({ appt }) {
  const info = useLive(
    async () => ({
      patient: (await db.patients.get(appt.patient_id)) ?? null,
      pr: (await db.practitioners.get(appt.practitioner_id)) ?? null,
    }),
    { patient: null, pr: null },
    [appt.patient_id, appt.practitioner_id],
  );
  const { day, time } = localParts(appt.scheduled_at);

  return (
    <div className="space-y-3">
      <button
        className="text-sm underline"
        onClick={() => navigate(`/rdv/${day}`)}
      >
        ← Planning
      </button>
      <div className="space-y-1 rounded border bg-white p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">
            <PatientName p={info.patient} />
          </h1>
          <StatusBadge status={appt.status} />
        </div>
        <p className="capitalize">
          {fmtDayLong(day)} · {time} · {appt.duration_min} min
        </p>
        <p>{practitionerLabel(info.pr)}</p>
        {appt.reason && <p className="text-slate-600">Motif : {appt.reason}</p>}
        {appt.has_conflict && (
          <p className="inline-block rounded bg-orange-200 px-2 text-xs text-orange-900">
            Chevauchement
          </p>
        )}
        {info.patient && (
          <button
            className="text-blue-700 underline"
            onClick={() => navigate(`/patients/${info.patient.id}`)}
          >
            Fiche patient
          </button>
        )}
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">Changer le statut</h2>
        <StatusButtons appt={appt} />
      </section>
      <NoteSection appt={appt} />
    </div>
  );
}

export default function AppointmentPage({ id, day, time, practitionerId }) {
  const { user } = useSession();
  const reception = user.role === "reception";
  const isNew = !id;
  // null = chargement, false = introuvable
  const appt = useLive(
    async () => (isNew ? null : ((await db.appointments.get(id)) ?? false)),
    null,
    [id],
  );

  if (isNew) {
    return reception ? (
      <AppointmentForm
        appt={null}
        day={day}
        time={time}
        practitionerId={practitionerId}
      />
    ) : (
      <p className="rounded bg-white p-4 text-sm">
        Seule la réception peut créer un rendez-vous.
      </p>
    );
  }
  if (appt === null)
    return <p className="text-sm text-slate-500">Chargement...</p>;
  if (appt === false) {
    return (
      <div className="space-y-2">
        <p>Rendez-vous introuvable (supprimé ?).</p>
        <button className="underline" onClick={() => navigate("/rdv")}>
          Retour au planning
        </button>
      </div>
    );
  }
  return reception ? (
    <AppointmentForm appt={appt} />
  ) : (
    <AppointmentView appt={appt} />
  );
}

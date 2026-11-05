import { useState } from "react";
import { db } from "../db/db";
import { useLive } from "../hooks/useLive";
import { useSession } from "../hooks/useSession";
import { navigate } from "../lib/router";
import { localParts, fmtDayLong } from "../lib/planning";
import { getNotesFor, saveNote, parseNoteForm } from "../db/noteQueries";
import { describeError } from "../sync/push";

const input = "w-full rounded border p-2";
const txt = (v) => (v === null || v === undefined ? "" : String(v));

function Field({ label, error, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

function NoteSyncState({ noteId }) {
  const ops = useLive(
    () =>
      noteId
        ? db.outbox
            .where("[entity+record_id]")
            .equals(["consultation_notes", noteId])
            .toArray()
        : Promise.resolve([]),
    [],
    [noteId],
  );
  const failed = ops.find((o) => o.status === "failed");
  if (failed) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
        Refusé par le serveur : {describeError(failed.last_error ?? {})}.
        Corrigez puis enregistrez à nouveau.
      </div>
    );
  }
  if (ops.length > 0) {
    return (
      <p className="rounded bg-blue-50 p-2 text-sm text-blue-800">
        En attente d'envoi au serveur.
      </p>
    );
  }
  return null;
}

function NoteForm({ appt, patient, notes }) {
  const note = notes[0] ?? null;
  const { day, time } = localParts(appt.scheduled_at);
  const [f, setF] = useState({
    temperature_c: txt(note?.temperature_c),
    bp_systolic: txt(note?.bp_systolic),
    bp_diastolic: txt(note?.bp_diastolic),
    weight_kg: txt(note?.weight_kg),
    observation: txt(note?.observation),
    next_visit_date: txt(note?.next_visit_date),
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const back = () => navigate(`/rdv/a/${appt.id}`);

  async function submit(e) {
    e.preventDefault();
    const { errors: errs, data, empty } = parseNoteForm(f);
    if (!note && empty) errs.form = "Renseignez au moins une information.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await saveNote(appt.id, data);
      back();
    } catch (err) {
      setErrors({ form: err.message || "Échec de l'enregistrement." });
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <button type="button" className="text-sm underline" onClick={back}>
        ← Rendez-vous
      </button>
      <div>
        <h1 className="text-xl font-bold">Note de consultation</h1>
        <p className="text-sm text-slate-600">
          {patient ? (
            <>
              <span className="uppercase">{patient.last_name}</span>{" "}
              {patient.first_name}
            </>
          ) : (
            "Patient non synchronisé"
          )}
          {" · "}
          <span className="capitalize">{fmtDayLong(day)}</span> {time}
        </p>
        {appt.reason && (
          <p className="text-xs text-slate-500">Motif : {appt.reason}</p>
        )}
      </div>

      {notes.length > 1 && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          {notes.length} notes existent pour ce rendez-vous (saisies sur deux
          appareils). La plus ancienne est affichée.
        </div>
      )}

      <NoteSyncState noteId={note?.id} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Température (°C)" error={errors.temperature_c}>
          <input
            className={input}
            inputMode="decimal"
            placeholder="37,5"
            value={f.temperature_c}
            onChange={set("temperature_c")}
          />
        </Field>
        <Field label="Poids (kg)" error={errors.weight_kg}>
          <input
            className={input}
            inputMode="decimal"
            placeholder="62,5"
            value={f.weight_kg}
            onChange={set("weight_kg")}
          />
        </Field>
        <Field label="Tension systolique" error={errors.bp_systolic}>
          <input
            className={input}
            inputMode="numeric"
            placeholder="120"
            value={f.bp_systolic}
            onChange={set("bp_systolic")}
          />
        </Field>
        <Field label="Tension diastolique" error={errors.bp_diastolic}>
          <input
            className={input}
            inputMode="numeric"
            placeholder="80"
            value={f.bp_diastolic}
            onChange={set("bp_diastolic")}
          />
        </Field>
      </div>

      <Field label="Observation">
        <textarea
          className={input}
          rows={5}
          value={f.observation}
          onChange={set("observation")}
        />
      </Field>

      <Field label="Prochaine visite" error={errors.next_visit_date}>
        <input
          className={input}
          type="date"
          value={f.next_visit_date}
          onChange={set("next_visit_date")}
        />
      </Field>

      {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={back}
          className="flex-1 rounded border p-3"
        >
          Annuler
        </button>
        <button
          disabled={saving}
          className="flex-1 rounded bg-blue-700 p-3 font-medium text-white disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
    </form>
  );
}

function NoteLoader({ appointmentId }) {
  // null = chargement, false = introuvable
  const appt = useLive(
    async () => (await db.appointments.get(appointmentId)) ?? false,
    null,
    [appointmentId],
  );
  const notes = useLive(() => getNotesFor(appointmentId), null, [
    appointmentId,
  ]);
  const patient = useLive(
    async () =>
      appt ? ((await db.patients.get(appt.patient_id)) ?? null) : null,
    null,
    [appt?.patient_id],
  );

  if (appt === null || notes === null)
    return <p className="text-sm text-slate-500">Chargement...</p>;
  if (appt === false) {
    return (
      <div className="space-y-2">
        <p>Rendez-vous introuvable.</p>
        <button className="underline" onClick={() => navigate("/rdv")}>
          Retour au planning
        </button>
      </div>
    );
  }
  return <NoteForm appt={appt} patient={patient} notes={notes} />;
}

export default function NotePage({ appointmentId }) {
  const { user } = useSession();
  if (user.role !== "practitioner") {
    return (
      <p className="rounded bg-white p-4 text-sm">
        Les notes de consultation sont réservées aux praticiens.
      </p>
    );
  }
  return <NoteLoader appointmentId={appointmentId} />;
}

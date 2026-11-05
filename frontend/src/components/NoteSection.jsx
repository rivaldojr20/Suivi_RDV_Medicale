import { useLive } from "../hooks/useLive";
import { getNoteFor, noteSummary } from "../db/noteQueries";
import { navigate } from "../lib/router";
import { fmtDayLong } from "../lib/planning";

export default function NoteSection({ appt }) {
  const note = useLive(() => getNoteFor(appt.id), undefined, [appt.id]); // undefined = chargement
  if (note === undefined) return null;
  const summary = note ? noteSummary(note) : "";

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Note de consultation</h2>
      {note ? (
        <div className="space-y-1 rounded border bg-white p-3 text-sm">
          {summary && <p className="font-medium">{summary}</p>}
          {note.observation && (
            <p className="whitespace-pre-wrap text-slate-600">
              {note.observation.length > 200
                ? `${note.observation.slice(0, 200)}…`
                : note.observation}
            </p>
          )}
          {note.next_visit_date && (
            <p>
              Prochaine visite :{" "}
              <span className="capitalize">
                {fmtDayLong(note.next_visit_date)}
              </span>
            </p>
          )}
          {!summary && !note.observation && !note.next_visit_date && (
            <p className="text-slate-500">Note vide.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          {appt.status === "done"
            ? "Consultation faite : aucune note enregistrée."
            : "Aucune note."}
        </p>
      )}
      <button
        onClick={() => navigate(`/rdv/a/${appt.id}/note`)}
        className="w-full rounded bg-blue-700 p-2 font-medium text-white"
      >
        {note ? "Modifier la note" : "Écrire la note"}
      </button>
    </section>
  );
}

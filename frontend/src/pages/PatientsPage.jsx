import { useState } from "react";
import { db } from "../db/db";
import { useLive } from "../hooks/useLive";
import { searchPatients } from "../db/patientSearch";
import { navigate } from "../lib/router";
import { ageOf } from "../lib/format";

const EMPTY = { total: 0, items: [] };

export default function PatientsPage() {
  const [q, setQ] = useState("");
  const res = useLive(() => searchPatients(q), EMPTY, [q]);
  // état de synchro par patient : 'pending' | 'failed'
  const marks = useLive(async () => {
    const m = {};
    for (const o of await db.outbox.toArray()) {
      if (o.entity === "patients" && m[o.record_id] !== "failed")
        m[o.record_id] = o.status === "failed" ? "failed" : "pending";
    }
    return m;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un patient..."
          className="min-w-0 flex-1 rounded border p-2"
        />
        <button
          onClick={() => navigate("/patients/new")}
          className="rounded bg-blue-700 px-3 text-sm font-medium text-white"
        >
          + Nouveau
        </button>
      </div>

      <p className="text-xs text-slate-500">
        {res.total} patient(s){q && " trouvé(s)"}
      </p>

      {res.total === 0 && (
        <p className="rounded bg-white p-4 text-center text-sm text-slate-500">
          {q
            ? `Aucun résultat pour « ${q} ».`
            : "Aucun patient. Synchronisez ou créez-en un."}
        </p>
      )}

      <ul className="space-y-2">
        {res.items.map((p) => {
          const age = ageOf(p.birth_year);
          const mark = marks[p.id];
          return (
            <li key={p.id}>
              <button
                onClick={() => navigate(`/patients/${p.id}`)}
                className="w-full rounded border bg-white p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    <span className="uppercase">{p.last_name}</span>{" "}
                    {p.first_name}
                  </span>
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
                <div className="text-sm text-slate-600">
                  {p.sex === "F" ? "Femme" : "Homme"}
                  {age !== null && ` · ${age} ans`}
                  {p.village && ` · ${p.village}`}
                  {p.phone && ` · ${p.phone}`}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {res.total > res.items.length && (
        <p className="text-center text-xs text-slate-500">
          {res.items.length} premiers résultats affichés. Affinez la recherche.
        </p>
      )}
    </div>
  );
}

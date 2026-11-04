import { useState } from "react";
import { db } from "../db/db";
import { saveLocal } from "../db/saveLocal";
import { uuid } from "../lib/uuid";
import { useLive } from "../hooks/useLive";
import { findDuplicates } from "../db/patientSearch";
import { navigate } from "../lib/router";

function validate(f) {
  const e = {};
  if (!f.last_name.trim()) e.last_name = "Le nom est obligatoire.";
  if (!["M", "F"].includes(f.sex)) e.sex = "Choisissez le sexe.";
  if (f.birth_year !== "") {
    const y = Number(f.birth_year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100)
      e.birth_year = "Année entre 1900 et 2100.";
  }
  return e;
}

const clean = (f) => ({
  last_name: f.last_name.trim(),
  first_name: f.first_name.trim(),
  sex: f.sex,
  birth_year: f.birth_year === "" ? null : Number(f.birth_year),
  phone: f.phone.trim() || null,
  village: f.village.trim() || null,
});

function Field({ label, error, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

function PatientForm({ patient }) {
  const isNew = !patient;
  const [f, setF] = useState({
    last_name: patient?.last_name ?? "",
    first_name: patient?.first_name ?? "",
    sex: patient?.sex ?? "",
    birth_year: patient?.birth_year ?? "",
    phone: patient?.phone ?? "",
    village: patient?.village ?? "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const dups = useLive(
    () =>
      findDuplicates({
        last_name: f.last_name,
        first_name: f.first_name,
        excludeId: patient?.id,
      }),
    [],
    [f.last_name, f.first_name],
  );

  async function submit(e) {
    e.preventDefault();
    const errs = validate(f);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const data = clean(f);
      if (isNew) {
        await saveLocal({
          entity: "patients",
          mode: "create",
          id: uuid(),
          changes: data,
        });
      } else {
        const changes = {};
        for (const k of Object.keys(data))
          if ((patient[k] ?? null) !== data[k]) changes[k] = data[k];
        if (Object.keys(changes).length) {
          await saveLocal({
            entity: "patients",
            mode: "update",
            id: patient.id,
            changes,
          });
        }
      }
      navigate("/patients");
    } catch (err) {
      setErrors({ form: err.message || "Échec de l'enregistrement." });
      setSaving(false);
    }
  }

  const input = "w-full rounded border p-2";
  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold">
        {isNew ? "Nouveau patient" : "Modifier le patient"}
      </h1>

      <Field label="Nom *" error={errors.last_name}>
        <input
          className={input}
          value={f.last_name}
          onChange={set("last_name")}
          autoCapitalize="words"
        />
      </Field>
      <Field label="Prénom">
        <input
          className={input}
          value={f.first_name}
          onChange={set("first_name")}
          autoCapitalize="words"
        />
      </Field>

      {dups.length > 0 && (
        <div className="rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          <p className="font-medium">Un patient du même nom existe déjà :</p>
          <ul className="list-disc pl-5">
            {dups.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="underline"
                  onClick={() => navigate(`/patients/${d.id}`)}
                >
                  {d.last_name} {d.first_name}
                </button>
                {" · "}
                {d.birth_year ?? "année inconnue"}
                {d.village ? ` · ${d.village}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-600">
            Vérifiez qu'il ne s'agit pas de la même personne.
          </p>
        </div>
      )}

      <Field label="Sexe *" error={errors.sex}>
        <select className={input} value={f.sex} onChange={set("sex")}>
          <option value="">Choisir...</option>
          <option value="F">Femme</option>
          <option value="M">Homme</option>
        </select>
      </Field>
      <Field label="Année de naissance" error={errors.birth_year}>
        <input
          className={input}
          inputMode="numeric"
          value={f.birth_year}
          onChange={set("birth_year")}
          placeholder="ex. 1988"
        />
      </Field>
      <Field label="Téléphone">
        <input
          className={input}
          inputMode="tel"
          value={f.phone}
          onChange={set("phone")}
        />
      </Field>
      <Field label="Village / quartier">
        <input className={input} value={f.village} onChange={set("village")} />
      </Field>

      {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate("/patients")}
          className="flex-1 rounded border p-3"
        >
          Annuler
        </button>
        <button
          disabled={saving}
          className="flex-1 rounded bg-blue-700 p-3 font-medium text-white disabled:opacity-50"
        >
          {isNew && dups.length > 0 ? "Créer quand même" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

export default function PatientFormPage({ id }) {
  const isNew = id === "new";
  // null = chargement, false = introuvable
  const patient = useLive(
    async () => (isNew ? null : ((await db.patients.get(id)) ?? false)),
    null,
    [id],
  );

  if (isNew) return <PatientForm patient={null} />;
  if (patient === null)
    return <p className="text-sm text-slate-500">Chargement...</p>;
  if (patient === false) {
    return (
      <div className="space-y-2">
        <p>Patient introuvable.</p>
        <button className="underline" onClick={() => navigate("/patients")}>
          Retour à la liste
        </button>
      </div>
    );
  }
  return <PatientForm patient={patient} />;
}

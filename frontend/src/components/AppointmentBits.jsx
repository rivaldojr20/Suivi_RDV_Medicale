import { STATUS } from "../lib/planning";
import { setAppointmentStatus } from "../db/appointmentQueries";

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? {
    label: status,
    cls: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function StatusButtons({ appt }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(STATUS).map(([key, s]) => (
        <button
          key={key}
          disabled={appt.status === key}
          onClick={() => setAppointmentStatus(appt.id, key)}
          className={`rounded px-3 py-2 text-sm ${
            appt.status === key
              ? `${s.cls} font-bold ring-2 ring-slate-400`
              : "border bg-white"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

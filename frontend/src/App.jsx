import { useSession } from "./hooks/useSession";
import { useRoute } from "./lib/router";
import { DAY_RE } from "./lib/planning";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import PatientsPage from "./pages/PatientsPage";
import PatientFormPage from "./pages/PatientFormPage";
import PlanningPage from "./pages/PlanningPage";
import AppointmentPage from "./pages/AppointmentPage";
import NotePage from "./pages/NotePage";

export default function App() {
  const { status } = useSession();
  const path = useRoute();

  if (status !== "active") return <LoginPage />;

  const [, a, b, c, d, e] = path.split("/");
  let page = <p>Page introuvable.</p>;

  if (!a) page = <HomePage />;
  else if (a === "patients" && !b) page = <PatientsPage />;
  else if (a === "patients") page = <PatientFormPage key={b} id={b} />;
  else if (a === "rdv") {
    if (!b) page = <PlanningPage />;
    else if (DAY_RE.test(b)) page = <PlanningPage day={b} />;
    else if (b === "new") {
      const time =
        d && /^\d{4}$/.test(d) ? `${d.slice(0, 2)}:${d.slice(2)}` : undefined;
      page = (
        <AppointmentPage
          key={`new-${c}-${d}-${e}`}
          day={c}
          time={time}
          practitionerId={e}
        />
      );
    } else if (b === "a" && c && d === "note")
      page = <NotePage key={c} appointmentId={c} />;
    else if (b === "a" && c) page = <AppointmentPage key={c} id={c} />;
  }

  return <Layout path={path}>{page}</Layout>;
}

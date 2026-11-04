import { useSession } from "./hooks/useSession";
import { useRoute } from "./lib/router";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import PatientsPage from "./pages/PatientsPage";
import PatientFormPage from "./pages/PatientFormPage";

export default function App() {
  const { status } = useSession();
  const path = useRoute();

  if (status !== "active") return <LoginPage />;

  const [, a, b] = path.split("/");
  let page;
  if (!a) page = <HomePage />;
  else if (a === "patients" && !b) page = <PatientsPage />;
  else if (a === "patients") page = <PatientFormPage key={b} id={b} />;
  else page = <p>Page introuvable.</p>;

  return <Layout path={path}>{page}</Layout>;
}

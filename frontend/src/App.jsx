import { useAppContext } from "./context/AppContext";
import ProjectList from "./components/ProjectList";
import CreateProject from "./components/CreateProject";
import Setup from "./components/Setup";
import Config from "./components/Config";
import Annotation from "./components/Annotation";

export default function App() {
    const { step, setStep, view, setView, setSelectedProject, selectedProject } = useAppContext();

    if (step === 3) return <Annotation />;
    if (view === "create") return <CreateProject onBack={() => setView("list")} onCreated={(p) => { setSelectedProject(p); setView("setup"); }} />;
    if (view === "setup") return <Setup project={selectedProject} onBack={() => setView("list")} />;

    return <ProjectList
        onSelectProject={(p) => { setSelectedProject(p); setView("setup"); }}
        onCreateProject={() => setView("create")}
    />;
}


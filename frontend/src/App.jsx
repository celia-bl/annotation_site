import { useAppContext } from "./context/AppContext";
import ProjectList from "./components/ProjectList";
import CreateProject from "./components/CreateProject";
import Setup from "./components/Setup";
import Config from "./components/Config";
import Annotation from "./components/Annotation";

export default function App() {
    const { step, setStep } = useAppContext();

    return (
        <>
            {step === 1 && <Setup />}
            {step === 2 && <Config />}
            {step === 3 && <Annotation />}
        </>
    );
}
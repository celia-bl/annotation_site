import { useState, useEffect } from "react";
import { useAppContext } from "../context/AppContext";

const API = "http://localhost:8000";

export default function Setup({ project, onBack }) {
    if (!project) return <div>Chargement...</div>;
    const { setAnnotator, setImages, setLabelsMap, setCsvPath, setStep, setProjectName } = useAppContext();

    const [annotators, setAnnotators] = useState([]);
    const [selectedAnnotator, setSelectedAnnotator] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [newAnnotator, setNewAnnotator] = useState("");

    useEffect(() => {
        // Charger le projet côté backend
        fetch(`${API}/load-project?name=${encodeURIComponent(project.name)}`, { method: "POST" })
            .then(r => r.json())
            .then(async (data) => {
                if (data.error) return alert(data.error);
                setProjectName(project.name);

                // Charger images
                const imgs = await fetch(`${API}/images`).then(r => r.json());
                setImages(imgs);

                // Charger labels
                if (project.labels_path) {
                    const map = await fetch(`${API}/load-labels-json?path=${encodeURIComponent(project.labels_path)}`).then(r => r.json());
                    setLabelsMap(map);
                    setCsvPath(project.labels_path);
                }
            });

        // Charger annotateurs
        fetch(`${API}/annotators?project_name=${encodeURIComponent(project.name)}`)
            .then(r => r.json())
            .then(setAnnotators);
    }, [project]);

    const createAnnotator = async () => {
        if (!newAnnotator.trim()) return;
        const res = await fetch(`${API}/annotators`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project: project.name, annotator_id: newAnnotator }),
        });
        const data = await res.json();
        if (data.status === "created" || data.status === "exists") {
            const updated = await fetch(`${API}/annotators?project_name=${project.name}`).then(r => r.json());
            setAnnotators(updated);
            setSelectedAnnotator(newAnnotator);
            setNewAnnotator("");
            setIsCreating(false);
        }
    };

    const start = () => {
        setAnnotator(selectedAnnotator);
        setStep(2);
    };

    return (
        <div style={s.container}>
            <button style={s.backBtn} onClick={onBack}>← Retour</button>

            <h2 style={s.title}>📂 {project.name}</h2>

            <div style={s.meta}>
                {project.sites?.length > 0 && (
                    <div>Sites : {project.sites.map(s => s.name).join(", ")}</div>
                )}
                {project.root_folder && (
                    <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                        {project.root_folder}
                    </div>
                )}
            </div>

            <div style={s.field}>
                <label style={s.label}>Qui êtes-vous ?</label>
                <select
                    style={s.select}
                    value={selectedAnnotator}
                    onChange={e => {
                        if (e.target.value === "__create__") setIsCreating(true);
                        else setSelectedAnnotator(e.target.value);
                    }}
                >
                    <option value="">— Sélectionner un annotateur —</option>
                    <option value="__create__">➕ Créer un annotateur</option>
                    {annotators.map(a => (
                        <option key={a} value={a}>{a}</option>
                    ))}
                </select>
            </div>

            {isCreating && (
                <div style={s.createRow}>
                    <input
                        style={s.input}
                        placeholder="Identifiant (ex: alice)"
                        value={newAnnotator}
                        onChange={e => setNewAnnotator(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && createAnnotator()}
                    />
                    <button style={s.confirmBtn} onClick={createAnnotator}>OK</button>
                    <button style={s.cancelBtn} onClick={() => setIsCreating(false)}>Annuler</button>
                </div>
            )}

            <button
                style={{ ...s.startBtn, opacity: selectedAnnotator ? 1 : 0.4 }}
                disabled={!selectedAnnotator}
                onClick={start}
            >
                🚀 Démarrer l'annotation
            </button>
        </div>
    );
}

const s = {
    container: { maxWidth: 480, margin: "60px auto", padding: "0 24px" },
    backBtn: {
        background: "none", border: "none", cursor: "pointer",
        color: "#2563eb", fontSize: 14, marginBottom: 24, padding: 0,
    },
    title: { fontSize: 24, fontWeight: 800, marginBottom: 8 },
    meta: { color: "#555", fontSize: 14, marginBottom: 28 },
    field: { marginBottom: 20 },
    label: { display: "block", fontWeight: 600, marginBottom: 8, fontSize: 14 },
    select: {
        width: "100%", padding: "10px 12px", borderRadius: 8,
        border: "1px solid #d1d5db", fontSize: 14,
    },
    input: {
        flex: 1, padding: "8px 12px", borderRadius: 8,
        border: "1px solid #d1d5db", fontSize: 14,
    },
    createRow: { display: "flex", gap: 8, marginBottom: 20, alignItems: "center" },
    confirmBtn: {
        padding: "8px 14px", background: "#2563eb", color: "#fff",
        border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
    },
    cancelBtn: {
        padding: "8px 14px", background: "#fff", color: "#888",
        border: "1px solid #ddd", borderRadius: 8, cursor: "pointer",
    },
    startBtn: {
        width: "100%", padding: "14px", background: "#2563eb", color: "#fff",
        border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: "pointer",
    },
};

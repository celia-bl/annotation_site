import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function ProjectList({ onSelectProject, onCreateProject }) {
    const [projects, setProjects] = useState([]);

    useEffect(() => {
        fetch(`${API}/projects`)
            .then(r => r.json())
            .then(data => setProjects(data || []));
    }, []);

    const deleteProject = async (name) => {
        if (!window.confirm(`Supprimer "${name}" ?`)) return;
        await fetch(`${API}/projects?name=${encodeURIComponent(name)}`, { method: "DELETE" });
        setProjects(prev => prev.filter(p => p.name !== name));
    };

    return (
        <div style={s.container}>
            <div style={s.header}>
                <h1 style={s.title}>🐠 Mes projets</h1>
                <button style={s.newBtn} onClick={onCreateProject}>
                    + Nouveau projet
                </button>
            </div>

            {projects.length === 0 && (
                <div style={s.empty}>
                    Aucun projet pour l'instant.<br />
                    <span style={{ color: "#2563eb", cursor: "pointer" }} onClick={onCreateProject}>
                        Créer votre premier projet →
                    </span>
                </div>
            )}

            <div style={s.grid}>
                {projects.map(p => (
                    <div key={p.name} style={s.card}>
                        <div style={s.cardTop} onClick={() => onSelectProject(p)}>
                            <div style={s.cardIcon}>📂</div>
                            <div>
                                <div style={s.cardName}>{p.name}</div>
                                <div style={s.cardMeta}>
                                    {p.sites?.length > 0
                                        ? `${p.sites.length} site(s)`
                                        : "Pas de sites définis"}
                                    {p.created_at && ` · ${new Date(p.created_at).toLocaleDateString()}`}
                                </div>
                            </div>
                        </div>
                        <div style={s.cardFooter}>
                            <button style={s.startBtn} onClick={() => onSelectProject(p)}>
                                🚀 Ouvrir
                            </button>
                            <button style={s.deleteBtn} onClick={() => deleteProject(p.name)}>
                                🗑 Supprimer
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const s = {
    container: {
        maxWidth: 800,
        margin: "0 auto",
        padding: "40px 24px",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 32,
    },
    title: {
        fontSize: 28,
        fontWeight: 800,
        margin: 0,
    },
    newBtn: {
        padding: "10px 20px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 700,
        cursor: "pointer",
    },
    empty: {
        textAlign: "center",
        color: "#888",
        fontSize: 16,
        marginTop: 80,
        lineHeight: 2,
    },
    grid: {
        display: "flex",
        flexDirection: "column",
        gap: 14,
    },
    card: {
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    },
    cardTop: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 20px",
        cursor: "pointer",
    },
    cardIcon: { fontSize: 32 },
    cardName: { fontSize: 17, fontWeight: 700 },
    cardMeta: { fontSize: 13, color: "#888", marginTop: 2 },
    cardFooter: {
        display: "flex",
        gap: 8,
        padding: "10px 20px",
        borderTop: "1px solid #f0f0f0",
        background: "#fafafa",
    },
    startBtn: {
        padding: "6px 14px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
    },
    deleteBtn: {
        padding: "6px 14px",
        background: "#fff",
        color: "#ef4444",
        border: "1px solid #fca5a5",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 13,
    },
};

import { useState, useEffect, useRef } from "react";

const API = "http://localhost:8000";

// ── Folder Browser Modal ──────────────────────────────────────────────────────
function FolderBrowser({ onSelect, onClose }) {
    const [path, setPath] = useState("/");
    const [dirs, setDirs] = useState([]);
    const [error, setError] = useState("");

    const browse = async (p) => {
        const res = await fetch(`${API}/browse?path=${encodeURIComponent(p)}`);
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        setPath(data.path);
        setDirs(data.dirs);
        setError("");
    };

    useEffect(() => { browse(path); }, []);

    const goUp = () => {
        const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
        parts.pop();
        browse("/" + parts.join("/") || "/");
    };

    return (
        <div style={s.overlay}>
            <div style={s.modal}>
                <div style={s.modalHeader}>
                    <span>📁 Choisir un dossier</span>
                    <button onClick={onClose} style={s.closeBtn}>✕</button>
                </div>
                <div style={s.currentPath}>{path}</div>
                {error && <div style={{ padding: "8px 18px", color: "red", fontSize: 13 }}>{error}</div>}
                <div style={s.browserList}>
                    <div
                        style={{ ...s.browserItem, color: "#888" }}
                        onClick={goUp}
                    >
                        ← Dossier parent
                    </div>
                    {dirs.map(d => (
                        <div
                            key={d}
                            style={s.browserItem}
                            onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}
                            onClick={() => browse(path.replace(/\/$/, "") + "/" + d)}
                        >
                            📁 {d}
                        </div>
                    ))}
                </div>
                <div style={s.modalFooter}>
                    <span style={{ fontSize: 12, color: "#888" }}>Cliquer pour naviguer</span>
                    <button
                        style={s.confirmBtn}
                        onClick={() => { onSelect(path); onClose(); }}
                    >
                        ✓ Sélectionner ce dossier
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── File Browser Modal (pour labels JSON) ────────────────────────────────────
function FileBrowser({ onSelect, onClose }) {
    const [path, setPath] = useState("/");
    const [dirs, setDirs] = useState([]);
    const [files, setFiles] = useState([]);

    const browse = async (p) => {
        const res = await fetch(`${API}/browse-files?path=${encodeURIComponent(p)}`);
        const data = await res.json();
        if (data.error) return;
        setPath(data.path);
        setDirs(data.dirs);
        setFiles(data.files);
    };

    useEffect(() => { browse(path); }, []);

    const goUp = () => {
        const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
        parts.pop();
        browse("/" + parts.join("/") || "/");
    };

    return (
        <div style={s.overlay}>
            <div style={s.modal}>
                <div style={s.modalHeader}>
                    <span>📄 Choisir le fichier labels</span>
                    <button onClick={onClose} style={s.closeBtn}>✕</button>
                </div>
                <div style={s.currentPath}>{path}</div>
                <div style={s.browserList}>
                    <div style={{ ...s.browserItem, color: "#888" }} onClick={goUp}>
                        ← Dossier parent
                    </div>
                    {dirs.map(d => (
                        <div key={d} style={s.browserItem}
                            onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}
                            onClick={() => browse(path.replace(/\/$/, "") + "/" + d)}
                        >
                            📁 {d}
                        </div>
                    ))}
                    {files.map(f => (
                        <div key={f} style={{ ...s.browserItem, color: "#2563eb", fontWeight: 600 }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}
                            onClick={() => { onSelect(path.replace(/\/$/, "") + "/" + f); onClose(); }}
                        >
                            📄 {f}
                        </div>
                    ))}
                    {files.length === 0 && dirs.length === 0 && (
                        <div style={{ padding: "12px 18px", color: "#aaa", fontSize: 13 }}>
                            Aucun fichier JSON trouvé
                        </div>
                    )}
                </div>
                <div style={s.modalFooter}>
                    <span style={{ fontSize: 12, color: "#888" }}>Sélectionner un fichier .json</span>
                    <button onClick={onClose} style={{ ...s.confirmBtn, background: "#888" }}>
                        Annuler
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Site Editor ───────────────────────────────────────────────────────────────
function SiteEditor({ site, availableFolders, onChange, onRemove }) {
    const [showDropdown, setShowDropdown] = useState(false);
    const dropRef = useRef();

    useEffect(() => {
        const handler = (e) => {
            if (dropRef.current && !dropRef.current.contains(e.target))
                setShowDropdown(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const addFolder = (folder) => {
        if (!site.folders.includes(folder))
            onChange({ ...site, folders: [...site.folders, folder] });
        setShowDropdown(false);
    };

    const removeFolder = (folder) => {
        onChange({ ...site, folders: site.folders.filter(f => f !== folder) });
    };

    const remaining = availableFolders.filter(f => !site.folders.includes(f));

    return (
        <div style={s.siteCard}>
            <div style={s.siteHeader}>
                <input
                    style={s.siteNameInput}
                    value={site.name}
                    onChange={e => onChange({ ...site, name: e.target.value })}
                    placeholder="Nom du site"
                />
                <button onClick={onRemove} style={s.removeSiteBtn}>✕ Supprimer</button>
            </div>

            <div style={s.folderTags}>
                {site.folders.map(f => (
                    <span key={f} style={s.folderTag}>
                        📁 {f.split("/").pop()}
                        <button style={s.tagRemoveBtn} onClick={() => removeFolder(f)}>✕</button>
                    </span>
                ))}

                {remaining.length > 0 && (
                    <div style={{ position: "relative" }} ref={dropRef}>
                        <button
                            style={s.addFolderTag}
                            onClick={() => setShowDropdown(!showDropdown)}
                        >
                            + Ajouter un dossier
                        </button>
                        {showDropdown && (
                            <div style={s.dropdown}>
                                {remaining.map(f => (
                                    <div
                                        key={f}
                                        style={s.dropdownItem}
                                        onMouseEnter={e => e.currentTarget.style.background = "#f0f4ff"}
                                        onMouseLeave={e => e.currentTarget.style.background = ""}
                                        onClick={() => addFolder(f)}
                                    >
                                        📁 {f.split("/").pop()}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CreateProject({ onCreated, onBack }) {
    const [name, setName] = useState("");
    const [rootFolder, setRootFolder] = useState("");
    const [availableFolders, setAvailableFolders] = useState([]);
    const [sites, setSites] = useState([]);
    const [labelsPath, setLabelsPath] = useState("");
    const [showRootBrowser, setShowRootBrowser] = useState(false);
    const [showFileBrowser, setShowFileBrowser] = useState(false);
    const [loadingFolders, setLoadingFolders] = useState(false);
    const [preview, setPreview] = useState(null); // { count, transects }
    const [error, setError] = useState("");
    const [fallbackMode, setFallbackMode] = useState(false);

const selectRootFolder = async (path) => {
    setRootFolder(path);
    setLoadingFolders(true);
    setSites([]);
    setPreview(null);
    const res = await fetch(`${API}/browse?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (data.error) { setError(data.error); setLoadingFolders(false); return; }

    // Cherche les dossiers avec T*
    const foldersWithT = [];
    const allSubFolders = [];
    for (const dir of data.dirs) {
        const fullPath = path.replace(/\/$/, "") + "/" + dir;
        allSubFolders.push(fullPath);
        const sub = await fetch(`${API}/browse?path=${encodeURIComponent(fullPath)}`);
        const subData = await sub.json();
        const hasT = subData.dirs?.some(d => d.toUpperCase().startsWith("T"));
        if (hasT) foldersWithT.push(fullPath);
    }

    // Si des T* trouvés → mode normal, sinon → fallback tous les sous-dossiers
// Si des T* trouvés → mode normal, sinon → fallback tous les sous-dossiers + root lui-même
const folders = foldersWithT.length > 0 ? foldersWithT : [path];
    setAvailableFolders(folders);
    setFallbackMode(foldersWithT.length === 0); // pour le hint
    setLoadingFolders(false);
    setError("");
};


    const addSite = () => {
        setSites([...sites, { id: Date.now(), name: `Site ${sites.length + 1}`, folders: [] }]);
    };

    const updateSite = (id, updated) => {
        setSites(sites.map(s => s.id === id ? updated : s));
    };

    const removeSite = (id) => {
        setSites(sites.filter(s => s.id !== id));
    };

    // Calculer preview quand sites changent
    useEffect(() => {
        if (!rootFolder) return;
        const allFolders = sites.length === 0
            ? availableFolders
            : sites.flatMap(s => s.folders);
        if (allFolders.length === 0) { setPreview(null); return; }

        let cancelled = false;
        (async () => {
            let total = 0;
            const transectSet = new Set();
            for (const folder of allFolders) {
                const res = await fetch(`${API}/scan-transects?folder=${encodeURIComponent(folder)}`);
                const data = await res.json();
                if (cancelled) return;
                total += data.count || 0;
                data.images?.forEach(img => transectSet.add(img.transect));
            }
            setPreview({ count: total, transects: [...transectSet].sort() });
        })();
        return () => { cancelled = true; };
    }, [sites, availableFolders, rootFolder]);

    const handleCreate = async () => {
        if (!name.trim()) { setError("Nom du projet requis"); return; }
        if (!rootFolder) { setError("Dossier racine requis"); return; }

        const body = {
            name: name.trim(),
            root_folder: rootFolder,
            sites: sites.length > 0
                ? sites.map(s => ({ name: s.name, folders: s.folders }))
                : [{ name: "Défaut", folders: availableFolders }],
            labels_path: labelsPath,
        };

        const res = await fetch(`${API}/projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        console.log('res', res)
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        onCreated(data.project);
    };

    return (
        <div style={s.container}>
            <h2 style={s.title}>Nouveau projet</h2>

            {/* Nom */}
            <div style={s.field}>
                <label style={s.label}>Nom du projet</label>
                <input
                    style={s.input}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Ex: Campagne 2024"
                />
            </div>

            {/* Dossier racine */}
            <div style={s.field}>
                <label style={s.label}>Dossier racine des images</label>
                <div style={s.pathRow}>
                    <input
                        style={{ ...s.input, flex: 1, marginBottom: 0 }}
                        value={rootFolder}
                        onChange={e => e.target.value && selectRootFolder(e.target.value)}
                        placeholder="/data/2024/"
                        readOnly
                    />
                    <button style={s.browseBtn} onClick={() => setShowRootBrowser(true)}>
                        📁 Browse
                    </button>
                </div>

                {loadingFolders && (
                    <div style={s.hint}>🔍 Scan des sous-dossiers...</div>
                )}
                {!loadingFolders && availableFolders.length > 0 && (
    <div style={s.hint}>
        {fallbackMode
            ? `⚠️ Aucun transect T* détecté — ${availableFolders.length} sous-dossier(s) chargés (mode fallback)`
            : `✓ ${availableFolders.length} dossier(s) avec transects T* détectés`
        }
    </div>
)}

            </div>

            {/* Sites */}
            {availableFolders.length > 0 && (
                <div style={s.field}>
                    <label style={s.label}>
                        Sites
                        <span style={s.labelHint}> — optionnel, sans site tout est groupé ensemble</span>
                    </label>

                    {sites.map(site => (
                        <SiteEditor
                            key={site.id}
                            site={site}
                            availableFolders={availableFolders}
                            onChange={updated => updateSite(site.id, updated)}
                            onRemove={() => removeSite(site.id)}
                        />
                    ))}

                    <button style={s.addSiteBtn} onClick={addSite}>
                        + Créer un site
                    </button>
                </div>
            )}

            {/* Preview */}
            {preview && (
                <div style={s.preview}>
                    <div style={s.previewTitle}>📊 Aperçu</div>
                    <div><strong>{preview.count}</strong> images trouvées</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "#555" }}>
                        Transects : {preview.transects.join(", ")}
                    </div>
                </div>
            )}

            {/* Labels */}
            <div style={s.field}>
                <label style={s.label}>Fichier de labels (.json)</label>
                <div style={s.pathRow}>
                    <input
                        style={{ ...s.input, flex: 1, marginBottom: 0 }}
                        value={labelsPath}
                        onChange={e => setLabelsPath(e.target.value)}
                        placeholder="/data/labels.json"
                        readOnly
                    />
                    <button style={s.browseBtn} onClick={() => setShowFileBrowser(true)}>
                        📄 Browse
                    </button>
                </div>
            </div>

            {error && <div style={s.error}>{error}</div>}

            <button style={s.createBtn} onClick={handleCreate}>
                ✓ Créer le projet
            </button>

            {showRootBrowser && (
                <FolderBrowser
                    onSelect={selectRootFolder}
                    onClose={() => setShowRootBrowser(false)}
                />
            )}
            {showFileBrowser && (
                <FileBrowser
                    onSelect={setLabelsPath}
                    onClose={() => setShowFileBrowser(false)}
                />
            )}
        </div>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
    container: {
        maxWidth: 620,
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "system-ui, sans-serif",
    },
    title: {
        fontSize: 24,
        fontWeight: 700,
        marginBottom: 28,
        color: "#1e293b",
    },
    field: {
        marginBottom: 22,
    },
    label: {
        display: "block",
        fontWeight: 600,
        fontSize: 14,
        marginBottom: 6,
        color: "#374151",
    },
    labelHint: {
        fontWeight: 400,
        color: "#9ca3af",
        fontSize: 13,
    },
    input: {
        width: "100%",
        padding: "9px 12px",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        fontSize: 14,
        boxSizing: "border-box",
        marginBottom: 0,
    },
    pathRow: {
        display: "flex",
        gap: 8,
        alignItems: "center",
    },
    browseBtn: {
        padding: "9px 14px",
        background: "#f1f5f9",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
    },
    hint: {
        marginTop: 6,
        fontSize: 12,
        color: "#6b7280",
    },
    // Site card
    siteCard: {
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 10,
        background: "#fafbff",
    },
    siteHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10,
    },
    siteNameInput: {
        fontSize: 15,
        fontWeight: 600,
        border: "none",
        borderBottom: "2px solid #e2e8f0",
        background: "transparent",
        padding: "2px 4px",
        outline: "none",
        width: 200,
    },
    removeSiteBtn: {
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "#ef4444",
        fontSize: 13,
        fontWeight: 600,
    },
    folderTags: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
    },
    folderTag: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "#e0e7ff",
        color: "#3730a3",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 13,
        fontWeight: 500,
    },
    tagRemoveBtn: {
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "#818cf8",
        fontSize: 13,
        padding: 0,
        lineHeight: 1,
    },
    addFolderTag: {
        padding: "4px 10px",
        background: "none",
        border: "1px dashed #93c5fd",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: "#3b82f6",
        fontWeight: 600,
    },
    dropdown: {
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 100,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        minWidth: 220,
        maxHeight: 220,
        overflowY: "auto",
        marginTop: 4,
    },
    dropdownItem: {
        padding: "9px 14px",
        cursor: "pointer",
        fontSize: 13,
        borderBottom: "1px solid #f4f4f4",
    },
    addSiteBtn: {
        padding: "9px 16px",
        background: "none",
        border: "1px dashed #3b82f6",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 14,
        color: "#3b82f6",
        fontWeight: 600,
        width: "100%",
        marginTop: 4,
    },
    // Preview
    preview: {
        background: "#f0fdf4",
        border: "1px solid #86efac",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 22,
        fontSize: 14,
        color: "#166534",
    },
    previewTitle: {
        fontWeight: 700,
        marginBottom: 6,
    },
    // Labels
    error: {
        color: "#dc2626",
        fontSize: 13,
        marginBottom: 12,
        background: "#fef2f2",
        padding: "8px 12px",
        borderRadius: 6,
    },
    createBtn: {
        width: "100%",
        padding: "12px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        fontSize: 16,
        fontWeight: 700,
        cursor: "pointer",
    },
    // Modals
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
    },
    modal: {
        background: "#fff",
        borderRadius: 12,
        width: 500,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        overflow: "hidden",
    },
    modalHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 18px",
        borderBottom: "1px solid #eee",
        fontWeight: 700,
        fontSize: 15,
    },
    closeBtn: {
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 18,
        color: "#888",
    },
    currentPath: {
        padding: "8px 18px",
        fontSize: 12,
        color: "#666",
        background: "#f8f8f8",
        borderBottom: "1px solid #eee",
        fontFamily: "monospace",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    browserList: {
        flex: 1,
        overflowY: "auto",
    },
    browserItem: {
        padding: "10px 18px",
        cursor: "pointer",
        fontSize: 14,
        borderBottom: "1px solid #f4f4f4",
        userSelect: "none",
    },
    modalFooter: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 18px",
        borderTop: "1px solid #eee",
        background: "#fafafa",
    },
    confirmBtn: {
        padding: "8px 16px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
    },
};

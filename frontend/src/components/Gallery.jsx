// Gallery.jsx
import { useAppContext } from "../context/AppContext";
import { useState, useEffect } from "react";

const API = "http://127.0.0.1:8000";
export default function Gallery({ setShowGallery }) {
    const {
        config,
        images,
        currentImageIdx,
        setCurrentImageIdx, setUserClickedImage,
        setStep
    } = useAppContext();

    const [thumbnails, setThumbnails] = useState({});
    const [annotationData, setAnnotationData] = useState({}); // 🆕 Charger depuis CSV
    const [filter, setFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);

    const nPointsRequired = config?.n_points ?? 10;

    // ✅ Charger les annotations depuis le CSV au montage
    useEffect(() => {
        const loadAnnotationsFromCSV = async () => {
            try {
                const res = await fetch(`${API}/get-annotations`);
                const data = await res.json();
                setAnnotationData(data || {});
                console.log("✅ Annotations chargées depuis CSV:", data);
            } catch (e) {
                console.error("❌ Erreur chargement annotations:", e);
            } finally {
                setLoading(false);
            }
        };

        loadAnnotationsFromCSV();
    }, []);

    // ✅ Charger les thumbnails au montage
    useEffect(() => {
        if (!images.length) return;

        const loadThumbnails = async () => {
            const thumbs = {};
            for (const imageName of images) {
                try {
                    const res = await fetch(`${API}/image/${encodeURIComponent(imageName)}`);
                    const blob = await res.blob();
                    thumbs[imageName] = URL.createObjectURL(blob);
                } catch (e) {
                    console.error(`Erreur thumbnail ${imageName}:`, e);
                }
            }
            setThumbnails(thumbs);
        };

        loadThumbnails();

        return () => {
            Object.values(thumbnails).forEach(url => URL.revokeObjectURL(url));
        };
    }, [images]);

    // ✅ Vérifier si une image est complète (en utilisant les données du CSV)
    // ✅ Vérifier si une image est complète

    const isImageComplete = (imageName) => {
    const imageAnnotations = annotationData[imageName];

    // Pas d'annotation du tout
    if (!imageAnnotations || imageAnnotations.length === 0) {
        return false;
    }

    // 🎯 Compter simplement le nombre de points annotés
    const labeledPoints = imageAnnotations.filter(
        ann => ann.label && ann.label.trim() !== ""
    );

    console.log(`📊 ${imageName}: ${labeledPoints.length}/${nPointsRequired} points annotés`);

    return labeledPoints.length >= nPointsRequired;
};


    // ✅ Filtrer les images
    const filteredImages = images.filter((imageName) => {
        const isComplete = isImageComplete(imageName);
        if (filter === "complete" && !isComplete) return false;
        if (filter === "incomplete" && isComplete) return false;

        if (searchQuery && !imageName.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false;
        }

        return true;
    });

    // ✅ Compter les images
    const stats = {
        total: images.length,
        complete: images.filter(img => isImageComplete(img)).length,
        incomplete: images.filter(img => !isImageComplete(img)).length,
    };

    const completePercentage = stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0;

    if (loading) {
        return (
            <div style={{ padding: "20px", textAlign: "center", color: "#9ca3af" }}>
                <p>⏳ Chargement des annotations...</p>
            </div>
        );
    }

    return (
        <div style={{ padding: "20px" }}>
            {/* ── HEADER ── */}
            <div style={{ marginBottom: "24px" }}>
                <h2 style={{ margin: "0 0 16px 0", color: "#1f2937" }}>📸 Gallery</h2>

                {/* ── STATS ── */}
                <div style={{
                    background: "#f3f4f6",
                    padding: "12px 16px",
                    borderRadius: 8,
                    marginBottom: "16px",
                    fontSize: 13,
                    color: "#374151"
                }}>
                    <div style={{ display: "flex", gap: "20px", marginBottom: "8px" }}>
                        <span><strong>{stats.complete}</strong> / {stats.total} complètes</span>
                        <span>📊 {completePercentage}%</span>
                    </div>
                    {/* Progress bar */}
                    <div style={{
                        background: "#e5e7eb",
                        height: 8,
                        borderRadius: 4,
                        overflow: "hidden"
                    }}>
                        <div style={{
                            background: "#10b981",
                            height: "100%",
                            width: `${completePercentage}%`,
                            transition: "width 0.3s"
                        }}></div>
                    </div>
                </div>

                {/* ── CONTROLS ── */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    {["all", "complete", "incomplete"].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                padding: "6px 12px",
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                background: filter === f ? "#3b82f6" : "#fff",
                                color: filter === f ? "#fff" : "#374151",
                                fontWeight: 600,
                                fontSize: 12,
                                cursor: "pointer",
                                transition: "all 0.2s",
                                textTransform: "capitalize"
                            }}
                        >
                            {f === "all" ? "🔵 Toutes" : f === "complete" ? "✅ Complètes" : "⏳ Incomplètes"}
                        </button>
                    ))}
                </div>

                {/* ── SEARCH ── */}
                <input
                    type="text"
                    placeholder="Rechercher une image..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        fontSize: 13,
                        boxSizing: "border-box"
                    }}
                />
            </div>

            {/* ── GRID ── */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: "12px"
            }}>
                {filteredImages.map((imageName, idx) => {
                    const isComplete = isImageComplete(imageName);
                    const isActive = imageName === images[currentImageIdx];

                    return (
                        <div
                            key={idx}
                            onClick={() => {
                            setUserClickedImage(true);
                            setCurrentImageIdx(images.indexOf(imageName));
                            setShowGallery(false);}}
                            style={{
                                cursor: "pointer",
                                borderRadius: 8,
                                overflow: "hidden",
                                border: isActive ? "3px solid #3b82f6" : "2px solid #e5e7eb",
                                background: "#fff",
                                transition: "all 0.2s",
                                boxShadow: isActive ? "0 0 0 2px rgba(59,130,246,0.1)" : "none"
                            }}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.borderColor = "#9ca3af";
                                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.borderColor = "#e5e7eb";
                                    e.currentTarget.style.boxShadow = "none";
                                }
                            }}
                        >
                            {/* Image */}
                            <div style={{
                                position: "relative",
                                paddingBottom: "100%",
                                background: "#f3f4f6"
                            }}>
                                {thumbnails[imageName] ? (
                                    <img
                                        src={thumbnails[imageName]}
                                        alt={imageName}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover"
                                        }}
                                    />
                                ) : (
                                    <div style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        height: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "#9ca3af"
                                    }}>
                                        ⏳
                                    </div>
                                )}
                            </div>

                            {/* Badge de statut */}
                            <div style={{
                                padding: "8px",
                                background: isComplete ? "#dcfce7" : "#fef3c7",
                                borderTop: "1px solid #e5e7eb"
                            }}>
                                <div style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: isComplete ? "#166534" : "#92400e",
                                    textAlign: "center"
                                }}>
                                    {isComplete ? "✅ Complète" : "⏳ Incomplète"}
                                </div>
                                <div style={{
                                    fontSize: 11,
                                    color: isComplete ? "#15803d" : "#b45309",
                                    textAlign: "center",
                                    marginTop: "4px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}>
                                    {imageName}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Message si aucune image */}
            {filteredImages.length === 0 && (
                <div style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#9ca3af"
                }}>
                    <p style={{ fontSize: 14 }}>Aucune image trouvée pour ce filtre</p>
                </div>
            )}
        </div>
    );
}

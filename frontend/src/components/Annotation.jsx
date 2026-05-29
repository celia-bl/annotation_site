// Annotation.jsx
import { useAppContext } from "../context/AppContext";
import ImageCanvas from "./ImageCanvas";
import ControlPanel from "./ControlPanel";
import Gallery from "./Gallery";
import { useState, useEffect } from "react";

const API = "http://127.0.0.1:8000";

export default function Annotation() {
    const {
        config, setConfig,
        images, currentImageIdx, setCurrentImageIdx,
        annotations
    } = useAppContext();

    const [showConfigPopup, setShowConfigPopup] = useState(false);
    const [showGallery, setShowGallery] = useState(false);
    const [hasJumped, setHasJumped] = useState(false);

    const PRESETS = {
        none: null,
        default: {
            sampling: "random",
            stop_criterion: "fixed_points",
            n_points: 10,
            in_sampling: "Point-based",
            ai_model: "ReefNet",
            frequency: 20,
            correction: "Uncertainty",
            cold_start: "none",
        },
    };

    function applyPreset(name) {
        const preset = PRESETS[name];
        if (preset) setConfig(preset);
    }

    async function handleUpdateConfig() {
        await fetch(
            `${API}/init-model` +
            `?model_name=${encodeURIComponent(config.ai_model ?? "ReefNet")}` +
            `&frequency=${config.frequency ?? 20}`,
            { method: "POST" }
        );

        if (
            config.in_sampling !== "Point-based" &&
            config.seg_model !== "none"
        ) {
            const batch = Math.max(10, config.frequency ?? 20);
            fetch(
                `${API}/precompute-segmentation?batch_size=${batch}&model=${config.seg_model}`,
                { method: "POST" }
            );
        }

        setShowConfigPopup(false);
    }

    // ✅ Jump to first incomplete image au chargement
    useEffect(() => {
        if (hasJumped || !images?.length) return;

        const nPoints = config?.n_points ?? 10;
        const firstIncompleteIdx = images.findIndex((imageName) => {
            const ann = annotations?.[imageName];

            if (!ann) return true;

            if (config.in_sampling === "Point-based" || config.in_sampling === "Seg+Point") {
                if (ann.points) {
                    const labeled = ann.points.filter(p => p.label || p.prediction).length;
                    if (labeled < nPoints) return true;
                } else {
                    return true;
                }
            }

            if (config.in_sampling === "Segmentation" || config.in_sampling === "Seg+Point") {
                if (ann.masks) {
                    const labeled = ann.masks.filter(m => m.label || m.prediction).length;
                    if (labeled < nPoints) return true;
                } else {
                    return true;
                }
            }

            return false;
        });

        if (firstIncompleteIdx !== -1) {
            console.log(`🎯 Jumping to image ${firstIncompleteIdx} (${images[firstIncompleteIdx]})`);
            setCurrentImageIdx(firstIncompleteIdx);
        } else {
            console.log("✅ All images fully annotated! Staying at image 0");
            setCurrentImageIdx(0);
        }

        setHasJumped(true);
    }, [images, annotations, config.in_sampling, config.n_points, hasJumped, setCurrentImageIdx]);

    return (
        <div style={{ padding: "20px" }}>
            {/* ── HEADER ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h1 style={{ margin: 0 }}>Annotation</h1>
                <div style={{ display: "flex", gap: "8px" }}>
                    {/* Gallery Button */}
                    <button
                        onClick={() => setShowGallery(!showGallery)}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 6,
                            border: "none",
                            background: showGallery ? "#3b82f6" : "#f3f4f6",
                            color: showGallery ? "#fff" : "#374151",
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: "pointer",
                            transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => {
                            if (!showGallery) {
                                e.target.style.background = "#e5e7eb";
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!showGallery) {
                                e.target.style.background = "#f3f4f6";
                            }
                        }}
                    >
                        📸 Gallery
                    </button>

                    {/* Settings Button */}
                    <button
                        onClick={() => setShowConfigPopup(true)}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 6,
                            border: "none",
                            background: "#f3f4f6",
                            color: "#374151",
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: "pointer",
                            transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => e.target.style.background = "#e5e7eb"}
                        onMouseLeave={(e) => e.target.style.background = "#f3f4f6"}
                    >
                        ⚙️ Settings
                    </button>
                </div>
            </div>

            {/* ── MAIN CONTENT ── */}
{showGallery ? (
    <Gallery setShowGallery={setShowGallery}/>
) : (
    <div style={{
        display: "flex",
        gap: "20px",
        width: "100%",
        alignItems: "flex-start"
    }}>
        <div style={{ flex: "0 0 65%", minWidth: 0 }}>
            <ImageCanvas />
        </div>
        <div style={{ flex: "0 0 calc(25%)", minWidth: 0 }}>
            <ControlPanel />
        </div>
    </div>
)}


            {/* ── CONFIG POPUP ── */}
            {showConfigPopup && (
                <div style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 9999
                }}>
                    <div style={{
                        background: "#fff",
                        padding: 24,
                        borderRadius: 8,
                        boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
                        maxHeight: "90vh",
                        overflowY: "auto",
                        width: "90%",
                        maxWidth: 500
                    }}>
                        {/* Header */}
                        <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 20
                        }}>
                            <h2 style={{ margin: 0, color: "#374151" }}>⚙️ Configuration</h2>
                            <button
                                onClick={() => setShowConfigPopup(false)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    fontSize: 20,
                                    cursor: "pointer",
                                    color: "#6b7280",
                                    padding: 0
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Preset */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                Preset
                            </label>
                            <select
                                onChange={(e) => applyPreset(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    fontFamily: "inherit"
                                }}
                            >
                                {Object.keys(PRESETS).map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>

                        {/* Experience */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                Experience
                            </label>
                            <select
                                value={config.experience || ""}
                                onChange={(e) => setConfig(prev => ({ ...prev, experience: e.target.value }))}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    fontFamily: "inherit"
                                }}
                            >
                                <option value="">Select...</option>
                                <option value="none">None</option>
                                <option value="exp1">Exp1</option>
                                <option value="exp2">Exp2</option>
                            </select>
                        </div>

                        {/* Sampling */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                Sampling Strategy
                            </label>
                            <select
                                value={config.in_sampling || ""}
                                onChange={(e) => setConfig(prev => ({ ...prev, in_sampling: e.target.value }))}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    fontFamily: "inherit"
                                }}
                            >
                                <option value="">Select...</option>
                                <option value="Point-based">Point-based</option>
                                <option value="Segmentation">Segmentation</option>
                                <option value="Seg+Point">Seg+Point</option>
                            </select>
                        </div>

                        {/* N Points */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                Number of Points
                            </label>
                            <input
                                type="number"
                                value={config.n_points ?? 10}
                                onChange={(e) => setConfig(prev => ({ ...prev, n_points: parseInt(e.target.value) }))}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    boxSizing: "border-box"
                                }}
                            />
                        </div>

                        {/* AI Model */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                AI Model
                            </label>
                            <select
                                value={config.ai_model || ""}
                                onChange={(e) => setConfig(prev => ({ ...prev, ai_model: e.target.value }))}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    fontFamily: "inherit"
                                }}
                            >
                                <option value="">Select...</option>
                                <option value="ReefNet">ReefNet</option>
                                <option value="ResNet50">ResNet50</option>
                            </select>
                        </div>

                        {/* Frequency */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: "block",
                                marginBottom: 4,
                                fontWeight: 600,
                                fontSize: 13,
                                color: "#374151"
                            }}>
                                Frequency
                            </label>
                            <input
                                type="number"
                                value={config.frequency ?? 20}
                                onChange={(e) => setConfig(prev => ({ ...prev, frequency: parseInt(e.target.value) }))}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    fontSize: 13,
                                    boxSizing: "border-box"
                                }}
                            />
                        </div>

                        {/* Buttons */}
                        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
                            <button
                                onClick={() => setShowConfigPopup(false)}
                                style={{
                                    flex: 1,
                                    padding: "10px",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    background: "#fff",
                                    color: "#374151",
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: "pointer",
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={(e) => e.target.style.background = "#f9fafb"}
                                onMouseLeave={(e) => e.target.style.background = "#fff"}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateConfig}
                                style={{
                                    flex: 1,
                                    padding: "10px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "#3b82f6",
                                    color: "#fff",
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: "pointer",
                                    transition: "all 0.2s"
                                }}
                                onMouseEnter={(e) => e.target.style.background = "#2563eb"}
                                onMouseLeave={(e) => e.target.style.background = "#3b82f6"}
                            >
                                💾 Save Config
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

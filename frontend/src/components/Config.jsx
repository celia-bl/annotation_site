import { useAppContext } from "../context/AppContext";
import { useState, useEffect } from "react";

const API = "http://127.0.0.1:8000";

export default function Config() {
    const {
        config, setConfig, setStep,
        images, currentImageIdx, setCurrentImageIdx,
        annotations
    } = useAppContext();

    const [isInitializing, setIsInitializing] = useState(false);

    const PRESETS = {
        none: null,
        default: {
            sampling:       "random",
            stop_criterion: "fixed_points",
            n_points:       10,
            in_sampling:    "Point-based",
            ai_model:       "ReefNet",
            frequency:      20,
            correction:     "Uncertainty",
            cold_start:     "none",
        },
    };

    function applyPreset(name) {
        const preset = PRESETS[name];
        if (preset) setConfig(preset);
    }

    async function handleStart() {
    setIsInitializing(true);
    try {
        await fetch(
            `${API}/init-model?model_name=${encodeURIComponent(config.ai_model ?? "ReefNet")}&frequency=${config.frequency ?? 20}`,
            { method: "POST" }
        );

        if (config.in_sampling !== "Point-based" && config.seg_model !== "none") {
            const batch = Math.max(10, config.frequency ?? 20);
            fetch(
                `${API}/precompute-segmentation?batch_size=${batch}&model=${config.seg_model}`,
                { method: "POST" }
            );
        }

        setStep(3); // ✅ Juste passer à Annotation
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        setIsInitializing(false);
    }
}


    return (
        <div>
            <h1>Configuration</h1>

            {/* ---------- PRESET ---------- */}
            <div>
                <label>Preset</label>
                <select onChange={(e) => applyPreset(e.target.value)}>
                    {Object.keys(PRESETS).map(p => <option key={p}>{p}</option>)}
                </select>
            </div>

            <br/>
            <div>
                <label>Experience</label>
                <select
                    value={config.experience || ""}
                    onChange={(e) => setConfig(prev => ({...prev, experience: e.target.value}))}
                >
                    <option value="None">None</option>
                    <option value="exp1">Exp1</option>
                    <option value="exp2">Exp2</option>
                </select>
            </div>

            <br/>
            {/* ---------- SAMPLING ---------- */}
            <div>
                <label>Sampling Strategy</label>
                <select
                    value={config.sampling || ""}
                    onChange={(e) => setConfig(prev => ({...prev, sampling: e.target.value}))}
                >
                    <option value="random">Random</option>
                    <option value="active learning">Active learning</option>
                </select>
            </div>

            {/* ---------- STOP CRITERION ---------- */}
            <div>
                <label>Stop Criterion</label>
                <select
                    value={config.stop_criterion || ""}
                    onChange={(e) => setConfig(prev => ({...prev, stop_criterion: e.target.value}))}
                >
                    <option value="none">None</option>
                    <option value="manual">Manual</option>
                    <option value="automatic">Automatic</option>
                </select>
            </div>

            {/* ---------- IN-IMAGE SAMPLING ---------- */}
            <div>
                <label>In-Image Sampling</label>
                <select
                    value={config.in_sampling || ""}
                    onChange={(e) => setConfig(prev => ({...prev, in_sampling: e.target.value}))}
                >
                    <option value="Point-based">Point-based</option>
                    <option value="Segmentation">Segmentation</option>
                    <option value="Seg+Point">Seg + Point (hybrid)</option>
                </select>
            </div>
            {/* ---------- SEGMENTATION MODEL ---------- */}
            {(config.in_sampling === "Segmentation" || config.in_sampling === "Seg+Point") && (
                <div>
                    <label>Segmentation Model</label>
                    <select
                        value={config.seg_model || "none"}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, seg_model: e.target.value}))
                        }
                    >
                        <option value="none">None</option>
                        <option value="sam">SAM</option>
                        <option value="sam3">SAM 3</option>
                        <option value="coralscop">CoralSCOP</option>
                    </select>
                </div>
            )}

            {/* ---------- N POINTS ---------- */}
            {(config.in_sampling === "Point-based" || config.in_sampling === "Seg+Point") && (
                <div>
                    <label>Number of points</label>
                    <input
                        type="number"
                        min={1}
                        value={config.n_points || 10}
                        onChange={(e) => setConfig(prev => ({...prev, n_points: Number(e.target.value)}))}
                    />
                </div>
            )}

            {/* ---------- AI MODEL ---------- */}
            <div>
                <label>AI Prediction Model</label>
                <select
                    value={config.ai_model || ""}
                    onChange={(e) => setConfig(prev => ({...prev, ai_model: e.target.value}))}
                >
                    <option value="ReefNet">ReefNet (BioCLIP fine-tuned)</option>
                    <option value="none">No model</option>
                </select>
            </div>

            {/* ---------- FREQUENCY ---------- */}
            <div>
                <label>Retraining frequency (images)</label>
                <input
                    type="number"
                    min={1}
                    value={config.frequency || 20}
                    onChange={(e) => setConfig(prev => ({...prev, frequency: Number(e.target.value)}))}
                />
            </div>

            {/* ---------- COLD START ---------- */}
            <div>
                <label>Before first training, show</label>
                <select
                    value={config.cold_start || "none"}
                    onChange={(e) => setConfig(prev => ({...prev, cold_start: e.target.value}))}
                >
                    <option value="none">Nothing (no prediction pill)</option>
                    <option value="random">Random label</option>
                </select>
            </div>

            <div>
                <label>Label Propagation Method</label>
                <select
                    value={config.label_propagation || "none"}
                    onChange={(e) => setConfig(prev => ({...prev, label_propagation: e.target.value}))}
                >
                    <option value="none">None</option>
                    <option value="mask">Mask</option>
                    <option value="cluster">Clustering</option>
                    <option value="hybrid">Hybrid</option>
                </select>
            </div>

            {/* ---------- CORRECTION ---------- */}
            <div>
                <label>Correction order</label>
                <select
                    value={config.correction || ""}
                    onChange={(e) => setConfig(prev => ({...prev, correction: e.target.value}))}
                >
                    <option value="Uncertainty">Uncertainty</option>
                    <option value="Random">Random</option>
                    <option value="Alphabetical">Alphabetical</option>
                    <option value="Hierarchical">Hierarchical</option>
                </select>
            </div>

            <br/>

            {/* ---------- START ---------- */}
            <button onClick={handleStart} disabled={isInitializing}>
                {isInitializing ? "⏳ Initializing..." : "🚀 Start Annotation"}
            </button>
        </div>
    );
}

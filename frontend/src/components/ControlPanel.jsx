import { useAppContext } from "../context/AppContext";
import { useEffect, useRef, useState } from "react";

export default function ControlPanel() {
    const {
        config,
        points,      setPoints,
        masks,       setMasks,
        selectedPoint, setSelectedPoint,
        labelsMap,   shortLabels,
        images,      currentImageIdx, setCurrentImageIdx,
        zoom,        setZoom,
        setOffset,
        annotations, setAnnotations,
        segModel, setSegModel,
        predModel, setPredModel,
        quickAccept, setQuickAccept,
        annotator,
        projectName,
        canvasWrapperRef,
    } = useAppContext();

    const isSegmentation = config?.in_sampling === "Segmentation";
    const items          = isSegmentation ? masks : points;
    const total          = items.length;
    const labeled = items.filter(it => it.label || it.prediction).length;

    const cpPointStartRef  = useRef(null);
    const cpPointOpenIdRef = useRef(null);
    const cpPointTimings   = useRef([]);

    const [showExp1Popup, setShowExp1Popup] = useState(false);
    const [showExp2Popup, setShowExp2Popup] = useState(false);

    // Reset CP timers on image change
    useEffect(() => {
        cpPointStartRef.current  = null;
        cpPointOpenIdRef.current = null;
        cpPointTimings.current   = [];
    }, [currentImageIdx]);

    function handleLabelChange(id, value) {
        if (cpPointStartRef.current !== null && cpPointOpenIdRef.current === id) {
            const ms  = Date.now() - cpPointStartRef.current;
            const pt  = points.find(p => p.id === id);
            cpPointTimings.current.push({
                point_id:    id,
                ms,
                accepted_ai: pt?.prediction === value,
                source:      "control_panel",
            });
            cpPointStartRef.current  = null;
            cpPointOpenIdRef.current = null;
        }

        if (isSegmentation) {
            setMasks(prev => prev.map(m => m.id === id ? { ...m, label: value } : m));
        } else {
            setPoints(prev => prev.map(p => p.id === id ? { ...p, label: value } : p));
        }
    }

    function handleSelectFocus(id) {
        cpPointStartRef.current  = Date.now();
        cpPointOpenIdRef.current = id;
    }

    // ── STOP TIMER FUNCTION ──
    function stopTimer() {
        if (cpPointStartRef.current !== null && cpPointOpenIdRef.current !== null) {
            const ms = Date.now() - cpPointStartRef.current;
            const pt = points.find(p => p.id === cpPointOpenIdRef.current);
            cpPointTimings.current.push({
                point_id:    cpPointOpenIdRef.current,
                ms,
                accepted_ai: pt?.prediction === pt?.label,
                source:      "control_panel",
            });
            cpPointStartRef.current  = null;
            cpPointOpenIdRef.current = null;
        }
    }

    async function handleNext() {
        stopTimer();

        let canvasTimings = { whole_image_ms: null, roi_draw_ms: null, roi_used: false, point_timings: [] };
        const wrapper = canvasWrapperRef?.current;
        if (wrapper?.__getTimingSnapshot) {
            canvasTimings = wrapper.__getTimingSnapshot();
        }
        if (wrapper?.__saveCurrentToCache) {
            wrapper.__saveCurrentToCache();
        }

        const allPointTimings = [
            ...canvasTimings.point_timings,
            ...cpPointTimings.current,
        ];

        const currentAnnotations = items.map(it => ({
            image:        images[currentImageIdx],
            label:        it.label,
            point_id:     it.id,
            ...(isSegmentation
                ? { area: it.area }
                : { ix: it.ix, iy: it.iy }
            ),
            annotator_id: annotator,
        }));

        try {
            const res = await fetch("http://localhost:8000/save-annotations", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    annotations: currentAnnotations,
                    timings: {
                        image:             images[currentImageIdx],
                        annotator_id:      annotator,
                        whole_image_ms:    canvasTimings.whole_image_ms,
                        roi_draw_ms:       canvasTimings.roi_draw_ms,
                        roi_used:          canvasTimings.roi_used,
                        point_timings:     allPointTimings,
                        roi: canvasTimings.roi_used ? canvasTimings.roi : null,
                        n_points:          items.length,
                        n_labeled:         items.filter(it => it.label).length,
                        n_ai_accepted:     allPointTimings.filter(t => t.accepted_ai).length,
                        n_ai_modified:     allPointTimings.filter(t => !t.accepted_ai).length,
                    },
                }),
            });

            const data = await res.json();
            console.log("Saved:", data);

            if (data.should_train) {
                console.log("🚀 Trigger training");
                await fetch("http://localhost:8000/train", { method: "POST" });
            }
        } catch (err) {
            console.error("Save annotations error:", err);
        }

        setAnnotations(prev => [...prev, ...currentAnnotations]);

        cpPointTimings.current = [];

        const nextIdx = currentImageIdx + 1;
        if (nextIdx < images.length) {
            setPoints([]);
            setMasks([]);
            setCurrentImageIdx(nextIdx);
            setZoom(1);
            setOffset({ x: 0, y: 0 });
            setShowExp1Popup(false);
            setShowExp2Popup(false);
        }
    }

    function handlePrev() {
        stopTimer();

        if (currentImageIdx === 0) return;

        const wrapper = canvasWrapperRef?.current;
        if (wrapper?.__saveCurrentToCache) {
            wrapper.__saveCurrentToCache();
        }

        cpPointTimings.current = [];

        setPoints([]);
        setMasks([]);
        setCurrentImageIdx(prev => prev - 1);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    }

    function getSortedLabels(prediction) {
        const pool = shortLabels?.length
            ? shortLabels.map(code => ({
                code,
                name:    labelsMap?.[code] ?? code,
                display: labelsMap?.[code] ? `${code} – ${labelsMap[code]}` : code,
            }))
            : ["coral","sand","algae"].map(n => ({ code: n, name: n, display: n }));
        const sorted = pool.sort((a, b) => a.name.localeCompare(b.name));
        if (prediction) {
            const idx = sorted.findIndex(l => l.code === prediction);
            if (idx > -1) { const [pred] = sorted.splice(idx, 1); sorted.unshift(pred); }
        }
        return sorted;
    }

    const isLastImage = currentImageIdx >= images.length - 1;
    const experience = config?.experience || "None";

    const showDefaultUI = experience === "None";
    const showExp1UI = experience === "exp1";
    const showExp2UI = experience === "exp2";

    // Check if all items are annotated
    const allAnnotated = total > 0 && labeled === total;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* ── model selection ── */}
            <button
                onClick={() => setQuickAccept(v => !v)}
                style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: quickAccept ? "#dcfce7" : "#f9fafb", color: quickAccept ? "#166534" : "#6b7280", cursor: "pointer" }}
            >
                ✔ Quick accept: {quickAccept ? "ON" : "OFF"}
            </button>

            {/* progress bar */}
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>{isSegmentation ? "Masks" : "Points"} labeled</span>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{labeled} / {total}</span>
                </div>
                <div style={{ height: 4, background: "#e5e7eb", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: total > 0 ? `${(labeled / total) * 100}%` : "0%", background: "#60a5fa", transition: "width 0.2s", borderRadius: 2 }} />
                </div>
            </div>

            {/* ── ITEM LIST (visible in all modes) ── */}
            {items.map((item) => {
                const isSelected = !isSegmentation && selectedPoint === item.id;
                return (
                    <div
                        key={item.id}
                        onClick={() => !isSegmentation && setSelectedPoint(item.id)}
                        style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 6px", borderRadius: 6, background: isSelected ? "#fef9c3" : item.label ? "#f0fdf4" : "transparent", cursor: isSegmentation ? "default" : "pointer", border: isSelected ? "1px solid #fbbf24" : "1px solid transparent" }}
                    >
                        <span style={{ minWidth: 20, height: 20, borderRadius: "50%", background: item.label ? "#4ade80" : "#e5e7eb", color: item.label ? "#14532d" : "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            {item.id}
                        </span>

                        <select
                            value={item.label ?? item.prediction ?? ""}
                            onFocus={() => handleSelectFocus(item.id)}
                            onChange={(e) => handleLabelChange(item.id, e.target.value)}
                            onClick={e => e.stopPropagation()}
                            style={{ flex: 1, fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid #d1d5db", background: item.label ? "#dcfce7" : "#fff", color: item.label ? "#166534" : "#374151", cursor: "pointer" }}
                        >
                            <option value="" disabled>— pick label —</option>
                            {getSortedLabels(item.prediction).map(({ code, display }) => (
                                <option key={code} value={code}>{display}</option>
                            ))}
                        </select>

                        {quickAccept && item.prediction && !item.label && (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleLabelChange(item.id, item.prediction); }}
                                style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #bbf7d0", background: "#dcfce7", color: "#166534", cursor: "pointer" }}
                            >
                                ✓
                            </button>
                        )}

                        {item.prediction && !item.label && (
                            <span style={{ fontSize: 9, color: "#94a3b8", fontStyle: "italic", flexShrink: 0 }}>
                                {item.prediction}
                            </span>
                        )}
                    </div>
                );
            })}

            {/* ── NAVIGATION BUTTONS ── */}
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexDirection: "column" }}>
                {/* ── DEFAULT UI (None) ── */}
                {showDefaultUI && (
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={handlePrev}
                            disabled={currentImageIdx === 0}
                            style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: currentImageIdx === 0 ? "#f3f4f6" : "#e5e7eb", color: "#6b7280", fontWeight: 600, fontSize: 13, cursor: currentImageIdx === 0 ? "not-allowed" : "pointer" }}
                        >
                            ← Prev
                        </button>
                        <button
                            onClick={handleNext}
                            style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: "#e5e7eb", color: "#9ca3af", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                        >
                            {isLastImage ? "✅ Finish" : `Next → (${currentImageIdx + 1} / ${images.length})`}
                        </button>
                    </div>
                )}

                {/* ── EXP1 UI (Finish Image button) ── */}
                {showExp1UI && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                            onClick={() => {
                                stopTimer();
                                setShowExp1Popup(true);
                            }}
                            disabled={!allAnnotated}
                            style={{
                                padding: "8px 0",
                                borderRadius: 6,
                                border: "none",
                                background: allAnnotated ? "#10b981" : "#d1d5db",
                                color: allAnnotated ? "#fff" : "#9ca3af",
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: allAnnotated ? "pointer" : "not-allowed"
                            }}
                        >
                            ✅ Finish Image
                        </button>
                        {!allAnnotated && (
                            <span style={{ fontSize: 11, color: "#ef4444", textAlign: "center" }}>
                                ⚠️ Annotate all {total} points to continue
                            </span>
                        )}
                    </div>
                )}

                {/* ── EXP2 UI (Next Image + Pause buttons) ── */}
                {showExp2UI && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={handleNext}
                                disabled={!allAnnotated}
                                style={{
                                    flex: 1,
                                    padding: "8px 0",
                                    borderRadius: 6,
                                    border: "none",
                                    background: allAnnotated ? "#3b82f6" : "#d1d5db",
                                    color: allAnnotated ? "#fff" : "#9ca3af",
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: allAnnotated ? "pointer" : "not-allowed"
                                }}
                            >
                                Next Image →
                            </button>
                            <button
                                onClick={() => {
                                    stopTimer();
                                    setShowExp2Popup(true);
                                }}
                                disabled={!allAnnotated}
                                style={{
                                    flex: 0.4,
                                    padding: "8px 0",
                                    borderRadius: 6,
                                    border: "none",
                                    background: allAnnotated ? "#8b5cf6" : "#d1d5db",
                                    color: allAnnotated ? "#fff" : "#9ca3af",
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: allAnnotated ? "pointer" : "not-allowed"
                                }}
                            >
                                ⏸
                            </button>
                        </div>
                        {!allAnnotated && (
                            <span style={{ fontSize: 11, color: "#ef4444", textAlign: "center" }}>
                                ⚠️ Annotate all {total} points to continue
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* ── EXP1 POPUP ── */}
            {showExp1UI && showExp1Popup && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: "#fff", padding: 24, borderRadius: 8, textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
                        <h2 style={{ marginBottom: 16, color: "#374151" }}>Image annotated!</h2>
                        <button
                            onClick={handleNext}
                            style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
                        >
                            Go to Next Image →
                        </button>
                    </div>
                </div>
            )}

            {/* ── EXP2 POPUP (Pause) ── */}
            {showExp2UI && showExp2Popup && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: "#fff", padding: 24, borderRadius: 8, textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
                        <h2 style={{ marginBottom: 16, color: "#374151" }}>⏸ Paused</h2>
                        <button
                            onClick={() => {
                                handleNext();
                                setShowExp2Popup(false);
                            }}
                            style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
                        >
                            Next Image →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

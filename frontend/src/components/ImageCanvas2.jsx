import { useEffect, useRef, useState, useCallback } from "react";
import { useAppContext } from "../context/AppContext";

const PADDING       = 40;
const POINT_RADIUS  = 7;
const PILL_PADDING_X = 6;
const PILL_PADDING_Y = 3;
const PILL_FONT     = "11px sans-serif";
const PILL_OFFSET_X = 12;
const DROPDOWN_W    = 200;
const DROPDOWN_MAX_H = 260;

const COLORS = {
    point:      { fill: "#facc15", stroke: "#92400e", text: "#1c1917" },
    pointHover: { fill: "#fb923c", stroke: "#7c2d12", text: "#fff" },
    confirmed:  { fill: "#4ade80", stroke: "#166534", text: "#14532d" },
    prediction: { bg: "rgba(255,255,255,0.85)", border: "#94a3b8", text: "#334155" },
};

const MASK_PALETTE = [
    "#38bdf8","#f472b6","#a78bfa","#34d399","#fb923c",
    "#e879f9","#4ade80","#f87171","#60a5fa","#facc15",
];
function getMaskColor(id) { return MASK_PALETTE[id % MASK_PALETTE.length]; }

function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = yi > y !== yj > y &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

/** Returns the mask id that contains image-space point (ix, iy), or null */
function findMaskForPoint(ix, iy, masks) {
    for (const mask of masks) {
        for (const poly of mask.polygons) {
            if (!poly || poly.length < 3) continue;
            if (pointInPolygon(ix, iy, poly)) return mask.id;
        }
    }
    return null;
}

export default function ImageCanvas() {
    const canvasRef  = useRef(null);
    const wrapperRef = useRef(null);

    const {
        images, currentImageIdx,
        zoom, setZoom,
        offset, setOffset,
        isHoveringCanvas, setIsHoveringCanvas,
        config,
        labelsMap, shortLabels,
        points, setPoints,
        masks,  setMasks,
        segModel, predModel,
        quickAccept, setQuickAccept,
    } = useAppContext();

    const [isDragging, setIsDragging]           = useState(false);
    const [autoZoom,   setAutoZoom]             = useState(true);
    const [showMaskOverlay, setShowMaskOverlay] = useState(true);
    const [search,     setSearch]               = useState("");
    const [dropdown,   setDropdown]             = useState(null);
    const [dropdownPos, setDropdownPos]         = useState(null);
    const [isDraggingDropdown, setIsDraggingDropdown] = useState(false);
    const [, forceUpdate] = useState(0);

    const lastMousePos  = useRef({ x: 0, y: 0 });
    const hoveredRef    = useRef(null);
    const transformRef  = useRef({ fitScale: 1, baseX: 0, baseY: 0 });
    const imgRef        = useRef(null);
    const zoomRef       = useRef(zoom);
    const offsetRef     = useRef(offset);
    const ddDragOffset  = useRef({ x: 0, y: 0 });
    const masksRef      = useRef(masks);
    const pointsRef     = useRef(points);

    useEffect(() => { zoomRef.current   = zoom;   }, [zoom]);
    useEffect(() => { offsetRef.current = offset; }, [offset]);
    useEffect(() => { masksRef.current  = masks;  }, [masks]);
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { if (!dropdown) setSearch(""); }, [dropdown]);

    // ── mode ───────────────────────────────────────────────────────────────────
    // "Point-based" | "Segmentation" | "Seg+Point"
    const mode          = config?.in_sampling ?? "Point-based";
    const isSegOnly     = mode === "Segmentation";
    const isPointOnly   = mode === "Point-based";
    const isHybrid      = mode === "Seg+Point";
    const showMasks     = isSegOnly || isHybrid;
    const showPoints    = isPointOnly || isHybrid;

    // ── transform helpers ──────────────────────────────────────────────────────

    function computeTransform(cW, cH, iW, iH) {
        const fitScale = Math.min(cW / iW, cH / iH);
        return { fitScale, baseX: (cW - iW * fitScale) / 2, baseY: (cH - iH * fitScale) / 2 };
    }

    function imgToCanvas(ix, iy, t, z, off) {
        return {
            cx: (t.baseX + ix * t.fitScale) * z + off.x,
            cy: (t.baseY + iy * t.fitScale) * z + off.y,
        };
    }

    // ── label helpers ──────────────────────────────────────────────────────────

    function randomPrediction() {
        const pool = shortLabels?.length ? shortLabels : ["coral","sand","algae"];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function getSortedLabels() {
        const pool = shortLabels?.length
            ? shortLabels.map(code => ({
                code,
                name:    labelsMap?.[code] ?? code,
                display: labelsMap?.[code] ? `${labelsMap[code]}` : code,
            }))
            : ["coral","sand","algae"].map(n => ({ code: n, name: n, display: n }));
        return pool.sort((a, b) => a.name.localeCompare(b.name));
    }

    // ── draw ───────────────────────────────────────────────────────────────────

    const drawWithState = useCallback((z, off) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx  = canvas.getContext("2d");
        const img  = imgRef.current;
        const pts  = pointsRef.current;
        const msks = masksRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!img) return;

        const t = computeTransform(canvas.width, canvas.height, img.width, img.height);
        transformRef.current = t;

        // image
        ctx.save();
        ctx.setTransform(t.fitScale * z, 0, 0, t.fitScale * z, t.baseX * z + off.x, t.baseY * z + off.y);
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // ── masks (seg-only or hybrid — hybrid at lower opacity = "filigrane") ──
        if (showMasks && showMaskOverlay) {
            const maskAlpha = isHybrid ? 0.18 : 0.30; // lighter in hybrid
            const maskHoverAlpha = isHybrid ? 0.38 : 0.55;

            msks.forEach(mask => {
                const isHover     = hoveredRef.current?.type === "mask" && hoveredRef.current.id === mask.id;
                const isConfirmed = mask.label != null;
                const baseColor   = isConfirmed ? "#4ade80" : getMaskColor(mask.id);

                mask.polygons.forEach(poly => {
                    if (!poly || poly.length < 3) return;
                    ctx.beginPath();
                    poly.forEach(([x, y], i) => {
                        const { cx, cy } = imgToCanvas(x, y, t, z, off);
                        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
                    });
                    ctx.closePath();
                    ctx.globalAlpha = isHover ? maskHoverAlpha : maskAlpha;
                    ctx.fillStyle   = baseColor;
                    ctx.fill();
                    ctx.globalAlpha = isHover ? 0.9 : (isHybrid ? 0.4 : 0.7);
                    ctx.strokeStyle = isConfirmed ? "#166534" : baseColor;
                    ctx.lineWidth   = isHover ? 2 : 1;
                    ctx.stroke();
                });

                // pill — only in seg-only mode (hybrid uses point pills instead)
                if (!isHybrid && mask.polygons[0]?.length >= 1) {
                    ctx.globalAlpha = 1;
                    const poly = mask.polygons[0];
                    let sumX = 0, sumY = 0;
                    poly.forEach(([x, y]) => {
                        const { cx, cy } = imgToCanvas(x, y, t, z, off);
                        sumX += cx; sumY += cy;
                    });
                    const centX = sumX / poly.length;
                    const centY = sumY / poly.length;

                    ctx.font = PILL_FONT;
                    const labelText = isConfirmed ? mask.label : `${mask.prediction}`;
                    const textW = ctx.measureText(labelText).width;
                    const pillW = textW + PILL_PADDING_X * 2;
                    const pillH = 14 + PILL_PADDING_Y * 2;
                    const pillX = centX - pillW / 2;
                    const pillY = centY - pillH / 2;
                    ctx.beginPath();
                    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
                    ctx.fillStyle   = isConfirmed ? "#4ade80" : "rgba(255,255,255,0.90)";
                    ctx.fill();
                    ctx.strokeStyle = isConfirmed ? "#166534" : "#94a3b8";
                    ctx.lineWidth   = 1;
                    ctx.stroke();
                    ctx.textAlign    = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle    = isConfirmed ? "#14532d" : "#334155";
                    ctx.fillText(labelText, centX, centY);
                }
            });
        }

        // ── points ─────────────────────────────────────────────────────────────
        if (showPoints) {
            ctx.font = PILL_FONT;

            for (const pt of pts) {
                const { cx, cy } = imgToCanvas(pt.ix, pt.iy, t, z, off);
                const isHover     = hoveredRef.current?.type === "point" && hoveredRef.current.id === pt.id;
                const isConfirmed = pt.label != null;

                const col = isConfirmed ? COLORS.confirmed
                    : isHover ? COLORS.pointHover : COLORS.point;

                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(cx, cy, POINT_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle   = col.fill;
                ctx.fill();
                ctx.strokeStyle = col.stroke;
                ctx.lineWidth   = 1.5;
                ctx.stroke();

                ctx.font = `bold ${Math.round(POINT_RADIUS * 1.4)}px monospace`;
                ctx.textAlign    = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle    = col.text;
                ctx.fillText(String(pt.id), cx, cy);

                // Only draw pill if confirmed OR prediction available
                if (isConfirmed || pt.prediction != null) {
                    ctx.font = PILL_FONT;
                    const labelText = isConfirmed ? pt.label : `${pt.prediction}`;
                    const textW = ctx.measureText(labelText).width;
                    const pillW = textW + PILL_PADDING_X * 2;
                    const pillH = 14 + PILL_PADDING_Y * 2;
                    const pillX = cx + POINT_RADIUS + PILL_OFFSET_X;
                    const pillY = cy - pillH / 2;
                    ctx.beginPath();
                    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
                    ctx.fillStyle   = isConfirmed ? COLORS.confirmed.fill : COLORS.prediction.bg;
                    ctx.fill();
                    ctx.strokeStyle = isConfirmed ? COLORS.confirmed.stroke : COLORS.prediction.border;
                    ctx.lineWidth   = 1;
                    ctx.stroke();
                    ctx.textAlign    = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle    = isConfirmed ? COLORS.confirmed.text : COLORS.prediction.text;
                    ctx.fillText(labelText, pillX + PILL_PADDING_X, cy);
                }
            }
        }

        ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // ── generate points ────────────────────────────────────────────────────────

    // ── fetch predictions from backend ───────────────────────────────────────────
    async function fetchPredictions(pts) {
    if (!images.length) return pts.map(pt => ({ ...pt, prediction: null }));

    try {
        const payload = {
            name: images[currentImageIdx],
            points: pts.map(p => ({ id: p.id, ix: p.ix, iy: p.iy }))
        };

        const res = await fetch("http://localhost:8000/predict", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) return pts.map(pt => ({ ...pt, prediction: null }));

        const preds = await res.json();
        const predMap = Object.fromEntries(preds.map(p => [p.id, p.prediction ?? null]));

        return pts.map(pt => ({
            ...pt,
            prediction: predMap[pt.id] ?? null
        }));

    } catch {
        return pts.map(pt => ({ ...pt, prediction: null }));
    }
}

    async function generatePoints(img, z, off) {
        const n = Math.max(1, Number(config?.n_points ?? 10));
        const rawPoints = Array.from({ length: n }, (_, i) => ({
            id:         i,
            ix:         Math.random() * img.width,
            iy:         Math.random() * img.height,
            label:      null,
            prediction: null,
            maskId:     null,
        }));
        const withPreds = await fetchPredictions(rawPoints);
        const withMasks = isHybrid ? assignMaskIds(withPreds, masksRef.current) : withPreds;
        pointsRef.current = withMasks;
        setPoints(withMasks);
        setDropdown(null);
        drawWithState(z, off);
        forceUpdate(v => v + 1);
    }

    /** Assign maskId to each point based on which mask polygon contains it */
    function assignMaskIds(pts, msks) {
        return pts.map(pt => ({
            ...pt,
            maskId: findMaskForPoint(pt.ix, pt.iy, msks),
        }));
    }

    // ── load image ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!images.length) return;
        const img = new Image();
        img.src = `http://localhost:8000/image/${images[currentImageIdx]}`;
        img.onload = async () => {
            imgRef.current = img;
            setZoom(1);
            setOffset({ x: 0, y: 0 });

            if (showMasks) {
                // Load masks
                try {
                    const res  = await fetch(
                        `http://localhost:8000/masks?name=${encodeURIComponent(images[currentImageIdx])}&model=${segModel}&pred_model=${predModel}`
                    );
                    const data = await res.json();
                    const enriched = (data.masks || []).map(m => ({
                        ...m, label: null, prediction: randomPrediction(),
                    }));
                    masksRef.current = enriched;
                    setMasks(enriched);
                } catch (err) {
                    console.error("Failed to load masks", err);
                    masksRef.current = [];
                    setMasks([]);
                }
            } else {
                masksRef.current = [];
                setMasks([]);
            }

            if (showPoints) {
                // Generate points; in hybrid mode assign maskIds
                const n = Math.max(1, Number(config?.n_points ?? 10));
                const rawPoints = Array.from({ length: n }, (_, i) => ({
                    id: i,
                    ix: Math.random() * img.width,
                    iy: Math.random() * img.height,
                    label: null, prediction: null, maskId: null,
                }));
                const withPreds = await fetchPredictions(rawPoints);
                const withMasks = isHybrid
                    ? assignMaskIds(withPreds, masksRef.current)
                    : withPreds;
                pointsRef.current = withMasks;
                setPoints(withMasks);
            } else {
                pointsRef.current = [];
                setPoints([]);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [images, currentImageIdx, mode, segModel, predModel]);

    // redraw after state changes
    useEffect(() => { drawWithState(zoomRef.current, offsetRef.current); }, [masks, points, drawWithState]);
    useEffect(() => { drawWithState(zoom, offset); }, [zoom, offset, drawWithState]);

    // scroll block
    useEffect(() => {
        const canvas  = canvasRef.current;
        const prevent = (e) => e.preventDefault();
        canvas.addEventListener("wheel", prevent, { passive: false });
        return () => canvas.removeEventListener("wheel", prevent);
    }, []);

    // ── dropdown drag (window listeners) ──────────────────────────────────────

    useEffect(() => {
        function onMove(e) {
            if (!isDraggingDropdown) return;
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            setDropdownPos({
                x: Math.max(0, Math.min(e.clientX - rect.left - ddDragOffset.current.x, 600 + PADDING)),
                y: Math.max(0, Math.min(e.clientY - rect.top  - ddDragOffset.current.y, 400 + PADDING)),
            });
        }
        function onUp() { setIsDraggingDropdown(false); }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup",   onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, [isDraggingDropdown]);

    // ── hit-test ───────────────────────────────────────────────────────────────

    function hitTest(cx, cy, t, z, off) {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return null;
        ctx.font = PILL_FONT;

        // Points take priority
        if (showPoints) {
            for (const pt of pointsRef.current) {
                const { cx: px, cy: py } = imgToCanvas(pt.ix, pt.iy, t, z, off);
                if (Math.hypot(cx - px, cy - py) <= POINT_RADIUS + 2) return { type: "point", id: pt.id };
                const labelText = pt.label ?? ` ${pt.prediction}`;
                const textW = ctx.measureText(labelText).width;
                const pillW = textW + PILL_PADDING_X * 2;
                const pillH = 14 + PILL_PADDING_Y * 2;
                const pillX = px + POINT_RADIUS + PILL_OFFSET_X;
                const pillY = py - pillH / 2;
                if (cx >= pillX && cx <= pillX + pillW && cy >= pillY && cy <= pillY + pillH)
                    return { type: "point", id: pt.id };
            }
        }

        // Masks (seg-only or hybrid filigrane click)
        if (showMasks) {
            for (const mask of masksRef.current) {
                for (const poly of mask.polygons) {
                    if (!poly || poly.length < 3) continue;
                    const canvasPoly = poly.map(([x, y]) => {
                        const p = imgToCanvas(x, y, t, z, off);
                        return [p.cx, p.cy];
                    });
                    if (pointInPolygon(cx, cy, canvasPoly)) return { type: "mask", id: mask.id };
                }
            }
        }

        return null;
    }

    // ── zoom to item ───────────────────────────────────────────────────────────

    function zoomToItem(hit) {
        const canvas = canvasRef.current;
        const cW = canvas.width, cH = canvas.height;
        const MAX_ZOOM = 5;
        let ix, iy;

        if (hit.type === "point") {
            const pt = pointsRef.current.find(p => p.id === hit.id);
            if (!pt) return;
            ix = pt.ix; iy = pt.iy;
        } else {
            const mask = masksRef.current.find(m => m.id === hit.id);
            if (!mask?.polygons[0]?.length) return;
            const poly = mask.polygons[0];
            ix = poly.reduce((s, p) => s + p[0], 0) / poly.length;
            iy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        }

        const t    = computeTransform(cW, cH, imgRef.current.width, imgRef.current.height);
        const bx   = t.baseX + ix * t.fitScale;
        const by   = t.baseY + iy * t.fitScale;
        setZoom(MAX_ZOOM);
        setOffset({ x: cW / 2 - bx * MAX_ZOOM, y: cH / 2 - by * MAX_ZOOM });
    }

    // ── wheel ──────────────────────────────────────────────────────────────────

    function handleWheel(e) {
        e.preventDefault();
        const rect   = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setZoom(prev => {
            const next = Math.max(1, Math.min(prev * factor, 10));
            setOffset(prevOff => next === 1 ? { x: 0, y: 0 } : {
                x: mouseX - (mouseX - prevOff.x) * (next / prev),
                y: mouseY - (mouseY - prevOff.y) * (next / prev),
            });
            return next;
        });
    }

    // ── mouse ──────────────────────────────────────────────────────────────────

    function handleMouseDown(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        if (hitTest(cx, cy, transformRef.current, zoom, offset) !== null) return;
        setDropdown(null);
        setIsDragging(true);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseMove(e) {
        const rect    = canvasRef.current.getBoundingClientRect();
        const cx      = e.clientX - rect.left, cy = e.clientY - rect.top;
        const hovered = hitTest(cx, cy, transformRef.current, zoom, offset);
        const prev    = hoveredRef.current;
        if (hovered?.type !== prev?.type || hovered?.id !== prev?.id) {
            hoveredRef.current = hovered;
            drawWithState(zoom, offset);
        }
        if (!isDragging) return;
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseUp(e) {
        if (isDragging) { setIsDragging(false); return; }
        const rect = canvasRef.current.getBoundingClientRect();
        const cx   = e.clientX - rect.left, cy = e.clientY - rect.top;
        const hit  = hitTest(cx, cy, transformRef.current, zoom, offset);
        if (hit !== null) {
            if (autoZoom && !e.shiftKey) zoomToItem(hit);
            const raw = { x: cx + PADDING, y: cy + PADDING };
            setDropdownPos({
                x: Math.min(raw.x, 600 + PADDING * 2 - DROPDOWN_W - 4),
                y: cy + PADDING + DROPDOWN_MAX_H > 400 + PADDING * 2
                    ? raw.y - DROPDOWN_MAX_H
                    : raw.y,
            });
            setDropdown({ type: hit.type, id: hit.id });
        } else {
            setDropdown(null);
        }
    }

    function handleMouseLeave() {
        setIsDragging(false);
        hoveredRef.current = null;
        drawWithState(zoomRef.current, offsetRef.current);
    }

    function handleDdHeaderMouseDown(e) {
        e.stopPropagation();
        const rect = wrapperRef.current.getBoundingClientRect();
        ddDragOffset.current = {
            x: e.clientX - rect.left - dropdownPos.x,
            y: e.clientY - rect.top  - dropdownPos.y,
        };
        setIsDraggingDropdown(true);
    }
    function handleDoubleClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;

    const hit = hitTest(cx, cy, transformRef.current, zoomRef.current, offsetRef.current);

    if (!hit) return;
    if (!quickAccept) return;
    if (hit.type === "point") {
        const pt = pointsRef.current.find(p => p.id === hit.id);

        // 👉 seulement si prediction existe et pas déjà labelisé
        if (pt && pt.prediction && !pt.label) {
            confirmLabel("point", pt.id, pt.prediction);
        }
    }

    if (hit.type === "mask") {
        const mask = masksRef.current.find(m => m.id === hit.id);

        if (mask && mask.prediction && !mask.label) {
            confirmLabel("mask", mask.id, mask.prediction);
        }
    }
}

    // ── confirm label ──────────────────────────────────────────────────────────

    function confirmLabel(type, id, label) {
        if (type === "point") {
            let updated = pointsRef.current.map(p => p.id === id ? { ...p, label } : p);

            // Hybrid: auto-label only UNLABELED siblings in the same mask
            // If a sibling already has a label, it means it was manually set → don't overwrite
            if (isHybrid) {
                const clickedPt = updated.find(p => p.id === id);
                if (clickedPt?.maskId != null) {
                    updated = updated.map(p =>
                        p.maskId === clickedPt.maskId && p.id !== id && p.label == null
                            ? { ...p, label }
                            : p
                    );
                }
            }

            pointsRef.current = updated;
            setPoints(updated);
        } else {
            const updated = masksRef.current.map(m => m.id === id ? { ...m, label } : m);
            masksRef.current = updated;
            setMasks(updated);
        }

        setDropdown(null);
        if (autoZoom) { setZoom(1); setOffset({ x: 0, y: 0 }); }
        forceUpdate(v => v + 1);
    }

    // ── regen ──────────────────────────────────────────────────────────────────

    async function handleRegenerate() {
        if (!imgRef.current) return;
        const img = imgRef.current;
        const n   = Math.max(1, Number(config?.n_points ?? 10));
        const rawPoints = Array.from({ length: n }, (_, i) => ({
            id: i, ix: Math.random() * img.width, iy: Math.random() * img.height,
            label: null, prediction: null, maskId: null,
        }));
        const withPreds = await fetchPredictions(rawPoints);
        const withMasks = isHybrid
            ? assignMaskIds(withPreds, masksRef.current)
            : withPreds;
        pointsRef.current = withMasks;
        setPoints(withMasks);
        setDropdown(null);
        drawWithState(zoomRef.current, offsetRef.current);
        forceUpdate(v => v + 1);
    }

    // ── dropdown helpers ───────────────────────────────────────────────────────

    function getDropdownItem() {
        if (!dropdown) return null;
        return dropdown.type === "point"
            ? pointsRef.current.find(p => p.id === dropdown.id) ?? null
            : masksRef.current.find(m => m.id === dropdown.id) ?? null;
    }

    function getFilteredLabels() {
        const sorted = getSortedLabels();
        const item   = getDropdownItem();
        // Prediction first
        let base = sorted;
        if (item?.prediction) {
            const pred   = base.find(l => l.code === item.prediction);
            const others = base.filter(l => l.code !== item.prediction);
            base = pred ? [pred, ...others] : base;
        }
        if (!search) return base;
        const s = search.toLowerCase();
        return base.filter(l =>
            l.code.toLowerCase().includes(s) || l.name.toLowerCase().includes(s)
        );
    }

    const cursor = isDragging ? "grabbing" : hoveredRef.current ? "pointer" : "grab";

    // ── count sibling points for tooltip ──────────────────────────────────────
    function siblingCount(ptId) {
        const pt = pointsRef.current.find(p => p.id === ptId);
        if (!pt?.maskId) return 0;
        // Only count unlabeled siblings — those are the ones that will be auto-labeled
        return pointsRef.current.filter(p => p.maskId === pt.maskId && p.id !== ptId && p.label == null).length;
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {/* toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                {showPoints && (
                    <button onClick={handleRegenerate} style={{
                        padding: "4px 12px", borderRadius: 6,
                        border: "1px solid #d1d5db", background: "#f9fafb",
                        cursor: "pointer", fontSize: 13,
                    }}>
                        🎲 Regenerate {config?.n_points ?? 10} points
                    </button>
                )}
                <button onClick={() => setAutoZoom(v => !v)} style={{
                    padding: "4px 10px", borderRadius: 6,
                    border: "1px solid #d1d5db",
                    background: autoZoom ? "#dbeafe" : "#f9fafb",
                    color: autoZoom ? "#1d4ed8" : "#374151",
                    cursor: "pointer", fontSize: 12, fontWeight: 500,
                }}>
                    🔍 Auto-zoom: {autoZoom ? "ON" : "OFF"}
                </button>
                {showMasks && (
                    <span style={{
                        fontSize: 12, padding: "3px 8px",
                        background: "#ede9fe", color: "#5b21b6",
                        borderRadius: 4, border: "1px solid #c4b5fd",
                    }}>
                        🧩 {masks.length} masks
                    </span>
                )}
                {isHybrid && (
                    <span style={{
                        fontSize: 11, padding: "3px 8px",
                        background: "#fef9c3", color: "#854d0e",
                        borderRadius: 4, border: "1px solid #fde68a",
                    }}>
                        ⚡ Labeling a point auto-labels its mask siblings
                    </span>
                )}
                {isHybrid && (
                    <button onClick={() => setShowMaskOverlay(v => !v)} style={{
                        padding: "4px 10px", borderRadius: 6,
                        border: "1px solid #d1d5db",
                        background: showMaskOverlay ? "#f0fdf4" : "#f9fafb",
                        color: showMaskOverlay ? "#166534" : "#9ca3af",
                        cursor: "pointer", fontSize: 12, fontWeight: 500,
                    }}>
                        🗺️ Masks: {showMaskOverlay ? "ON" : "OFF"}
                    </button>
                )}
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                    scroll to zoom · drag to pan · click to label
                </span>
            </div>

            {/* canvas + overlay */}
            <div
                ref={wrapperRef}
                style={{
                    padding: PADDING, background: "#f5f5f5",
                    borderRadius: 8, boxShadow: "inset 0 1px 4px rgba(0,0,0,.08)",
                    overflow: "hidden", position: "relative", cursor,
                }}
                onMouseEnter={() => setIsHoveringCanvas(true)}
                onMouseLeave={() => { setIsHoveringCanvas(false); handleMouseLeave(); }}
            >
                <canvas
                    ref={canvasRef}
                    width={600} height={400}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onDoubleClick={handleDoubleClick}   // 👈 AJOUT ICI
                    style={{ border: "1px solid #d1d5db", borderRadius: 4, display: "block" }}
                />

                {/* dropdown */}
                {dropdown && dropdownPos && (() => {
                    const item     = getDropdownItem();
                    if (!item) return null;
                    const filtered = getFilteredLabels();
                    const title    = dropdown.type === "point"
                        ? `Point #${dropdown.id}`
                        : `Mask #${dropdown.id}`;
                    const siblings = isHybrid && dropdown.type === "point"
                        ? siblingCount(dropdown.id)
                        : 0;

                    return (
                        <div
                            onMouseDown={e => e.stopPropagation()}
                            style={{
                                position: "absolute",
                                left: dropdownPos.x, top: dropdownPos.y,
                                width: DROPDOWN_W,
                                background: "#fff",
                                border: "1px solid #cbd5e1",
                                borderRadius: 8,
                                boxShadow: "0 4px 20px rgba(0,0,0,.18)",
                                zIndex: 20, overflow: "hidden", userSelect: "none",
                            }}
                        >
                            {/* draggable header */}
                            <div
                                onMouseDown={handleDdHeaderMouseDown}
                                style={{
                                    padding: "6px 10px",
                                    background: "#f8fafc",
                                    borderBottom: "1px solid #e2e8f0",
                                    fontSize: 11, color: "#64748b",
                                    display: "flex", justifyContent: "space-between",
                                    alignItems: "center", cursor: "grab",
                                }}
                            >
                                <span style={{ fontWeight: 600 }}>⠿ {title}</span>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    {item.prediction && (
                                        <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
                                            {labelsMap?.[item.prediction] ?? item.prediction}
                                        </span>
                                    )}
                                    {siblings > 0 && (
                                        <span style={{
                                            fontSize: 9, padding: "1px 5px",
                                            background: "#fef9c3", borderRadius: 3,
                                            color: "#854d0e", border: "1px solid #fde68a",
                                        }}>
                                            +{siblings} in mask
                                        </span>
                                    )}
                                    <span
                                        onMouseDown={e => { e.stopPropagation(); setDropdown(null); }}
                                        style={{ cursor: "pointer", fontSize: 13, color: "#94a3b8" }}
                                    >✕</span>
                                </div>
                            </div>

                            {/* search */}
                            <div style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                    autoFocus
                                    placeholder="Search…"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    onMouseDown={e => e.stopPropagation()}
                                    onKeyDown={e => e.stopPropagation()}
                                    style={{
                                        width: "100%", boxSizing: "border-box",
                                        fontSize: 12, padding: "3px 7px",
                                        border: "1px solid #e2e8f0", borderRadius: 4, outline: "none",
                                    }}
                                />
                            </div>

                            {/* label list */}
                            <div style={{ maxHeight: DROPDOWN_MAX_H - 70, overflowY: "auto" }}>
                                {filtered.length === 0 && (
                                    <div style={{ padding: "8px 10px", fontSize: 12, color: "#9ca3af" }}>
                                        No match
                                    </div>
                                )}
                                {filtered.map(({ code, display }) => {
                                    const isActive     = item.label === code;
                                    const isPrediction = item.prediction === code;
                                    return (
                                        <div
                                            key={code}
                                            onClick={() => confirmLabel(dropdown.type, dropdown.id, code)}
                                            style={{
                                                padding: "6px 10px", fontSize: 12,
                                                cursor: "pointer", display: "flex",
                                                alignItems: "center", gap: 6,
                                                background:  isActive ? "#dcfce7" : "transparent",
                                                color:       isActive ? "#166534" : "#1e293b",
                                                fontWeight:  isActive ? 600 : 400,
                                                borderLeft:  isActive ? "3px solid #4ade80" : "3px solid transparent",
                                            }}
                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#f1f5f9"; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = isActive ? "#dcfce7" : "transparent"; }}
                                        >
                                            <span style={{ flex: 1 }}>{display}</span>
                                            {isPrediction && (
                                                <span style={{
                                                    fontSize: 9, padding: "1px 4px",
                                                    background: "#e2e8f0", borderRadius: 3, color: "#64748b",
                                                }}>AI</span>
                                            )}
                                            {isActive && <span style={{ color: "#16a34a" }}>✓</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
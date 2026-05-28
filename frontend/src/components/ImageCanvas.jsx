import { useEffect, useRef, useState, useCallback } from "react";
import { useAppContext } from "../context/AppContext";

const PADDING        = 40;
const POINT_RADIUS   = 7;
const PILL_PADDING_X = 6;
const PILL_PADDING_Y = 3;
const PILL_FONT      = "11px sans-serif";
const PILL_OFFSET_X  = 12;
const DROPDOWN_W     = 200;
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
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

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

    const {
        images, currentImageIdx, setCurrentImageIdx,
        zoom, setZoom,
        offset, setOffset,
        isHoveringCanvas, setIsHoveringCanvas,
        config,
        labelsMap, shortLabels,
        points, setPoints,
        masks,  setMasks,
        segModel, predModel,
        canvasWrapperRef,
        projectName,annotator,
        annotationCache, setAnnotationCache,
        userClickedImage, setUserClickedImage,
    } = useAppContext();
    const wrapperRef = canvasWrapperRef;
    // ── basic interaction state ────────────────────────────────────────────────
    const [isDragging,         setIsDragging]         = useState(false);
    const [autoZoom,           setAutoZoom]           = useState(false);
    const [showMaskOverlay,    setShowMaskOverlay]    = useState(true);
    const [showLabels,         setShowLabels]         = useState(true);  // 🆕 Toggle labels visibility
    const [search,             setSearch]             = useState("");
    const [dropdown,           setDropdown]           = useState(null);
    const [dropdownPos,        setDropdownPos]        = useState(null);
    const [isDraggingDropdown, setIsDraggingDropdown] = useState(false);
    const [, forceUpdate] = useState(0);

    // ── ROI state (all in refs so drawWithState always sees latest values) ─────
    const [tool, setTool] = useState("roi");
    const [roiBox, setRoiBoxState] = useState(null);
    const roiBoxRef    = useRef(null);
    const roiPhaseRef  = useRef("idle");
    const roiAnchorRef = useRef(null);
    const roiLiveRef   = useRef(null);

    // ── MULTISELECT state ──────────────────────────────────────────────────────
    const [showMultiselectBox, setShowMultiselectBox] = useState(null);
    const multiselectBoxRef = useRef(null);
    const msPhaseRef        = useRef("idle");
    const msAnchorRef       = useRef(null);
    const msLiveRef         = useRef(null);
    const [selectedPointIds, setSelectedPointIds] = useState(new Set());

    function setRoiBox(val) {
        roiBoxRef.current = val;
        setRoiBoxState(val);
    }

    // ── other refs ────────────────────────────────────────────────────────────
    const lastMousePos = useRef({ x: 0, y: 0 });
    const hoveredRef   = useRef(null);
    const transformRef = useRef({ fitScale: 1, baseX: 0, baseY: 0 });
    const imgRef       = useRef(null);
    const zoomRef      = useRef(zoom);
    const offsetRef    = useRef(offset);
    const ddDragOffset = useRef({ x: 0, y: 0 });
    const masksRef     = useRef(masks);
    const pointsRef    = useRef(points);

    // ── timings ────────────────────────────────────────────────────────────────
    const imageStartRef    = useRef(null);
    const roiStartRef      = useRef(null);
    const roiDurationRef   = useRef(null);
    const pointStartRef    = useRef(null);
    const pointOpenIdRef   = useRef(null);
    const pointTimingsRef  = useRef([]);

    useEffect(() => { zoomRef.current   = zoom;   }, [zoom]);
    useEffect(() => { offsetRef.current = offset; }, [offset]);
    useEffect(() => { masksRef.current  = masks;  }, [masks]);
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { if (!dropdown) setSearch(""); }, [dropdown]);

    // ── mode ──────────────────────────────────────────────────────────────────
    const mode      = config?.in_sampling ?? "Point-based";
    const isSegOnly = mode === "Segmentation";
    const isHybrid  = mode === "Seg+Point";
    const showMasks = isSegOnly || isHybrid;
    const showPoints = mode === "Point-based" || isHybrid;

    // ── 🆕 Sort points by position (top-left to bottom-right: X first, then Y) ────────────────
    function sortPointsByPosition(pts) {
        return [...pts].sort((a, b) => {
            // Sort by Y first (top to bottom)
            if (Math.abs(a.iy - b.iy) > 5) return a.iy - b.iy;
            // If same row, sort by X (left to right)
            return a.ix - b.ix;
        });
    }

    // ── 🆕 Reassign IDs based on sorted position ────────────────────────────
    function reassignPointIds(pts) {
        const sorted = sortPointsByPosition(pts);
        return sorted.map((p, i) => ({ ...p, id: i }));
    }
    // ── Vérifier si une image est complètement annotée ──
// 🆕 Fonction pour vérifier sur le serveur
async function isImageCompleteOnServer(imageName, projectName, nPointsRequired) {
    try {
        const res = await fetch(
            `http://localhost:8000/annotations` +
            `?name=${encodeURIComponent(imageName)}` +
            `&project=${encodeURIComponent(projectName)}`
        );

        if (!res.ok) return false;

        const data = await res.json();
        let savedPoints = Array.isArray(data) ? data : (data?.points || data?.annotations || []);

        const labeledCount = savedPoints.filter(p => p.label != null && p.label !== "").length;
        console.log(`📋 Image "${imageName}": ${labeledCount}/${nPointsRequired} annotés`);

        return labeledCount >= nPointsRequired;
    } catch (e) {
        console.error("❌ Erreur vérification serveur:", e);
        return false;
    }
}


// ── Trouver la prochaine image incomplète ──
function findNextIncompleteImage(startIdx, images, annotations, nPointsRequired) {
    for (let i = startIdx; i < images.length; i++) {
        if (!isImageComplete(images[i], annotations, nPointsRequired)) {
            return i;
        }
    }
    return -1;
}


    // ── 🆕 Get next point in sequence (with wraparound) ──────────────────────
    function getNextPointId(currentId) {
        const totalPoints = pointsRef.current?.length ?? 0;
        if (totalPoints === 0) return null;
        return (currentId + 1) % totalPoints;
    }

    // ── transform helpers ─────────────────────────────────────────────────────

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
    function canvasToImg(cx, cy, t, z, off) {
        return {
            ix: ((cx - off.x) / z - t.baseX) / t.fitScale,
            iy: ((cy - off.y) / z - t.baseY) / t.fitScale,
        };
    }

    // ── label helpers ─────────────────────────────────────────────────────────

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

    // ── check if point is inside box ──────────────────────────────────────────
    function pointInBox(px, py, x1, y1, x2, y2) {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        return px >= minX && px <= maxX && py >= minY && py <= maxY;
    }

    // ── update selected points inside multiselect box ───────────────────────────
    function updateSelectedPoints(x1, y1, x2, y2) {
        const ids = new Set();
        if (pointsRef.current) {
            pointsRef.current.forEach(pt => {
                if (pointInBox(pt.ix, pt.iy, x1, y1, x2, y2)) {
                    ids.add(pt.id);
                }
            });
        }
        setSelectedPointIds(ids);
    }

    // ── draw ──────────────────────────────────────────────────────────

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

        // ── image ──────────────────────────────────────────────────────────────
        ctx.save();
        ctx.setTransform(t.fitScale * z, 0, 0, t.fitScale * z, t.baseX * z + off.x, t.baseY * z + off.y);
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // ── masks ──────────────────────────────────────────────────────────────
        if (showMasks && showMaskOverlay) {
            const alpha      = isHybrid ? 0.18 : 0.30;
            const hoverAlpha = isHybrid ? 0.38 : 0.55;
            msks.forEach(mask => {
                const isHover     = hoveredRef.current?.type === "mask" && hoveredRef.current.id === mask.id;
                const isConfirmed = mask.label != null;
                const color       = isConfirmed ? "#4ade80" : getMaskColor(mask.id);
                mask.polygons.forEach(poly => {
                    if (!poly || poly.length < 3) return;
                    ctx.beginPath();
                    poly.forEach(([x, y], i) => {
                        const { cx, cy } = imgToCanvas(x, y, t, z, off);
                        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
                    });
                    ctx.closePath();
                    ctx.globalAlpha = isHover ? hoverAlpha : alpha;
                    ctx.fillStyle   = color;
                    ctx.fill();
                    ctx.globalAlpha = isHover ? 0.9 : (isHybrid ? 0.4 : 0.7);
                    ctx.strokeStyle = isConfirmed ? "#166534" : color;
                    ctx.lineWidth   = isHover ? 2 : 1;
                    ctx.stroke();
                });
                if (!isHybrid && mask.polygons[0]?.length && showLabels) {  // 🆕 Check showLabels
                    ctx.globalAlpha = 1;
                    const poly = mask.polygons[0];
                    let sumX = 0, sumY = 0;
                    poly.forEach(([x, y]) => { const p = imgToCanvas(x, y, t, z, off); sumX += p.cx; sumY += p.cy; });
                    const centX = sumX / poly.length, centY = sumY / poly.length;
                    ctx.font = PILL_FONT;
                    const txt = isConfirmed ? mask.label : `~ ${mask.prediction}`;
                    const tw  = ctx.measureText(txt).width;
                    const pw  = tw + PILL_PADDING_X * 2, ph = 14 + PILL_PADDING_Y * 2;
                    ctx.beginPath();
                    ctx.roundRect(centX - pw / 2, centY - ph / 2, pw, ph, 4);
                    ctx.fillStyle   = isConfirmed ? "#4ade80" : "rgba(255,255,255,0.90)";
                    ctx.fill();
                    ctx.strokeStyle = isConfirmed ? "#166534" : "#94a3b8";
                    ctx.lineWidth   = 1; ctx.stroke();
                    ctx.textAlign = "center"; ctx.textBaseline = "middle";
                    ctx.fillStyle = isConfirmed ? "#14532d" : "#334155";
                    ctx.fillText(txt, centX, centY);
                }
            });
        }

        // ── points ─────────────────────────────────────────────────────────────
        if (showPoints) {
            ctx.font = PILL_FONT;
            for (const pt of pts) {
                const { cx, cy } = imgToCanvas(pt.ix, pt.iy, t, z, off);
                const isHover     = hoveredRef.current?.type === "point" && hoveredRef.current.id === pt.id;
                const isSelected  = selectedPointIds.has(pt.id);
                const isConfirmed = pt.label != null;
                const col = isSelected ? { fill: "#ec4899", stroke: "#be185d", text: "#fff" }
                    : isConfirmed ? COLORS.confirmed
                    : isHover ? COLORS.pointHover
                    : COLORS.point;
                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(cx, cy, POINT_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = col.fill; ctx.fill();
                ctx.strokeStyle = col.stroke; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.font = `bold ${Math.round(POINT_RADIUS * 1.4)}px monospace`;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillStyle = col.text;
                ctx.fillText(String(pt.id), cx, cy);
                if (showLabels && (isConfirmed || pt.prediction != null)) {  // 🆕 Check showLabels
                    ctx.font = PILL_FONT;
                    const txt = isConfirmed ? pt.label : `~ ${pt.prediction}`;
                    const tw  = ctx.measureText(txt).width;
                    const pw  = tw + PILL_PADDING_X * 2, ph = 14 + PILL_PADDING_Y * 2;
                    const px  = cx + POINT_RADIUS + PILL_OFFSET_X, py = cy - ph / 2;
                    ctx.beginPath();
                    ctx.roundRect(px, py, pw, ph, 4);
                    ctx.fillStyle   = isConfirmed ? COLORS.confirmed.fill   : COLORS.prediction.bg;
                    ctx.fill();
                    ctx.strokeStyle = isConfirmed ? COLORS.confirmed.stroke : COLORS.prediction.border;
                    ctx.lineWidth = 1; ctx.stroke();
                    ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    ctx.fillStyle = isConfirmed ? COLORS.confirmed.text : COLORS.prediction.text;
                    ctx.fillText(txt, px + PILL_PADDING_X, cy);
                }
            }
        }

        // ── ROI overlay ─────────────────────────────────────────────────────────
        ctx.globalAlpha = 1;

        function drawBox(ix1, iy1, ix2, iy2, committed, style = "roi") {
            const a  = imgToCanvas(ix1, iy1, t, z, off);
            const b  = imgToCanvas(ix2, iy2, t, z, off);
            const rx = Math.min(a.cx, b.cx), ry = Math.min(a.cy, b.cy);
            const rw = Math.abs(b.cx - a.cx), rh = Math.abs(b.cy - a.cy);
            if (rw < 2 || rh < 2) return;

            ctx.save();

            if (style === "multiselect") {
                ctx.fillStyle = "rgba(34,197,94,0.12)";
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeStyle = "#22c55e";
                ctx.lineWidth   = 2;
                ctx.setLineDash([]);
                ctx.strokeRect(rx, ry, rw, rh);
                [[a.cx, a.cy], [b.cx, b.cy],
                 [a.cx, b.cy], [b.cx, a.cy]].forEach(([x, y]) => {
                    ctx.beginPath();
                    ctx.arc(x, y, committed ? 4 : 3, 0, Math.PI * 2);
                    ctx.fillStyle = "#22c55e";
                    ctx.fill();
                });
            } else {
                ctx.fillStyle = committed ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.05)";
                ctx.fillRect(rx, ry, rw, rh);
                ctx.strokeStyle = "#6366f1";
                ctx.lineWidth   = committed ? 2.5 : 1.5;
                ctx.setLineDash([8, 4]);
                ctx.strokeRect(rx, ry, rw, rh);
                ctx.setLineDash([]);
                [[a.cx, a.cy], [b.cx, b.cy],
                 [a.cx, b.cy], [b.cx, a.cy]].forEach(([x, y]) => {
                    ctx.beginPath();
                    ctx.arc(x, y, committed ? 4 : 3, 0, Math.PI * 2);
                    ctx.fillStyle = "#6366f1";
                    ctx.fill();
                });
                if (committed) {
                    const iw = Math.abs(ix2 - ix1).toFixed(0);
                    const ih = Math.abs(iy2 - iy1).toFixed(0);
                    const label = `${iw}×${ih}px`;
                    ctx.font      = "bold 10px monospace";
                    ctx.fillStyle = "#6366f1";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    ctx.fillText(label, rx + 4, ry + 4);
                }
            }
            ctx.restore();
        }

        const box = roiBoxRef.current;
        if (box) drawBox(box.x1, box.y1, box.x2, box.y2, true, "roi");

        const anchor = roiAnchorRef.current;
        const live   = roiLiveRef.current;
        if (anchor && live) drawBox(anchor.ix, anchor.iy, live.ix, live.iy, false, "roi");

        const msbox = multiselectBoxRef.current;
        if (msbox) drawBox(msbox.x1, msbox.y1, msbox.x2, msbox.y2, true, "multiselect");

        const msanchor = msAnchorRef.current;
        const mslive   = msLiveRef.current;
        if (msanchor && mslive) drawBox(msanchor.ix, msanchor.iy, mslive.ix, mslive.iy, false, "multiselect");

        ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, showMaskOverlay, isHybrid, showMasks, showPoints, selectedPointIds, showLabels]);  // 🆕 Added showLabels

    // ── predictions ───────────────────────────────────────────────────────────

    async function fetchPredictions(pts) {
    if (!images.length) return pts.map(pt => ({ ...pt, prediction: null, ranking: [] }));
    try {
        const payload = pts.map(p => ({ id: p.id, ix: p.ix, iy: p.iy }));
        const res = await fetch("http://localhost:8000/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: images[currentImageIdx],
                points: payload
            })
        });

        if (!res.ok) return pts.map(pt => ({ ...pt, prediction: null, ranking: [] }));
        const preds = await res.json();
        console.log("Predictions ", preds)

        const predMap = Object.fromEntries(preds.map(p => [p.id, { prediction: p.prediction ?? null, ranking: p.ranking ?? [] }]));
        return pts.map(pt => ({
            ...pt,
            prediction: predMap[pt.id]?.prediction ?? null,
            ranking: predMap[pt.id]?.ranking ?? []  // 🆕
        }));
    } catch {
        return pts.map(pt => ({ ...pt, prediction: null, ranking: [] }));
    }
}


    // ── generate points ───────────────────────────────────────────────────────
    async function generatePoints(img, z, off, boxOverride) {
        const n   = Math.max(1, Number(config?.n_points ?? 10));
        const box = boxOverride !== undefined ? boxOverride : roiBoxRef.current;

        const minX = box ? Math.min(box.x1, box.x2) : 0;
        const minY = box ? Math.min(box.y1, box.y2) : 0;
        const maxX = box ? Math.max(box.x1, box.x2) : img.width;
        const maxY = box ? Math.max(box.y1, box.y2) : img.height;

        const existing = pointsRef.current || [];

        const annotated = existing
            .filter(p => p.label != null)
            .map(p => ({
                ix: p.ix,
                iy: p.iy,
                label: p.label,
                prediction: null,
                maskId: null,
            }));

        const missingCount = Math.max(0, n - annotated.length);

        const randomPoints = Array.from({ length: missingCount }, () => ({
            ix: minX + Math.random() * (maxX - minX),
            iy: minY + Math.random() * (maxY - minY),
            label: null,
            prediction: null,
            maskId: null,
        }));

        let withPreds = [];
        if (randomPoints.length > 0) {
            withPreds = await fetchPredictions(
                randomPoints.map((p, i) => ({ ...p, id: i }))
            );
        }

        if (isHybrid) {
            withPreds = assignMaskIds(withPreds, masksRef.current);
        }

        let finalPoints = [...annotated, ...withPreds];

        // 🆕 Reassign IDs based on sorted position
        finalPoints = reassignPointIds(finalPoints);

        pointsRef.current = finalPoints;
        setPoints(finalPoints);
        setDropdown(null);

        drawWithState(z, off);
        forceUpdate(v => v + 1);
    }

    function assignMaskIds(pts, msks) {
        return pts.map(pt => ({ ...pt, maskId: findMaskForPoint(pt.ix, pt.iy, msks) }));
    }

// ── load image ────────────────────────────────────────────────────────────
useEffect(() => {
    if (!images.length) return;

    const nPointsRequired = config?.n_points ?? 10;
     // 🆕 Reset IMMÉDIATEMENT avant de charger
    setPoints([]);
    setRoiBox(null);
    setSelectedPointIds(new Set());
    pointsRef.current = [];
    // ✅ Fonction async principale
    const loadImage = async () => {
        let indexToLoad = currentImageIdx;

        // 🆕 SI l'user a cliqué manuellement depuis Gallery, on charge DIRECTEMENT
        // Sinon, on cherche la prochaine incomplète
        if (!userClickedImage) {
            // 1️⃣ Vérifier si l'image actuelle est complète
            if (await isImageCompleteOnServer(images[currentImageIdx], projectName, nPointsRequired)) {
                console.log(`⏭️  Image ${currentImageIdx} complète, cherche la prochaine...`);

                // Chercher la prochaine image incomplète
                for (let i = currentImageIdx + 1; i < images.length; i++) {
                    if (!(await isImageCompleteOnServer(images[i], projectName, nPointsRequired))) {
                        console.log(`✅ Trouvée à index ${i}, on la charge`);
                        indexToLoad = i;  // 🆕 Juste charger, PAS setCurrentImageIdx !
                        break;
                    }
                }

                // Si on arrive ici et indexToLoad === currentImageIdx, tout est complet
                if (indexToLoad === currentImageIdx) {
                    console.log(`✅ TOUTES LES IMAGES SONT COMPLÈTES!`);
                    return;
                }
            }
        } else {
            // 🆕 Reset le flag après usage
            setUserClickedImage(false);
        }

        // 2️⃣ L'image à charger n'est pas complète (ou user a cliqué), on la charge
        const img = new Image();
        img.src = `http://localhost:8000/image/${images[indexToLoad]}`;

        // 3️⃣ Callback quand l'image est chargée
        img.onload = async () => {
            imgRef.current = img;
            setZoom(1);
            setOffset({ x: 0, y: 0 });

            // Reset ROI
            setRoiBox(null);
            roiAnchorRef.current = null;
            roiLiveRef.current = null;
            roiPhaseRef.current = "idle";

            // Reset multiselect
            setShowMultiselectBox(null);
            msAnchorRef.current = null;
            msLiveRef.current = null;
            msPhaseRef.current = "idle";
            setSelectedPointIds(new Set());

            // Reset timings
            imageStartRef.current = Date.now();
            roiDurationRef.current = null;
            pointTimingsRef.current = [];

            // Set tool
            setTool("roi");
            roiStartRef.current = Date.now();

            // 4️⃣ Charger les masks si nécessaire
            if (showMasks) {
                try {
                    const res = await fetch(
                        `http://localhost:8000/masks?name=${encodeURIComponent(images[indexToLoad])}&model=${segModel}&pred_model=${predModel}`
                    );
                    const data = await res.json();
                    const enriched = (data.masks || []).map(m => ({
                        ...m,
                        label: null,
                        prediction: randomPrediction(),
                    }));
                    masksRef.current = enriched;
                    setMasks(enriched);
                } catch {
                    masksRef.current = [];
                    setMasks([]);
                }
            } else {
                masksRef.current = [];
                setMasks([]);
            }

            // 5️⃣ Charger les points si nécessaire
            if (showPoints) {
                const imageName = images[indexToLoad];  // 🆕 Utilise indexToLoad
                const n = Math.max(1, Number(config?.n_points ?? 10));

                // Vérifier le cache
                const cached = annotationCache?.[imageName];
                if (cached && cached.points && cached.points.length > 0) {
                    console.log(`✅ Restauration depuis cache pour: ${imageName}`);

                    if (cached.roi) {
                        setRoiBox(cached.roi);
                    }

                    const cachedPoints = cached.points;
                    const annotated = cachedPoints.filter(p => p.label != null);
                    const unannotated = cachedPoints.filter(p => p.label == null);

                    const missing = n - cachedPoints.length;

                    let finalPoints = [...cachedPoints];

                    if (missing > 0 || unannotated.length > 0) {
                        const toGenerate = missing > 0 ? missing : 0;

                        if (toGenerate > 0) {
                            const roi = cached.roi;
                            const minX = roi ? Math.min(roi.x1, roi.x2) : 0;
                            const maxX = roi ? Math.max(roi.x1, roi.x2) : img.width;
                            const minY = roi ? Math.min(roi.y1, roi.y2) : 0;
                            const maxY = roi ? Math.max(roi.y1, roi.y2) : img.height;

                            let newPts = Array.from({ length: toGenerate }, (_, i) => ({
                                id: `pt_${Date.now()}_${i}`,
                                ix: minX + Math.random() * (maxX - minX),
                                iy: minY + Math.random() * (maxY - minY),
                                label: null,
                                prediction: null,
                                maskId: null,
                            }));

                            newPts = await fetchPredictions(newPts);
                            if (isHybrid) newPts = assignMaskIds(newPts, masksRef.current);

                            finalPoints = [...annotated, ...unannotated, ...newPts];
                        }
                    }

                    finalPoints = reassignPointIds(finalPoints);

                    pointsRef.current = finalPoints;
                    setPoints(finalPoints);
                    drawWithState(zoomRef.current, offsetRef.current);
                    forceUpdate(v => v + 1);
                    return;
                }

                // Charger depuis le serveur
                try {
                    const [annRes, roiRes] = await Promise.all([
                        fetch(
                            `http://localhost:8000/annotations` +
                            `?name=${encodeURIComponent(imageName)}` +
                            `&project=${encodeURIComponent(projectName)}`
                        ),
                        fetch(
                            `http://localhost:8000/get-roi` +
                            `?image_name=${encodeURIComponent(imageName)}`
                        ),
                    ]);

                    let roiBoxLoaded = null;
                    if (roiRes.ok) {
                        const roiData = await roiRes.json();
                        const roiObj = roiData?.roi ?? (roiData?.x1 != null ? roiData : null);
                        if (roiObj?.x1 != null) {
                            roiBoxLoaded = roiObj;
                            setRoiBox(roiBoxLoaded);
                        }
                    }

                    if (annRes.ok) {
                        const data = await annRes.json();
                        console.log(`📥 Annotations chargées pour ${imageName}:`, data);

                        let savedPoints = [];
                        if (Array.isArray(data)) {
                            savedPoints = data;
                        } else if (data?.points && Array.isArray(data.points)) {
                            savedPoints = data.points;
                        } else if (data?.annotations && Array.isArray(data.annotations)) {
                            savedPoints = data.annotations;
                        }

                        savedPoints = savedPoints.map(p => ({
                            id: p.id ?? p.point_id ?? 0,
                            ix: p.ix ?? parseFloat(p.column) ?? 0,
                            iy: p.iy ?? parseFloat(p.row) ?? 0,
                            label: p.label ?? null,
                            prediction: p.prediction ?? null,
                            maskId: p.maskId ?? null,
                        }));

                        console.log(`🔍 Points trouvés: ${savedPoints.length}`, savedPoints);

                        if (savedPoints.length > 0) {
                            let annotated = savedPoints
                                .filter(p => p.label != null)
                                .map(p => ({
                                    ...p,
                                    prediction: null,
                                    maskId: null,
                                }));
                            const nAnnotated = annotated.length;
                            const nToGen = Math.max(0, n - nAnnotated);

                            console.log(`📊 Annotés: ${nAnnotated}, À générer: ${nToGen}`);

                            annotated = await fetchPredictions(annotated);
                            if (isHybrid) annotated = assignMaskIds(annotated, masksRef.current);

                            let newPts = [];
                            if (nToGen > 0) {
                                const minX = roiBoxLoaded ? Math.min(roiBoxLoaded.x1, roiBoxLoaded.x2) : 0;
                                const maxX = roiBoxLoaded ? Math.max(roiBoxLoaded.x1, roiBoxLoaded.x2) : img.width;
                                const minY = roiBoxLoaded ? Math.min(roiBoxLoaded.y1, roiBoxLoaded.y2) : 0;
                                const maxY = roiBoxLoaded ? Math.max(roiBoxLoaded.y1, roiBoxLoaded.y2) : img.height;

                                newPts = Array.from({ length: nToGen }, (_, i) => ({
                                    id: `pt_${Date.now()}_${i}`,
                                    ix: minX + Math.random() * (maxX - minX),
                                    iy: minY + Math.random() * (maxY - minY),
                                    label: null,
                                    prediction: null,
                                    maskId: null,
                                }));

                                newPts = await fetchPredictions(newPts);
                                if (isHybrid) newPts = assignMaskIds(newPts, masksRef.current);
                            }

                            let finalPoints = [...annotated, ...newPts];
                            finalPoints = reassignPointIds(finalPoints);

                            pointsRef.current = finalPoints;
                            setPoints(finalPoints);
                            saveToCache(imageName, finalPoints, roiBoxLoaded);
                            console.log(`✅ Points chargés et mis en cache: ${finalPoints.length}`);
                        } else {
                            console.log(`⚠️ Aucun point trouvé, génération...`);
                            await generatePoints(img, zoomRef.current, offsetRef.current, roiBoxLoaded);
                        }
                    } else {
                        console.log(`⚠️ Erreur serveur (${annRes.status}), génération des points`);
                        await generatePoints(img, zoomRef.current, offsetRef.current, roiBoxLoaded);
                    }
                } catch (e) {
                    console.error("❌ Erreur chargement annotations :", e);
                    await generatePoints(img, zoomRef.current, offsetRef.current);
                }
            }

            drawWithState(zoomRef.current, offsetRef.current);
            forceUpdate(v => v + 1);
        };

        img.onerror = () => {
            console.error(`❌ Erreur chargement image: ${images[indexToLoad]}`);
        };
    };

    // ✅ Lancer la fonction
    loadImage();

    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [images, currentImageIdx, mode, segModel, predModel, projectName, config, showMasks, showPoints]);

    useEffect(() => { drawWithState(zoomRef.current, offsetRef.current); }, [masks, points, drawWithState]);
    useEffect(() => { drawWithState(zoom, offset); }, [zoom, offset, drawWithState]);

    useEffect(() => {
        const canvas  = canvasRef.current;
        const prevent = (e) => e.preventDefault();
        canvas.addEventListener("wheel", prevent, { passive: false });
        return () => canvas.removeEventListener("wheel", prevent);
    }, []);

    useEffect(() => {
        function onKey(e) {
            if (e.key !== "Escape") return;
            if (roiPhaseRef.current !== "idle") {
                roiPhaseRef.current  = "idle";
                roiAnchorRef.current = null;
                roiLiveRef.current   = null;
                drawWithState(zoomRef.current, offsetRef.current);
            } else if (msPhaseRef.current !== "idle") {
                msPhaseRef.current  = "idle";
                msAnchorRef.current = null;
                msLiveRef.current   = null;
                setSelectedPointIds(new Set());
                drawWithState(zoomRef.current, offsetRef.current);
            } else if (tool === "roi") {
                setTool("pan");
            } else if (tool === "multiselect") {
                setTool("pan");
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tool, drawWithState]);

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

    // ── hit-test ──────────────────────────────────────────────────────────────

    function hitTest(cx, cy, t, z, off) {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return null;
        ctx.font = PILL_FONT;
        if (showPoints) {
            for (const pt of pointsRef.current) {
                const { cx: px, cy: py } = imgToCanvas(pt.ix, pt.iy, t, z, off);
                if (Math.hypot(cx - px, cy - py) <= POINT_RADIUS + 2) return { type: "point", id: pt.id };
                const txt = pt.label ?? `~ ${pt.prediction ?? ""}`;
                const tw  = ctx.measureText(txt).width;
                const pw  = tw + PILL_PADDING_X * 2, ph = 14 + PILL_PADDING_Y * 2;
                const pillX = px + POINT_RADIUS + PILL_OFFSET_X, pillY = py - ph / 2;
                if (cx >= pillX && cx <= pillX + pw && cy >= pillY && cy <= pillY + ph)
                    return { type: "point", id: pt.id };
            }
        }
        if (showMasks) {
            for (const mask of masksRef.current) {
                for (const poly of mask.polygons) {
                    if (!poly || poly.length < 3) continue;
                    const cp = poly.map(([x, y]) => { const p = imgToCanvas(x, y, t, z, off); return [p.cx, p.cy]; });
                    if (pointInPolygon(cx, cy, cp)) return { type: "mask", id: mask.id };
                }
            }
        }
        return null;
    }

    // ── zoom to item ──────────────────────────────────────────────────────────

    function zoomToItem(hit) {
        const canvas = canvasRef.current;
        const cW = canvas.width, cH = canvas.height, MAX_ZOOM = 5;
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
        const t = computeTransform(cW, cH, imgRef.current.width, imgRef.current.height);
        const bx = t.baseX + ix * t.fitScale, by = t.baseY + iy * t.fitScale;
        setZoom(MAX_ZOOM);
        setOffset({ x: cW / 2 - bx * MAX_ZOOM, y: cH / 2 - by * MAX_ZOOM });
    }

    // ── wheel ─────────────────────────────────────────────────────────────────

    function handleWheel(e) {
        e.preventDefault();
        const rect   = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
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

    // ── ROI mouse logic ───────────────────────────────────────────────────────

    function roiMouseDown(cx, cy) {
        const img = canvasToImg(cx, cy, transformRef.current, zoom, offset);
        if (roiPhaseRef.current === "idle") {
            roiAnchorRef.current = img;
            roiLiveRef.current   = img;
            roiPhaseRef.current  = "dragging";
            setRoiBox(null);
        } else if (roiPhaseRef.current === "first_placed") {
            roiCommit(img);
            saveToCache(images[currentImageIdx], pointsRef.current, roiBoxRef.current);
        }
    }

    function roiMouseMove(cx, cy) {
        if (roiPhaseRef.current === "idle") return;
        const img = canvasToImg(cx, cy, transformRef.current, zoomRef.current, offsetRef.current);
        roiLiveRef.current = img;
        drawWithState(zoomRef.current, offsetRef.current);
    }

    function roiMouseUp(cx, cy) {
        if (roiPhaseRef.current !== "dragging") return;
        const img    = canvasToImg(cx, cy, transformRef.current, zoomRef.current, offsetRef.current);
        const anchor = roiAnchorRef.current;
        const t      = transformRef.current;

        const aCanvas = imgToCanvas(anchor.ix, anchor.iy, t, zoomRef.current, offsetRef.current);
        const dist    = Math.hypot(cx - aCanvas.cx, cy - aCanvas.cy);

        if (dist > 8) {
            roiCommit(img);
            saveToCache(images[currentImageIdx], pointsRef.current, roiBoxRef.current);
        } else {
            roiPhaseRef.current = "first_placed";
            roiLiveRef.current  = img;
            drawWithState(zoomRef.current, offsetRef.current);
        }
    }

    function roiCommit(img) {
        const anchor = roiAnchorRef.current;
        const w = Math.abs(img.ix - anchor.ix), h = Math.abs(img.iy - anchor.iy);
        if (w > 3 && h > 3) {
            const box = { x1: anchor.ix, y1: anchor.iy, x2: img.ix, y2: img.iy };
            setRoiBox(box);
            roiPhaseRef.current  = "idle";
            roiAnchorRef.current = null;
            roiLiveRef.current   = null;
            if (roiStartRef.current !== null) {
                roiDurationRef.current = Date.now() - roiStartRef.current;
                roiStartRef.current    = null;
            }
            setTool("pan");
            if (imgRef.current) {
                generatePoints(imgRef.current, zoomRef.current, offsetRef.current, box);
            }
        } else {
            roiPhaseRef.current  = "idle";
            roiAnchorRef.current = null;
            roiLiveRef.current   = null;
            drawWithState(zoomRef.current, offsetRef.current);
        }
    }

    // ── MULTISELECT mouse logic ─────────────────────────────────────────────────

    function msMouseDown(cx, cy) {
        const img = canvasToImg(cx, cy, transformRef.current, zoom, offset);
        if (msPhaseRef.current === "idle") {
            msAnchorRef.current = img;
            msLiveRef.current   = img;
            msPhaseRef.current  = "dragging";
            setShowMultiselectBox(null);
        } else if (msPhaseRef.current === "first_placed") {
            msCommit(img);
        }
    }

    function msMouseMove(cx, cy) {
        if (msPhaseRef.current === "idle") return;
        const img = canvasToImg(cx, cy, transformRef.current, zoomRef.current, offsetRef.current);
        msLiveRef.current = img;
        updateSelectedPoints(msAnchorRef.current.ix, msAnchorRef.current.iy, img.ix, img.iy);
        drawWithState(zoomRef.current, offsetRef.current);
    }

    function msMouseUp(cx, cy) {
        if (msPhaseRef.current !== "dragging") return;
        const img    = canvasToImg(cx, cy, transformRef.current, zoomRef.current, offsetRef.current);
        const anchor = msAnchorRef.current;
        const t      = transformRef.current;

        const aCanvas = imgToCanvas(anchor.ix, anchor.iy, t, zoomRef.current, offsetRef.current);
        const dist    = Math.hypot(cx - aCanvas.cx, cy - aCanvas.cy);

        if (dist > 8) {
            msCommit(img);
        } else {
            msPhaseRef.current = "first_placed";
            msLiveRef.current  = img;
            updateSelectedPoints(anchor.ix, anchor.iy, img.ix, img.iy);
            drawWithState(zoomRef.current, offsetRef.current);
        }
    }

    function msCommit(img) {
        const anchor = msAnchorRef.current;
        const w = Math.abs(img.ix - anchor.ix), h = Math.abs(img.iy - anchor.iy);

        if (w > 3 && h > 3) {
            const box = { x1: anchor.ix, y1: anchor.iy, x2: img.ix, y2: img.iy };
            multiselectBoxRef.current = box;
            setShowMultiselectBox(box);

            msPhaseRef.current  = "idle";
            msAnchorRef.current = null;
            msLiveRef.current   = null;

            const canvas = canvasRef.current;
            const t = transformRef.current;

            const centerX = (box.x1 + box.x2) / 2;
            const centerY = (box.y1 + box.y2) / 2;

            const { cx, cy } = imgToCanvas(centerX, centerY, t, zoomRef.current, offsetRef.current);

            setDropdownPos({
                x: cx,
                y: cy
            });

            drawWithState(zoomRef.current, offsetRef.current);
        } else {
            msPhaseRef.current  = "idle";
            msAnchorRef.current = null;
            msLiveRef.current   = null;
            setSelectedPointIds(new Set());
            drawWithState(zoomRef.current, offsetRef.current);
        }
    }

    // ── mouse handlers ────────────────────────────────────────────────────────

    function handleMouseDown(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;

        const hit = hitTest(cx, cy, transformRef.current, zoom, offset);

        if (hit !== null) {
            if (tool === "multiselect") {
                clearMultiselect();
            }

            if (tool === "roi") {
                roiPhaseRef.current  = "idle";
                roiAnchorRef.current = null;
                roiLiveRef.current   = null;
            }

            setTool("pan");
            return;
        }

        if (tool === "roi") {
            roiMouseDown(cx, cy);
            return;
        }

        if (tool === "multiselect") {
            msMouseDown(cx, cy);
            return;
        }

        setDropdown(null);
        setIsDragging(true);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseMove(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        if (tool === "roi") { roiMouseMove(cx, cy); return; }
        if (tool === "multiselect") { msMouseMove(cx, cy); return; }
        const hovered = hitTest(cx, cy, transformRef.current, zoom, offset);
        const prev    = hoveredRef.current;
        if (hovered?.type !== prev?.type || hovered?.id !== prev?.id) {
            hoveredRef.current = hovered;
            drawWithState(zoom, offset);
        }
        if (!isDragging) return;
        const dx = e.clientX - lastMousePos.current.x, dy = e.clientY - lastMousePos.current.y;
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    function handleMouseUp(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        if (tool === "roi") { roiMouseUp(cx, cy); return; }
        if (tool === "multiselect") { msMouseUp(cx, cy); return; }
        if (isDragging) { setIsDragging(false); return; }
        const hit = hitTest(cx, cy, transformRef.current, zoom, offset);
        if (hit !== null) {
            if (autoZoom && !e.shiftKey) zoomToItem(hit);
            const raw = { x: cx + PADDING, y: cy + PADDING };
            setDropdownPos({
                x: Math.min(raw.x, 600 + PADDING * 2 - DROPDOWN_W - 4),
                y: cy + PADDING + DROPDOWN_MAX_H > 400 + PADDING * 2 ? raw.y - DROPDOWN_MAX_H : raw.y,
            });
            setDropdown({ type: hit.type, id: hit.id });
            if (hit.type === "point") {
                pointStartRef.current = Date.now();
                pointOpenIdRef.current = hit.id;
            }
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

    // ── confirm label ─────────────────────────────────────────────────────────

    function confirmLabel(type, id, label) {
        if (type === "point" && pointStartRef.current !== null && pointOpenIdRef.current === id) {
            const ms = Date.now() - pointStartRef.current;
            const pt = pointsRef.current.find(p => p.id === id);
            pointTimingsRef.current.push({
                point_id:    id,
                ms,
                accepted_ai: pt?.prediction === label,
            });
            pointStartRef.current  = null;
            pointOpenIdRef.current = null;
        }
        if (type === "point") {
            let updated = pointsRef.current.map(p => p.id === id ? { ...p, label } : p);
            if (isHybrid) {
                const clicked = updated.find(p => p.id === id);
                if (clicked?.maskId != null) {
                    updated = updated.map(p =>
                        p.maskId === clicked.maskId && p.id !== id && p.label == null ? { ...p, label } : p
                    );
                }
            }
            pointsRef.current = updated; setPoints(updated);
        } else {
            const updated = masksRef.current.map(m => m.id === id ? { ...m, label } : m);
            masksRef.current = updated; setMasks(updated);
        }

        // 🆕 Auto-advance to next point in sequence with auto-zoom
        if (type === "point") {
            const nextId = getNextPointId(id);
            if (nextId !== null) {
                const nextPt = pointsRef.current.find(p => p.id === nextId);
                if (nextPt) {
                    // 🆕 Auto-zoom to next point if autoZoom is enabled
                    if (autoZoom) {
                        zoomToItem({ type: "point", id: nextId });
                    }

                    const t = transformRef.current;
                    const { cx, cy } = imgToCanvas(nextPt.ix, nextPt.iy, t, zoomRef.current, offsetRef.current);
                    setDropdownPos({
                        x: Math.min(cx + PADDING, 600 + PADDING * 2 - DROPDOWN_W - 4),
                        y: cy + PADDING + DROPDOWN_MAX_H > 400 + PADDING * 2 ? cy + PADDING - DROPDOWN_MAX_H : cy + PADDING,
                    });
                    setDropdown({ type: "point", id: nextId });
                    pointStartRef.current = Date.now();
                    pointOpenIdRef.current = nextId;
                }
            } else {
                setDropdown(null);
            }
        } else {
            setDropdown(null);
        }

        forceUpdate(v => v + 1);
    }

    // ── confirm label for multiple selected points ───────────────────────────────

    function confirmLabelMultiple(label) {
        let updated = pointsRef.current.map(p =>
            selectedPointIds.has(p.id) ? { ...p, label } : p
        );
        pointsRef.current = updated;
        setPoints(updated);
        setSelectedPointIds(new Set());
        setShowMultiselectBox(null);
        multiselectBoxRef.current = null;
        setDropdown(null);
        drawWithState(zoomRef.current, offsetRef.current);
        forceUpdate(v => v + 1);
    }

    // ── regen ─────────────────────────────────────────────────────────────────

    async function handleRegenerate() {
        if (imgRef.current) await generatePoints(imgRef.current, zoomRef.current, offsetRef.current);
    }

    // ── ROI helpers ───────────────────────────────────────────────────────────

    function clearRoi() {
        setRoiBox(null);
        roiPhaseRef.current  = "idle";
        roiAnchorRef.current = null;
        roiLiveRef.current   = null;
        drawWithState(zoomRef.current, offsetRef.current);
    }

    function clearMultiselect() {
        setShowMultiselectBox(null);
        multiselectBoxRef.current = null;
        msPhaseRef.current  = "idle";
        msAnchorRef.current = null;
        msLiveRef.current   = null;
        setSelectedPointIds(new Set());
        drawWithState(zoomRef.current, offsetRef.current);
    }

    async function handleAiTrace() {
        try {
            const res  = await fetch(`http://localhost:8000/suggest-roi?name=${encodeURIComponent(images[currentImageIdx])}`, { method: "POST" });
            if (!res.ok) return;
            const data = await res.json();
            if (data?.x1 != null) { setRoiBox(data); drawWithState(zoomRef.current, offsetRef.current); }
        } catch {}
    }

    // ── expose timing snapshot for ControlPanel ──────────────────────────────
    function getTimingSnapshot() {
        const roi = roiBoxRef.current;
        return {
            whole_image_ms: imageStartRef.current !== null
                ? Date.now() - imageStartRef.current
                : null,
            roi_draw_ms:    roiDurationRef.current,
            roi_used:       roiBoxRef.current !== null,
            roi: roi
            ? {
                x1: roi.x1,
                y1: roi.y1,
                x2: roi.x2,
                y2: roi.y2
            }
            : null,
            point_timings:  [...pointTimingsRef.current],
        };
    }

    useEffect(() => {
        if (wrapperRef.current) {
            wrapperRef.current.__getTimingSnapshot = getTimingSnapshot;
        }
    });

    useEffect(() => {
        if (wrapperRef.current) {
            wrapperRef.current.__saveCurrentToCache = () => {
                saveToCache(
                    images[currentImageIdx],
                    pointsRef.current,
                    roiBoxRef.current
                );
            };
        }
    });

    function getDropdownItem() {
        if (!dropdown) return null;
        return dropdown.type === "point"
            ? pointsRef.current.find(p => p.id === dropdown.id) ?? null
            : masksRef.current.find(m => m.id === dropdown.id) ?? null;
    }

    function getFilteredLabels() {
    const sorted = getSortedLabels();
    const item   = getDropdownItem();
    let base = sorted;

    // 🆕 D'abord ajoute le ranking (top 5)
    if (item?.ranking && item.ranking.length > 0) {
        const rankingCodes = item.ranking.map(r => r.label);
        const ranked = item.ranking.map(r => ({
            code: r.label,
            name: r.label,  // 🆕 Ajoute name
            display: `${r.label} (${(r.score * 100).toFixed(1)}%)`,
            isRanking: true,
            score: r.score
        }));
        const others = sorted.filter(l => !rankingCodes.includes(l.code));
        base = [...ranked, ...others];
    } else if (item?.prediction) {
        // Fallback ancien comportement
        const pred   = base.find(l => l.code === item.prediction);
        const others = base.filter(l => l.code !== item.prediction);
        base = pred ? [pred, ...others] : base;
    }

    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter(l =>
        (l.code?.toLowerCase?.() || "").includes(s) ||
        (l.name?.toLowerCase?.() || "").includes(s)
    );
}



    function siblingCount(ptId) {
        const pt = pointsRef.current.find(p => p.id === ptId);
        if (!pt?.maskId) return 0;
        return pointsRef.current.filter(p => p.maskId === pt.maskId && p.id !== ptId && p.label == null).length;
    }

    function saveToCache(imageName, points, roi) {
        setAnnotationCache(prev => ({
            ...prev,
            [imageName]: {
                points: points.map(p => ({ ...p })),
                roi: roi ? { ...roi } : null
            }
        }));
    }


    const roiActive        = tool === "roi";
    const multiselectActive = tool === "multiselect";
    const cursor    = roiActive || multiselectActive ? "crosshair" : isDragging ? "grabbing" : hoveredRef.current ? "pointer" : "grab";

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {/* toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                {showPoints && (
                    <button onClick={handleRegenerate} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontSize: 13 }}>
                        🎲 Regenerate {config?.n_points ?? 10} pts
                    </button>
                )}
                <button onClick={() => setAutoZoom(v => !v)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: autoZoom ? "#dbeafe" : "#f9fafb", color: autoZoom ? "#1d4ed8" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                    🔍 Auto-zoom {autoZoom ? "ON" : "OFF"}
                </button>
                {/* 🆕 Toggle labels button */}
                <button onClick={() => setShowLabels(v => !v)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: showLabels ? "#f0fdf4" : "#f9fafb", color: showLabels ? "#166534" : "#9ca3af", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                    🏷️ Labels {showLabels ? "ON" : "OFF"}
                </button>
                {showMasks && <span style={{ fontSize: 12, padding: "3px 8px", background: "#ede9fe", color: "#5b21b6", borderRadius: 4, border: "1px solid #c4b5fd" }}>🧩 {masks.length} masks</span>}
                {isHybrid && (
                    <button onClick={() => setShowMaskOverlay(v => !v)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: showMaskOverlay ? "#f0fdf4" : "#f9fafb", color: showMaskOverlay ? "#166534" : "#9ca3af", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                        🗺️ Masks {showMaskOverlay ? "ON" : "OFF"}
                    </button>
                )}

                {/* ROI buttons */}
                <button
                    onClick={() => {
                        if (roiActive) {
                            setTool("pan");
                            roiPhaseRef.current  = "idle";
                            roiAnchorRef.current = null;
                            roiLiveRef.current   = null;
                            roiStartRef.current  = null;
                            drawWithState(zoomRef.current, offsetRef.current);
                        } else {
                            setTool("roi");
                            roiStartRef.current = Date.now();
                        }
                    }}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: roiActive ? "#ede9fe" : "#f9fafb", color: roiActive ? "#5b21b6" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                >
                    ✏️ {roiActive
                        ? roiPhaseRef.current === "first_placed" ? "Click 2nd corner…" : "Drag or click… (Esc)"
                        : roiBox ? "Edit ROI" : "Draw ROI"}
                </button>

                {roiBox && !roiActive && (
                    <>
                        <button onClick={clearRoi} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 12 }}>
                            ✕ Clear ROI
                        </button>
                    </>
                )}

                {/* MULTISELECT button */}
                <button
                    onClick={() => {
                        if (multiselectActive) {
                            setTool("pan");
                            msPhaseRef.current  = "idle";
                            msAnchorRef.current = null;
                            msLiveRef.current   = null;
                            setSelectedPointIds(new Set());
                            drawWithState(zoomRef.current, offsetRef.current);
                        } else {
                            setTool("multiselect");
                        }
                    }}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: multiselectActive ? "#f0fdf4" : "#f9fafb", color: multiselectActive ? "#166534" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                >
                    🔲 {multiselectActive
                        ? msPhaseRef.current === "first_placed" ? "Click 2nd corner…" : "Drag or click… (Esc)"
                        : showMultiselectBox && selectedPointIds.size > 0 ? `Edit Selection (${selectedPointIds.size})` : "Select Multiple"}
                </button>

                {showMultiselectBox && !multiselectActive && selectedPointIds.size > 0 && (
                    <>
                        <button onClick={clearMultiselect} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 12 }}>
                            ✕ Clear Selection
                        </button>
                    </>
                )}

                <span style={{ fontSize: 11, color: "#6b7280" }}>
                    {roiActive
                        ? roiPhaseRef.current === "first_placed"
                            ? "Click anywhere for 2nd corner"
                            : "Hold & drag  —or—  click 1st corner"
                        : multiselectActive
                        ? msPhaseRef.current === "first_placed"
                            ? "Click anywhere for 2nd corner"
                            : "Hold & drag  —or—  click 1st corner"
                        : "scroll · drag · click to label"}
                </span>
            </div>

            {/* canvas */}
            <div ref={wrapperRef} style={{ padding: PADDING, background: "#f5f5f5", borderRadius: 8, boxShadow: "inset 0 1px 4px rgba(0,0,0,.08)", overflow: "hidden", position: "relative", cursor }}
                onMouseEnter={() => setIsHoveringCanvas(true)}
                onMouseLeave={() => { setIsHoveringCanvas(false); handleMouseLeave(); }}
            >
                <canvas ref={canvasRef} width={600} height={400}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    style={{ border: "1px solid #d1d5db", borderRadius: 4, display: "block" }}
                />

                {/* Multiselect bulk label dropdown */}
{showMultiselectBox && selectedPointIds.size > 0 && (() => {
const filtered = getFilteredLabels();
return (
                        <div onMouseDown={e => e.stopPropagation()} style={{ position: "absolute", left: dropdownPos?.x || 50, top: dropdownPos?.y || 50, width: DROPDOWN_W, background: "#fff", border: "2px solid #22c55e", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,.18)", zIndex: 20, overflow: "hidden", userSelect: "none" }}>
                            <div style={{ padding: "6px 10px", background: "#f0fdf4", borderBottom: "1px solid #86efac", fontSize: 11, color: "#166534", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600 }}>
                                <span>🔲 Label {selectedPointIds.size} points</span>
                                <span onMouseDown={e => { e.stopPropagation(); clearMultiselect(); }} style={{ cursor: "pointer", fontSize: 13, color: "#22c55e" }}>✕</span>
                            </div>
                            <div style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>
                                <input autoFocus placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "3px 7px", border: "1px solid #e2e8f0", borderRadius: 4, outline: "none" }} />
                            </div>
                            <div style={{ maxHeight: DROPDOWN_MAX_H - 70, overflowY: "auto" }}>
                                {filtered.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "#9ca3af" }}>No match</div>}
                                {filtered.map(({ code, display }) => (
                                    <div key={code} onClick={() => {confirmLabelMultiple(code);
                                        saveToCache(images[currentImageIdx], pointsRef.current, roiBoxRef.current);
                                    }}
                                        style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "#1e293b", fontWeight: 400, borderLeft: "3px solid transparent" }}
                                        onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                                    >
                                        <span style={{ flex: 1 }}>{display}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                {/* Single item dropdown (original) */}
                {dropdown && dropdownPos && (() => {
                    const item     = getDropdownItem();
                    if (!item) return null;
                    const filtered = getFilteredLabels();
                    const title    = dropdown.type === "point" ? `Point #${dropdown.id}` : `Mask #${dropdown.id}`;
                    const siblings = isHybrid && dropdown.type === "point" ? siblingCount(dropdown.id) : 0;
                    return (
                        <div onMouseDown={e => e.stopPropagation()} style={{ position: "absolute", left: dropdownPos.x, top: dropdownPos.y, width: DROPDOWN_W, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,.18)", zIndex: 20, overflow: "hidden", userSelect: "none" }}>
                            <div onMouseDown={handleDdHeaderMouseDown} style={{ padding: "6px 10px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 11, color: "#64748b", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "grab" }}>
                                <span style={{ fontWeight: 600 }}>⠿ {title}</span>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    {item.prediction && <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>~ {labelsMap?.[item.prediction] ?? item.prediction}</span>}
                                    {siblings > 0 && <span style={{ fontSize: 9, padding: "1px 5px", background: "#fef9c3", borderRadius: 3, color: "#854d0e", border: "1px solid #fde68a" }}>+{siblings} in mask</span>}
                                    <span onMouseDown={e => { e.stopPropagation(); setDropdown(null); }} style={{ cursor: "pointer", fontSize: 13, color: "#94a3b8" }}>✕</span>
                                </div>
                            </div>
                            <div style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>
                                <input autoFocus placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "3px 7px", border: "1px solid #e2e8f0", borderRadius: 4, outline: "none" }} />
                            </div>
                            <div style={{ maxHeight: DROPDOWN_MAX_H - 70, overflowY: "auto" }}>
                                {filtered.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "#9ca3af" }}>No match</div>}
                                {filtered.map(({ code, display, isRanking }) => {  // 🆕 Ajoute isRanking ici
    const isActive = item.label === code, isPred = item.prediction === code;
    return (
        <div key={code} onClick={() => {
            confirmLabel(dropdown.type, dropdown.id, code);
            saveToCache(images[currentImageIdx], pointsRef.current, roiBoxRef.current);}}
            style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: isActive ? "#dcfce7" : isRanking ? "#fef3c7" : "transparent", color: isActive ? "#166534" : "#1e293b", fontWeight: isActive ? 600 : 400, borderLeft: isActive ? "3px solid #4ade80" : isRanking ? "3px solid #fcd34d" : "3px solid transparent" }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = isRanking ? "#fef9c3" : "#f1f5f9"; }}
            onMouseLeave={e => { e.currentTarget.style.background = isActive ? "#dcfce7" : isRanking ? "#fef3c7" : "transparent"; }}
        >
            <span style={{ flex: 1 }}>{display}</span>
            {isRanking && <span style={{ fontSize: 9, padding: "1px 4px", background: "#fcd34d", borderRadius: 3, color: "#92400e" }}>TOP</span>}  {/* 🆕 */}
            {isPred && !isRanking && <span style={{ fontSize: 9, padding: "1px 4px", background: "#e2e8f0", borderRadius: 3, color: "#64748b" }}>AI</span>}
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
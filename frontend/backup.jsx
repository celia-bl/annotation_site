import { useState, useRef, useEffect } from "react";

function generatePoints(width, height, n) {
  return Array.from({ length: n }, () => ({
    x: Math.random() * width,
    y: Math.random() * height
  }));
}

export default function App() {
    const [step, setStep] = useState(1);

    const [annotator, setAnnotator] = useState("");
    const [images, setImages] = useState([]);
    const [labels, setLabels] = useState([]);
    const [config, setConfig] = useState({
        in_sampling: "Point-based",
        n_points: 10,

    });
    const [currentImageIdx, setCurrentImageIdx] = useState(0);

    const [points, setPoints] = useState([]);
    const [predictions, setPredictions] = useState([]);
    const [annotations, setAnnotations] = useState([]);

    // IMAGE BROWSER
    const [showImageBrowser, setShowImageBrowser] = useState(false);
    const [imagePath, setImagePath] = useState("/home/");
    const [dirs, setDirs] = useState([]);

    // CSV BROWSER
    const [showCSVBrowser, setShowCSVBrowser] = useState(false);
    const [csvPath, setCsvPath] = useState("");
    const [files, setFiles] = useState([]);
    const [csvPreview, setCsvPreview] = useState([]);

    const canvasRef = useRef(null);
    const [selectedPoint, setSelectedPoint] = useState(null);
    const scaleRef = useRef(1)
    const [menuPos, setMenuPos] = useState(null);
    const cropCanvasRef = useRef(null);

    const PADDING = 40;
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isHoveringCanvas, setIsHoveringCanvas] = useState(false);

    // ================= BACKEND =================

    const loadFolder = (path, mode = "dirs") => {
        fetch(`http://localhost:8000/browse?path=${path}&mode=${mode}`)
            .then(res => res.json())
            .then(data => {
                if (mode === "dirs") {
                    setImagePath(data.path);
                    setDirs(data.dirs || []);
                }

                if (mode === "csv") {
                    setImagePath(data.path);
                    setDirs(data.dirs || []);
                    setFiles(data.files || []);
                }
            });
    };

    const selectImageFolder = () => {
        fetch(`http://localhost:8000/set-folder?path=${imagePath}`, {
            method: "POST"
        })
            .then(() => fetch("http://localhost:8000/images"))
            .then(res => res.json())
            .then(data => {
                setImages(data);
                setShowImageBrowser(false);
            });
    };

    const selectCSV = (file) => {
        const fullPath = imagePath + "/" + file;

        fetch(`http://localhost:8000/load-labels?path=${fullPath}`)
            .then(res => res.json())
            .then(data => {
                setLabels(data);
                setCsvPath(fullPath);
                setShowCSVBrowser(false);
            });

        // 🔥 LOAD CSV PREVIEW
        fetch(`http://localhost:8000/read-csv?path=${fullPath}`)
            .then(res => res.json())
            .then(data => {
                setCsvPreview(data.rows || []);
            });
    };

    // ================= DEFAULT LABELS =================
    useEffect(() => {
        fetch("http://localhost:8000/labels")
            .then(res => res.json())
            .then(setLabels);
    }, []);

    // ================= IMAGE LOGIC =================
    const imageName = images[currentImageIdx];
    const imageSrc = imageName
        ? `http://localhost:8000/image/${imageName}`
        : null;

    useEffect(() => {
        if (step !== 3 || !imageSrc) return;

        const img = new Image();
        img.src = imageSrc;

        img.onload = () => {
    const canvas = canvasRef.current;

    const MAX_WIDTH = 800;
    const MAX_HEIGHT = 600;

    const baseScale = Math.min(
        MAX_WIDTH / img.width,
        MAX_HEIGHT / img.height
    );

    baseScaleRef.current = baseScale;

    const pts = generatePoints(
        img.width,
        img.height,
        config.n_points || 10
    );

    setPoints(pts);
    setPredictions(
        pts.map(() =>
            labels[Math.floor(Math.random() * labels.length)]
        )
    );

    draw(img, pts);
};
    }, [step, currentImageIdx, imageSrc]);

    useEffect(() => {
        if (!imageSrc || points.length === 0) return;

        const img = new Image();
        img.src = imageSrc;

        img.onload = () => {
            draw(img, points);
        };
    }, [predictions, points, imageSrc, selectedPoint, zoom, offset]);

    useEffect(() => {
        if (selectedPoint === null) return;

        const selects = document.querySelectorAll("select");
        const select = selects[selectedPoint];

        if (select) {
            select.focus();
        }
    }, [selectedPoint]);
    useEffect(() => {
        if (selectedPoint !== null) {
            const label = predictions[selectedPoint] || "";
            console.log("Selected label:", label);
        }
    }, [selectedPoint]);

    useEffect(() => {
        if (selectedPoint === null || !imageSrc) return;

        const img = new Image();
        img.src = imageSrc;

        img.onload = () => {
            drawCrop(img, points[selectedPoint]);
        };
    }, [selectedPoint, imageSrc, points, predictions]);


const draw = (img, pts) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const baseScale = baseScaleRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // 🔥 centre + zoom
    const scaledWidth = img.width * baseScale * zoom;
    const scaledHeight = img.height * baseScale * zoom;

    const offsetX = (canvas.width - scaledWidth) / 2;
    const offsetY = (canvas.height - scaledHeight) / 2;

    ctx.translate(offsetX + offset.x, offsetY + offset.y);

    ctx.scale(baseScale * zoom, baseScale * zoom);

    // image
    ctx.drawImage(img, 0, 0);

    // points
    pts.forEach((p, i) => {
        const isSelected = i === selectedPoint;

        ctx.fillStyle = isSelected ? "yellow" : "red";
        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? 6 / (baseScale * zoom) : 4 / (baseScale * zoom), 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.fillText(i, p.x + 10 / (baseScale * zoom), p.y - 10 / (baseScale * zoom));
    });

    ctx.restore();
    // zoom box
    if (selectedPoint !== null) {
        const p = pts[selectedPoint];

        const x = p.x * scale + PADDING;
        const y = p.y * scale + PADDING;

        const ZOOM_SIZE = 100;

        ctx.strokeStyle = "cyan";
        ctx.lineWidth = 2;

        ctx.strokeRect(
            x - ZOOM_SIZE / 2,
            y - ZOOM_SIZE / 2,
            ZOOM_SIZE,
            ZOOM_SIZE
        );
    }
};
    const drawCrop = (img, point) => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !point) return;

    const ctx = canvas.getContext("2d");

    const SIZE = 224;
    const half = SIZE / 2;

    canvas.width = SIZE;
    canvas.height = SIZE;

    ctx.clearRect(0, 0, SIZE, SIZE);

    const sx = Math.max(0, point.x - half);
    const sy = Math.max(0, point.y - half);

    const sw = Math.min(SIZE, img.width - sx);
    const sh = Math.min(SIZE, img.height - sy);

    ctx.drawImage(
        img,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        SIZE,
        SIZE
    );
};
    const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // coord monde
    const x = (e.clientX - rect.left - offset.x) / zoom;
    const y = (e.clientY - rect.top - offset.y) / zoom;

    const threshold = 10 / zoom;

    let found = null;

    points.forEach((p, i) => {
        const dx = p.x - x;
        const dy = p.y - y;

        if (Math.sqrt(dx * dx + dy * dy) < threshold) {
            found = i;
        }
    });

    if (found !== null) {
        setSelectedPoint(found);
        setMenuPos({
            x:x,
            y:y,
            i:found
        })
    } else {
        setMenuPos(null);
    }
};

    const handleLabelChange = (i, label) => {
        setPredictions(prev => {
            const copy = [...prev];
            copy[i] = label;
            return copy;
        });
    };

  const handleWheel = (e) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const baseScale = baseScaleRef.current;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = 1.1;

    const newZoom =
        e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;

    const clampedZoom = Math.max(1, newZoom);

    setZoom(clampedZoom);
};
    // ================= STEP 1 =================
    if (step === 1) {
        return (
            <div>
                <h1>Setup</h1>

                <input
                    placeholder="Annotator ID"
                    value={annotator}
                    onChange={(e) => setAnnotator(e.target.value)}
                />

                <br/><br/>

                <button onClick={() => {
                    setShowImageBrowser(true);
                    loadFolder(imagePath, "dirs");
                }}>
                    📁 Browse images
                </button>

                <br/>
                <p>Folder path: {imagePath}</p>
                <p>Images: {images.length}</p>
                <br/>

                <button onClick={() => {
                    setShowCSVBrowser(true);
                    loadFolder(imagePath, "csv");
                }}>
                    📄 Browse CSV
                </button>

                <p>Labels: {labels.length}</p>
                <p>CSV: {csvPath}</p>

                <br/>

                <button
                    onClick={() => setStep(2)}
                    disabled={images.length === 0 || labels.length === 0}
                >
                    Next
                </button>

                {/* ================= IMAGE POPUP ================= */}
                {showImageBrowser && (
                    <div style={overlay}>
                        <div style={modal}>
                            <h3>📁 Images</h3>

                            <div>{imagePath}</div>

                            <button onClick={() => {
                                const parent = imagePath.split("/").slice(0, -1).join("/") || "/";
                                loadFolder(parent, "dirs");
                            }}>
                                ⬆️ Up
                            </button>

                            {dirs.map(d => (
                                <div
                                    key={d}
                                    onClick={() => loadFolder(imagePath + "/" + d, "dirs")}
                                    style={{cursor: "pointer"}}
                                >
                                    📁 {d}
                                </div>
                            ))}

                            <br/>

                            <button onClick={selectImageFolder}>✅ Select</button>
                            <button onClick={() => setShowImageBrowser(false)}>❌ Cancel</button>
                        </div>
                    </div>
                )}

                {/* ================= CSV POPUP ================= */}
                {showCSVBrowser && (
                    <div style={overlay}>
                        <div style={modal}>
                            <h3>📄 CSV</h3>

                            <div>{imagePath}</div>

                            <button onClick={() => {
                                const parent = imagePath.split("/").slice(0, -1).join("/") || "/";
                                loadFolder(parent, "csv");
                            }}>
                                ⬆️ Up
                            </button>

                            {/* folders */}
                            {dirs.map(d => (
                                <div
                                    key={d}
                                    onClick={() => loadFolder(imagePath + "/" + d, "csv")}
                                    style={{cursor: "pointer"}}
                                >
                                    📁 {d}
                                </div>
                            ))}

                            {/* csv files */}
                            {files.map(f => (
                                <div
                                    key={f}
                                    onClick={() => selectCSV(f)}
                                    style={{cursor: "pointer", color: "blue"}}
                                >
                                    📄 {f}
                                </div>
                            ))}

                            {/* PREVIEW */}
                            {csvPreview.length > 0 && (
                                <div style={{marginTop: "10px"}}>
                                    <h4>Preview</h4>

                                    <div style={{
                                        maxHeight: "200px",
                                        overflow: "auto",
                                        border: "1px solid #ccc",
                                        padding: "5px"
                                    }}>
                                        {csvPreview.slice(0, 20).map((row, i) => (
                                            <div key={i} style={{fontSize: "12px"}}>
                                                {row.join(" | ")}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <br/>

                            <button onClick={() => setShowCSVBrowser(false)}>❌ Cancel</button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ================= STEP 2 =================
    if (step === 2) {
        const PRESETS = {
            none: null,
            default: {
                sampling: "random",
                stop_criterion: "fixed_points",
                n_points: 10,
                in_sampling: "Point-based",
                ai_model: "CoralNet",
                frequency: 20,
                correction: "Uncertainty"
            }
        };

        const applyPreset = (presetName) => {
            const preset = PRESETS[presetName];
            if (!preset) return;

            setConfig(preset);
        };

        return (
            <div>
                <h1>Configuration</h1>

                {/* ---------- PRESET ---------- */}
                <div>
                    <label>Preset</label>
                    <select onChange={(e) => applyPreset(e.target.value)}>
                        {Object.keys(PRESETS).map(p => (
                            <option key={p}>{p}</option>
                        ))}
                    </select>
                </div>

                <br/>

                {/* ---------- SAMPLING ---------- */}
                <div>
                    <label>Sampling Strategy</label>
                    <select
                        value={config.sampling || ""}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, sampling: e.target.value}))
                        }
                    >
                        <option value="random">random</option>
                        <option value="active learning">active learning</option>
                    </select>
                </div>

                {/* ---------- STOP CRITERION ---------- */}
                <div>
                    <label>Stop Criterion</label>
                    <select
                        value={config.stop_criterion || ""}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, stop_criterion: e.target.value}))
                        }
                    >
                        <option value="none">none</option>
                        <option value="manual">Manual</option>
                        <option value="automatic">Automatic</option>
                    </select>
                </div>

                {/* ---------- IN SAMPLING ---------- */}
                <div>
                    <label>In-Image Sampling</label>
                    <select
                        value={config.in_sampling || ""}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, in_sampling: e.target.value}))
                        }
                    >
                        <option value="Point-based">Point-based</option>
                        <option value="Segmentation">Segmentation</option>
                    </select>
                </div>

                {/* ---------- N POINTS ---------- */}
                {config.in_sampling === "Point-based" && (
                    <div>
                        <label>Number of points</label>
                        <input
                            type="text"
                            value={config.n_points || ""}
                            onChange={(e) =>
                                setConfig(prev => ({
                                    ...prev,
                                    n_points: Number(e.target.value)
                                }))
                            }
                        />
                    </div>
                )}

                {/* ---------- AI MODEL ---------- */}
                <div>
                    <label>AI Model</label>
                    <select
                        value={config.ai_model || ""}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, ai_model: e.target.value}))
                        }
                    >
                        <option value="CoralNet">CoralNet</option>
                        <option value="other">...</option>
                    </select>
                </div>

                {/* ---------- FREQUENCY ---------- */}
                <div>
                    <label>Frequency Retraining</label>
                    <input
                        type="text"
                        value={config.frequency || 20}
                        onChange={(e) =>
                            setConfig(prev => ({
                                ...prev,
                                frequency: Number(e.target.value)
                            }))
                        }
                    />

                </div>

                {/* ---------- CORRECTION ---------- */}
                <div>
                    <label>Correction</label>
                    <select
                        value={config.correction || ""}
                        onChange={(e) =>
                            setConfig(prev => ({...prev, correction: e.target.value}))
                        }
                    >
                        <option value="Uncertainty">Uncertainty</option>
                        <option value="Random">Random</option>
                        <option value="Alphabetical">Alphabetical</option>
                        <option value="Hierarchical">Hierarchical</option>
                    </select>
                </div>

                <br/>

                {/* ---------- START ---------- */}
                <button
                    onClick={() => {
                        console.log("CONFIG:", config);
                        setStep(3);
                    }}
                >
                    🚀 Start Annotation
                </button>
            </div>
        );
    }

    // ================= STEP 3 =================
    // ================= STEP 3 =================
    return (
        <div style={{display: "flex", gap: "20px"}}>

            {/* LEFT : IMAGE + PADDING */}
            <div
                style={{
                    padding: `${PADDING}px`,
                    background: "#f5f5f5",
                    display: "inline-block"
                }}
            >
                <canvas ref={canvasRef}
                        onClick={handleCanvasClick}
                        onWheel={handleWheel}
                        onMouseEnter={()=> setIsHoveringCanvas(true)}
                        onMouseLeave={() => setIsHoveringCanvas(false)}/>
            </div>

            {/* RIGHT : PANEL */}
            <div style={{display: "flex", flexDirection: "column", gap: "10px"}}>

                {/* CROP VIEW */}
                {selectedPoint !== null && (
                    <div>
                        <h4>Zoom (224x224)</h4>
                        <canvas ref={cropCanvasRef}/>
                    </div>
                )}

                {/* LISTE DES POINTS */}
                {points.map((p, i) => (
                    <div
                        key={i}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px"
                        }}
                    >
                        <span style={{width: "25px"}}>{i}</span>

                        <select
                            value={predictions[i] || ""}
                            onChange={(e) => {
                                handleLabelChange(i, e.target.value);
                            }}
                            style={{
                                backgroundColor:
                                    selectedPoint === i ? "#ffeaa7" : "white"
                            }}
                        >
                            <option value="" disabled>
                                -- Select label --
                            </option>

                            {labels.map((l) => (
                                <option key={l} value={l}>
                                    {l}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}

                {/* MENU CONTEXTUEL */}
                {menuPos && (
                    <div
                        style={{
                            position: "fixed",
                            left: menuPos.x,
                            top: menuPos.y,
                            background: "white",
                            border: "1px solid black",
                            padding: "5px",
                            zIndex: 1000
                        }}
                    >
                        <select
                            value={predictions[menuPos.i] || ""}
                            onChange={(e) => {
                                handleLabelChange(menuPos.i, e.target.value);
                                setMenuPos(null);
                            }}
                        >
                            <option value="" disabled>
                                -- Select label --
                            </option>

                            {labels.map((l) => (
                                <option key={l} value={l}>
                                    {l}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* NEXT */}
                <button
                    onClick={() => {
                        setCurrentImageIdx((i) => i + 1);
                        setSelectedPoint(null);
                        setMenuPos(null);

                        // ⚠️ important : reset points + predictions
                        setPoints([]);
                        setPredictions([]);
                    }}
                >
                    Next
                </button>
            </div>
        </div>
    );
}

const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
};

const modal = {
    background: "white",
    padding: "20px",
    width: "500px",
  maxHeight: "80vh",
  overflow: "auto",
  borderRadius: "10px"
};
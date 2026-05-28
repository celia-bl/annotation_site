import { createContext, useContext, useState, useRef } from "react";

const AppContext = createContext();

export function AppProvider({ children }) {
    // ================= GLOBAL =================
    const [step, setStep] = useState(1);

    const [annotator, setAnnotator] = useState("");
    const [images, setImages] = useState([]);
    const [labelsMap, setLabelsMap] = useState({});
    const shortLabels = Object.keys(labelsMap); // ["CR", "SND", ...]

    const [config, setConfig] = useState({
        in_sampling: "Point-based",
        n_points: 10,
    });
    const [view, setView] = useState("list"); // "list" | "create" | "setup"
    const [selectedProject, setSelectedProject] = useState(null);


    const [currentImageIdx, setCurrentImageIdx] = useState(0);
    const [userClickedImage, setUserClickedImage] = useState(false);
    // ================= ANNOTATION =================
    const [points, setPoints]           = useState([]);
    const [masks,  setMasks]            = useState([]);   // ← shared masks
    const [predictions, setPredictions] = useState([]);
    const [annotations, setAnnotations] = useState([]);
    const [annotationCache, setAnnotationCache] = useState({});

    const [quickAccept, setQuickAccept] = useState(false);

    const [selectedPoint, setSelectedPoint] = useState(null);
    const [menuPos, setMenuPos]             = useState(null);
    const canvasWrapperRef = useRef(null); // ✅ CORRECT
    // ================= IMAGE / CSV =================
    const [imagePath, setImagePath]               = useState("/home");
    const [showImageBrowser, setShowImageBrowser] = useState(false);
    const [dirs, setDirs]                         = useState([]);

    const [csvPath, setCsvPath]                 = useState("");
    const [showCSVBrowser, setShowCSVBrowser]   = useState(false);
    const [files, setFiles]                     = useState([]);
    const [csvPreview, setCsvPreview]           = useState([]);
    const [projectName, setProjectName]                 = useState("");


    // ================= ZOOM / UI =================
    const [zoom, setZoom]                         = useState(1);
    const [offset, setOffset]                     = useState({ x: 0, y: 0 });
    const [isHoveringCanvas, setIsHoveringCanvas] = useState(false);
    const [segModel, setSegModel] = useState("sam");
    const [predModel, setPredModel] = useState("none");
    const [predModelPath, setPredModelPath] = useState(null); // chemin vers les weights .pt

    return (
        <AppContext.Provider
            value={{
                // global
                step, setStep,
                annotator, setAnnotator,
                images, setImages,
                labelsMap, setLabelsMap,
                shortLabels,
                config, setConfig,
                currentImageIdx, setCurrentImageIdx,
                userClickedImage, setUserClickedImage,
                view, setView,
                selectedProject, setSelectedProject,

                // annotation
                points, setPoints,
                masks,  setMasks,
                predictions, setPredictions,
                annotations, setAnnotations,
                annotationCache, setAnnotationCache,

                segModel, setSegModel,
                predModel, setPredModel,

                selectedPoint, setSelectedPoint,
                menuPos, setMenuPos,

                // image / csv
                imagePath, setImagePath,
                showImageBrowser, setShowImageBrowser,
                dirs, setDirs,

                csvPath, setCsvPath,
                showCSVBrowser, setShowCSVBrowser,
                files, setFiles,
                csvPreview, setCsvPreview,
                projectName, setProjectName,
                quickAccept, setQuickAccept,

                canvasWrapperRef,

                // zoom
                zoom, setZoom,
                offset, setOffset,
                isHoveringCanvas, setIsHoveringCanvas,
            }}
        >
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error("useAppContext must be used within AppProvider");
    }
    return context;
}
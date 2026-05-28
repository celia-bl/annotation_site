from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import csv
from fastapi import Query
from fastapi.responses import FileResponse
from processing_images import generate_masks
import datetime


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
import torch


# ── imports supplémentaires ────────────────────────────────────────────────────
import json
import numpy as np
from PIL import Image, ImageOps
from fastapi import BackgroundTasks

import random

def generate_points(n, width, height):
    return [
        {
            "id": i,
            "ix": random.random() * width,
            "iy": random.random() * height,
        }
        for i in range(n)
    ]
# ── état global du modèle ──────────────────────────────────────────────────────

_prediction_model   = None   # FeatureExtractorWithHead — None avant 1er training
_is_training        = False
_all_annotations    = []     # accumulées depuis le début
_freq               = 20     # mis à jour par /init-model
_labels_list        = []     # ["CR", "SND", ...]  (codes courts)
_labels_names       = []     # ["coral", "sand", ...]  (noms longs pour affichage)
LABELSET_PATH = None
_segmentation_cache = {}  # { image_name: masks }

# ── /init-model ───────────────────────────────────────────────────────────────

@app.post("/init-model")
def init_model(model_name: str = Query(...), frequency: int = Query(20)):
    """
    Appelé depuis Config → 'Start Annotation'.
    Charge les labels depuis LABELSET_PATH et note le modèle choisi.
    Le modèle lui-même est créé au premier training (pas de chargement au démarrage).
    """
    global _labels_list, _labels_names, _freq, _prediction_model, _all_annotations
    print("Initializing model...")
    if LABELSET_PATH is None or not os.path.exists(LABELSET_PATH):
        return {"error": "Labels not loaded — call /load-labels-json first"}

    with open(LABELSET_PATH, encoding="utf-8") as f:
        labels_map = json.load(f)   # { "CR": "coral", ... }

    _labels_list  = list(labels_map.keys())
    _labels_names = list(labels_map.values())
    _freq = frequency

    # Réinitialiser pour une nouvelle session
    _prediction_model = None
    _all_annotations  = []
    print(_freq)

    return {
        "status":    "ok",
        "model":     model_name,
        "n_labels":  len(_labels_list),
        "frequency": _freq,
    }


# ── /predict ──────────────────────────────────────────────────────────────────

from pydantic import BaseModel

class PredictRequest(BaseModel):
    name: str
    points: list

@app.post("/predict")
def predict_points(req: PredictRequest):
    global _prediction_model

    points = req.points
    name = req.name
    """
    Prédit les labels pour une liste de points.
    - Avant 1er training → retourne prediction: null pour chaque point
    - Après training     → utilise le MLP fine-tuné

    name   : nom du fichier image (dans IMAGE_FOLDER)
    points : JSON [{"id":0,"ix":120.5,"iy":340.2}, ...]
    """

    pts = points

    # ── pas encore de modèle entraîné → null ──────────────────────────────────
    if _prediction_model is None:
        return [{"id": p["id"], "prediction": None, "scores": {}} for p in pts]

    # ── inférence MLP ─────────────────────────────────────────────────────────
    full_path = os.path.join(IMAGE_FOLDER, name)
    if not os.path.exists(full_path):
        return [{"id": p["id"], "prediction": None, "scores": {}} for p in pts]

    image_np = np.array(Image.open(full_path).convert("RGB"))
    device   = next(_prediction_model.parameters()).device
    preproc  = _prediction_model.preprocess_val

    results = []
    for p in pts:
        patch  = _crop_patch(image_np, row=int(p["iy"]), col=int(p["ix"]))
        tensor = preproc(patch).unsqueeze(0).to(device)

        with torch.no_grad():
            logits = _prediction_model(tensor)
            probs  = torch.softmax(logits, dim=1)[0]

        pred_idx = probs.argmax().item()
        pred_code = _labels_list[pred_idx]

        # 🆕 Ranking : top 5 avec labels ET scores
        ranking = [
            {
                "label": _labels_list[i],
                "score": round(probs[i].item(), 4)
            }
            for i in range(len(_labels_list))
        ]
        ranking.sort(key=lambda x: x["score"], reverse=True)
        ranking = ranking[:5]  # Top 5

        results.append({"id": p["id"], "prediction": pred_code, "ranking": ranking})

    return results


# ── /save-annotations ─────────────────────────────────────────────────────────

DB = {}  # remplace par ta vraie DB


# 🆕 REPLACEMENT FOR /annotations ENDPOINT IN main.py
# Replace the existing @app.get("/annotations") with this code

@app.get("/annotations")
def get_annotations(name: str, project: str):
    """
    Lit les annotations depuis le CSV pour une image donnée.
    Retourne format: { points: [{ id, ix, iy, label, column, row }, ...] }

    Champs du CSV: image_name, row, column, label, annotator_id
    """
    global ANNOTATIONS_FILE

    # 🆕 Lire depuis ANNOTATIONS_FILE (défini lors du load-project)
    csv_path = ANNOTATIONS_FILE if ANNOTATIONS_FILE else f"data/{project}/annotations.csv"

    if not os.path.exists(csv_path):
        print(f"⚠️ CSV not found: {csv_path}")
        return {"points": []}

    points = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("image_name") != name:
                continue

            # 🆕 Parser les coordonnées en float (gère les valeurs vides)
            try:
                ix = float(row.get("column", 0)) if row.get("column") else 0
                iy = float(row.get("row", 0)) if row.get("row") else 0
            except (ValueError, TypeError):
                ix, iy = 0, 0

            point = {
                "id": row.get("point_id"),
                "ix": ix,
                "iy": iy,
                "column": ix,  # 🆕 Garder aussi column/row pour compatibilité
                "row": iy,
                "label": row.get("label") or None,
            }
            points.append(point)

    print(f"✅ Chargé {len(points)} points pour {name} depuis {csv_path}")
    return {"points": points}


# 🆕 AJOUT: Variable globale ANNOTATIONS_FILE au début du fichier
# À ajouter avec les autres variables globales (après _segmentation_cache)
"""
ANNOTATIONS_FILE = None  # Défini lors du /load-project
"""

# 🆕 MODIFICATION: Update load_project to set ANNOTATIONS_FILE
# Remplace la section "5. set annotation_file for project" dans load_project par:
"""
    # 5. set annotation_file for project
    annotations_dir = os.path.join(image_path, "annotations")
    os.makedirs(annotations_dir, exist_ok=True)

    ANNOTATIONS_FILE = os.path.join(
        annotations_dir,
        f"annotations_{name}.csv"
    )
    print(f"📝 ANNOTATIONS_FILE set to: {ANNOTATIONS_FILE}")
    return {
        "status": "ok",
        "project": project,
        "n_labels": len(_labels_list),
        "annotations_file": ANNOTATIONS_FILE  # 🆕 Retourner aussi le chemin pour info
    }
"""


class Annotation(BaseModel):
    image: str
    point_id: int
    label: str



def get_image_size(image_name: str):
    path = os.path.join(IMAGE_FOLDER, image_name)

    if not os.path.exists(path):
        raise ValueError(f"Image not found: {path}")

    with Image.open(path) as img:
        return img.width, img.height
def generate_points_in_roi(n, x1, y1, x2, y2):
    xmin, xmax = min(x1, x2), max(x1, x2)
    ymin, ymax = min(y1, y2), max(y1, y2)

    return [
        {
            "id": i,
            "ix": random.uniform(xmin, xmax),
            "iy": random.uniform(ymin, ymax),
        }
        for i in range(n)
    ]
@app.post("/regenerate-points")
def regenerate_points(
    image: str,
    n: int = 10,
    x1: float = None,
    y1: float = None,
    x2: float = None,
    y2: float = None,
):
    width, height = get_image_size(image)

    # 🔥 ROI mode
    if None not in (x1, y1, x2, y2):
        pts = generate_points_in_roi(n, x1, y1, x2, y2)

    # 🔥 fallback full image
    else:
        pts = generate_points(n, width, height)

    DB.setdefault(image, {"points": None, "annotations": []})
    DB[image]["points"] = pts
    DB[image]["annotations"] = []

    return {"ok": True}
@app.post("/annotate")
def annotate(a: Annotation):
    entry = DB.setdefault(a.image, {"points": None, "annotations": []})

    # remplacer si déjà existant
    entry["annotations"] = [
        ann for ann in entry["annotations"]
        if ann["point_id"] != a.point_id
    ]

    entry["annotations"].append({
        "point_id": a.point_id,
        "label": a.label
    })

    return {"ok": True}

# ── /train ────────────────────────────────────────────────────────────────────

@app.post("/train")
def trigger_training(background_tasks: BackgroundTasks):
    """Lance le (ré)entraînement en arrière-plan."""
    global _is_training

    if _is_training:
        return {"status": "already_training"}
    if not _all_annotations:
        return {"status": "no_annotations"}
    if not _labels_list:
        return {"status": "labels_not_loaded"}

    _is_training = True
    background_tasks.add_task(_run_training)
    return {"status": "training_started", "n_annotations": len(_all_annotations)}


@app.get("/training-status")
def training_status():
    """Permet au frontend de savoir si un training est en cours."""
    return {
        "is_training":   _is_training,
        "model_ready":   _prediction_model is not None,
        "n_annotations": len(_all_annotations),
    }


# ── helpers internes ──────────────────────────────────────────────────────────

def _crop_patch(image_np: np.ndarray, row: int, col: int, size: int = 224) -> Image.Image:
    """Même logique que RioDoFogoDataset.crop_patch."""
    pil    = Image.fromarray(image_np)
    pad    = size
    padded = ImageOps.expand(pil, pad, fill="white")
    left   = col + pad - size // 2
    upper  = row + pad - size // 2
    return padded.crop((left, upper, left + size, upper + size))


def _run_training():
    """Tâche de fond : entraîne le MLP sur toutes les annotations accumulées."""
    global _prediction_model, _is_training
    from model_training import train_model, create_model

    print(f"[Training] Starting on {len(_all_annotations)} annotations...")
    try:
        _prediction_model = train_model(
            annotations=_all_annotations,
            labels=_labels_list,
            image_folder=IMAGE_FOLDER,
            model=_prediction_model,   # None au premier training → crée un nouveau
        )
        if _prediction_model is not None:
            _prediction_model.eval()
        print("[Training] Done ✓")
    except Exception as e:
        print(f"[Training] Error: {e}")
    finally:
        _is_training = False

@app.get("/read-csv")
def read_csv(path: str = Query(...)):
    if not os.path.exists(path):
        return {"error": "File not found"}

    if not path.endswith(".csv"):
        return {"error": "Not a CSV"}

    rows = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            rows.append(row)

    return {"rows": rows}

@app.get("/load-labels")
def load_labels(path: str = Query(...)):
    if not os.path.exists(path):
        return []

    labels = []

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) > 0:
                labels.append(row[0])  # ⚠️ adapte la colonne si besoin

    return labels
# 🔥 récupérer images du dossier courant
@app.get("/images")
def get_images():
    if not os.path.exists(IMAGE_FOLDER):
        return []

    return [
        f for f in os.listdir(IMAGE_FOLDER)
        if f.lower().endswith(("png", "jpg", "jpeg"))
    ]


# 🔥 changer dynamiquement le dossier
@app.post("/set-folder")
def set_folder(path: str):
    global IMAGE_FOLDER

    if not os.path.exists(path):
        return {"error": "Folder not found"}

    IMAGE_FOLDER = path
    return {"status": "ok", "path": IMAGE_FOLDER}


@app.get("/masks")
def get_masks(
    name: str = Query(...),
    model: str = Query("sam"),
    pred_model: str = Query("none")
):
    global _segmentation_cache

    # 🔥 1. cache hit
    if name in _segmentation_cache:
        return {"masks": _segmentation_cache[name]}

    # 🔥 2. sinon compute
    full_path = os.path.join(IMAGE_FOLDER, name)
    if not os.path.exists(full_path):
        return {"error": "not found", "masks": []}

    masks = generate_masks(full_path, model_name=model)

    # 🔥 3. store
    _segmentation_cache[name] = masks

    return {"masks": masks}
@app.get("/load-labels-json")
def load_labels_json(path: str):
    import json
    with open(path, "r") as f:
        return json.load(f)

@app.get("/image/{image_name}")
def get_image(image_name: str):
    path = os.path.join(IMAGE_FOLDER, image_name)
    return FileResponse(path)


@app.post("/set-labelset")
def set_labelset(path: str):
    global LABELSET_PATH

    if not os.path.exists(path):
        return {"error": "not found"}

    LABELSET_PATH = path
    return {"status": "ok"}
# 🔥 labels
@app.get("/labels")
def get_labels():
    if LABELSET_PATH and os.path.exists(LABELSET_PATH):
        with open(LABELSET_PATH, newline="", encoding="utf-8") as f:
            return [row[0] for row in csv.reader(f) if row]

    return ["coral", "sand", "algae"]

import json
from pathlib import Path

PROJECTS_FILE = Path("projects.json")

def load_projects():
    if not PROJECTS_FILE.exists():
        return []
    print("tututu", json.loads(PROJECTS_FILE.read_text()))
    return json.loads(PROJECTS_FILE.read_text())

def save_projects(projects):
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))


@app.get("/projects")
def get_projects():
    return load_projects()



@app.delete("/projects")
def delete_project(name: str):
    projects = load_projects()

    new_projects = [p for p in projects if p["name"] != name]

    if len(new_projects) == len(projects):
        return {"error": "project not found"}

    save_projects(new_projects)
    return {"status": "deleted"}


@app.post("/load-project")
def load_project(name: str):
    global IMAGE_FOLDER, LABELSET_PATH
    global _labels_list, _labels_names
    global _prediction_model, _all_annotations
    global ANNOTATIONS_FILE


    projects = load_projects()

    project = next((p for p in projects if p["name"] == name), None)
    if project is None:
        return {"error": "not found"}

    image_path  = project["imagePath"]
    labels_path = project["labelsPath"]
    print("IMAGE PATH", image_path)
    print("LABELS PATH", labels_path)
    if not os.path.exists(image_path):
        return {"error": f"Image folder not found: {image_path}"}

    if not os.path.exists(labels_path):
        return {"error": f"Labels file not found: {labels_path}"}

    # 🔥 1. set folder
    IMAGE_FOLDER = image_path

    # 🔥 2. set labelset
    LABELSET_PATH = labels_path

    # 🔥 3. charger labels
    with open(LABELSET_PATH, encoding="utf-8") as f:
        labels_map = json.load(f)

    _labels_list  = list(labels_map.keys())
    _labels_names = list(labels_map.values())

    # 🔥 4. reset session (IMPORTANT)
    _prediction_model = None
    _all_annotations  = []

    #5. set annotation_file for project
    annotations_dir = os.path.join(image_path, "annotations")
    os.makedirs(annotations_dir, exist_ok=True)

    ANNOTATIONS_FILE = os.path.join(
        annotations_dir,
        f"annotations_{name}.csv"
    )
    return {
        "status": "ok",
        "project": project,
        "n_labels": len(_labels_list)
    }

@app.get("/annotators")
def get_annotators(project_name: str):
    projects = load_projects()

    for p in projects:
        if p["name"] == project_name:
            return p.get("annotators", [])

    return []

@app.post("/annotators")
def create_annotator(body: dict):
    project_name = body.get("project")
    annotator_id = body.get("annotator_id")

    if not project_name or not annotator_id:
        return {"error": "missing fields"}

    projects = load_projects()

    for p in projects:
        if p["name"] == project_name:
            if "annotators" not in p:
                p["annotators"] = []

            if annotator_id in p["annotators"]:
                return {"status": "exists"}

            p["annotators"].append(annotator_id)
            save_projects(projects)

            return {"status": "created", "annotator_id": annotator_id}

    return {"error": "project not found"}
@app.post("/precompute-segmentation")
def precompute_segmentation(batch_size: int = 10, model: str = "sam"):
    global _segmentation_cache

    images = get_images()[:batch_size]  # ou mieux: un pointeur

    for name in images:
        if name in _segmentation_cache:
            continue  # déjà fait

        full_path = os.path.join(IMAGE_FOLDER, name)
        if not os.path.exists(full_path):
            continue

        masks = generate_masks(full_path, model_name=model)
        _segmentation_cache[name] = masks

    return {
        "status": "ok",
        "cached": len(_segmentation_cache)
    }


TIMINGS_CSV = "../results/timings.csv"

TIMINGS_FIELDNAMES = [
    "image", "annotator_id",
    "whole_image_ms", "roi_draw_ms", "roi_used", "roi_x1", "roi_y1", "roi_x2", "roi_y2",
    "n_points", "n_labeled", "n_ai_accepted", "n_ai_modified",
    "point_id", "point_ms", "point_accepted_ai", "point_source",
]
@app.post("/save-annotations")
def save_annotations(body: dict):
    global _all_annotations

    annotations = body.get("annotations", [])
    timings     = body.get("timings", {})
    print("Timings: ", timings)
    # ── filtre ─────────────────────────────────────────
    valid = [
        a for a in annotations
        if a.get("label") and a.get("image")
    ]

    if not valid:
        return {"saved": 0}

    # ── éviter doublons ────────────────────────────────
    existing = set()

    if os.path.exists(ANNOTATIONS_FILE):
        with open(ANNOTATIONS_FILE, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                existing.add(tuple(row))

    to_write = []

    for a in valid:
        row = (
            a["image"],
            str(int(a.get("iy", 0))),
            str(int(a.get("ix", 0))),
            a["label"],
            a.get("annotator_id", "unknown")
        )

        if row not in existing:
            to_write.append(row)
            existing.add(row)

    # ── write annotations CSV ──────────────────────────
    if to_write:
        file_exists = os.path.exists(ANNOTATIONS_FILE)

        with open(ANNOTATIONS_FILE, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)

            if not file_exists:
                writer.writerow([
                    "image_name",
                    "row",
                    "column",
                    "label",
                    "annotator_id"
                ])

            writer.writerows(to_write)

    # ── mémoire ────────────────────────────────────────
    _all_annotations.extend(valid)

    # ── training logic ─────────────────────────────────
    annotated_images = len({a["image"] for a in _all_annotations})

    should_train = (
        annotated_images > 0 and
        annotated_images % _freq == 0 and
        not _is_training
    )

    # ==================================================
    # ── TIMINGS ───────────────────────────────────────
    # ==================================================
    if timings:
        Path(TIMINGS_CSV).parent.mkdir(parents=True, exist_ok=True)
        file_exists = os.path.exists(TIMINGS_CSV)

        point_timings = timings.get("point_timings", [])

        base = {
            "image": timings.get("image", ""),
            "annotator_id": timings.get("annotator_id", ""),
            "whole_image_ms": timings.get("whole_image_ms", ""),
            "roi_draw_ms": timings.get("roi_draw_ms", ""),
            "roi_used": timings.get("roi_used", ""),

            # 👇 NEW
            "roi_x1": timings.get("roi", {}).get("x1", ""),
            "roi_y1": timings.get("roi", {}).get("y1", ""),
            "roi_x2": timings.get("roi", {}).get("x2", ""),
            "roi_y2": timings.get("roi", {}).get("y2", ""),

            "n_points": timings.get("n_points", ""),
            "n_labeled": timings.get("n_labeled", ""),
            "n_ai_accepted": timings.get("n_ai_accepted", ""),
            "n_ai_modified": timings.get("n_ai_modified", ""),
        }

        rows = []

        if point_timings:
            for pt in point_timings:
                rows.append({
                    **base,
                    "point_id":          pt.get("point_id", ""),
                    "point_ms":          pt.get("ms", ""),
                    "point_accepted_ai": pt.get("accepted_ai", ""),
                    "point_source":      pt.get("source", "canvas"),
                })
        else:
            rows.append({
                **base,
                "point_id": "",
                "point_ms": "",
                "point_accepted_ai": "",
                "point_source": ""
            })

        with open(TIMINGS_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=TIMINGS_FIELDNAMES)

            if not file_exists:
                writer.writeheader()

            writer.writerows(rows)

    # ── return complet ─────────────────────────────────
    return {
        "saved": len(to_write),
        "skipped": len(valid) - len(to_write),
        "total_annotations": len(_all_annotations),
        "annotated_images": annotated_images,
        "should_train": should_train,
    }

from fastapi import HTTPException
import csv
import os
@app.get("/get-roi")
def get_roi(image_name: str):
    if not os.path.exists(TIMINGS_CSV):
        return {"x1": None, "y1": None, "x2": None, "y2": None}

    with open(TIMINGS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        last_roi = None

        for row in reader:
            if row.get("image") != image_name:
                continue
            x1 = row.get("roi_x1")
            y1 = row.get("roi_y1")
            x2 = row.get("roi_x2")
            y2 = row.get("roi_y2")

            if x1 and y1 and x2 and y2:
                last_roi = {
                    "x1": float(x1),
                    "y1": float(y1),
                    "x2": float(x2),
                    "y2": float(y2),
                }

    # Retourner le dernier ROI trouvé (format plat, pas imbriqué)
    if last_roi:
        return last_roi

    return {"x1": None, "y1": None, "x2": None, "y2": None}


@app.get("/get-annotations")
def get_all_annotations():
    """
    Charge TOUTES les annotations du CSV et retourne un dictionnaire
    image_name -> list of annotation rows

    Format de retour:
    {
        "image1.jpg": [
            {"image_name": "image1.jpg", "point_id": "0", "row": "100", "column": "200", "label": "CR", "annotator_id": "ann1"},
            {"image_name": "image1.jpg", "point_id": "1", "row": "150", "column": "250", "label": "SND", "annotator_id": "ann1"},
        ],
        "image2.jpg": [...]
    }
    """
    global ANNOTATIONS_FILE

    result = {}

    if not ANNOTATIONS_FILE or not os.path.exists(ANNOTATIONS_FILE):
        print(f"⚠️ ANNOTATIONS_FILE not set or not found: {ANNOTATIONS_FILE}")
        return result

    try:
        with open(ANNOTATIONS_FILE, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                image_name = row.get("image_name")

                if not image_name:
                    continue

                if image_name not in result:
                    result[image_name] = []

                # Parser les coordonnées
                try:
                    row_coord = float(row.get("row", 0)) if row.get("row") else 0
                    col_coord = float(row.get("column", 0)) if row.get("column") else 0
                except (ValueError, TypeError):
                    row_coord, col_coord = 0, 0

                # Enrichir la row avec les coordonnées parsées
                enriched_row = {
                    **row,
                    "point_id": row.get("point_id"),
                    "row": row_coord,
                    "column": col_coord,
                    "label": row.get("label"),
                    "predicted_label": row.get("predicted_label"),
                    "mask_id": row.get("mask_id"),
                }

                result[image_name].append(enriched_row)

        print(f"✅ Chargé {sum(len(v) for v in result.values())} annotations depuis {ANNOTATIONS_FILE}")
        print(f"📊 {len(result)} images annotées")

    except Exception as e:
        print(f"❌ Erreur lecture CSV: {e}")

    return result


# main.py

@app.get("/browse-subfolders")
def browse_subfolders(path: str):
    """Liste les sous-dossiers directs d'un dossier racine"""
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return {"error": "Invalid path"}

    subfolders = []
    for child in sorted(p.iterdir()):
        if child.is_dir():
            # Compte les images dans ce sous-dossier
            img_count = len([
                f for f in child.iterdir()
                if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
            ])
            subfolders.append({
                "name": child.name,
                "path": str(child),
                "imageCount": img_count
            })

    return {"path": str(p), "subfolders": subfolders}


@app.post("/images-from-folders")
def images_from_folders(body: dict):
    """Charge les images depuis une liste de dossiers sélectionnés"""
    folders = body.get("folders", [])  # liste de paths absolus

    EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
    images = []

    for folder_path in folders:
        p = Path(folder_path)
        if p.exists() and p.is_dir():
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in EXTENSIONS:
                    images.append({
                        "filename": f.name,
                        "path": str(f),
                        "folder": p.name  # pour savoir d'où vient l'image
                    })

    # Stocke dans le state global
    app.state.images = images
    return images


@app.post("/load-project")
def load_project(body: dict):
    name = body["name"]
    projects = load_projects()

    if name not in projects:
        return {"error": "Project not found"}

    project = projects[name]

    # Recharge les images depuis les dossiers sélectionnés
    EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
    images = []

    for folder in project.get("selectedFolders", []):
        p = Path(folder["path"])
        if p.exists():
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in EXTENSIONS:
                    images.append({
                        "filename": f.name,
                        "path": str(f),
                        "folder": p.name
                    })

    app.state.images = images
    return {"project": project, "images": images}


# main.py — ajouter ces routes
@app.get("/browse")
def browse(path: str):
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return {"error": "Invalid path"}
    dirs = sorted([d.name for d in p.iterdir() if d.is_dir()])
    return {"path": str(p), "dirs": dirs}


@app.get("/browse-files")
def browse_files(path: str):
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return {"error": "Invalid path"}
    dirs = sorted([d.name for d in p.iterdir() if d.is_dir()])
    files = sorted([f.name for f in p.iterdir() if f.suffix == ".json"])
    return {"path": str(p), "dirs": dirs, "files": files}


@app.get("/scan-transects")
def scan_transects(folder: str, pattern: str = "T"):
    p = Path(folder)
    if not p.exists() or not p.is_dir():
        return {"error": "Invalid path"}
    EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
    results = []
    transect_dirs = sorted([
        d for d in p.iterdir()
        if d.is_dir() and d.name.upper().startswith(pattern.upper())
    ])
    for t_dir in transect_dirs:
        for f in sorted(t_dir.iterdir()):
            if f.suffix.lower() in EXTENSIONS:
                results.append({
                    "filename": f.name,
                    "path": str(f),
                    "transect": t_dir.name,
                    "folder": str(p),
                    "folder_name": p.name,
                })
    return {"images": results, "count": len(results)}


@app.post("/projects")
def create_project(body: dict):
    projects_file = Path("projects.json")
    projects = []
    if projects_file.exists():
        projects = json.loads(projects_file.read_text())
    if any(p["name"] == body["name"] for p in projects):
        return {"error": "Project already exists"}
    import datetime
    project = {
        "name": body["name"],
        "root_folder": body.get("root_folder", ""),
        "sites": body.get("sites", []),
        "labels_path": body.get("labels_path", ""),
        "created_at": str(datetime.datetime.now()),
    }
    projects.append(project)
    projects_file.write_text(json.dumps(projects, indent=2))
    return {"ok": True, "project": project}



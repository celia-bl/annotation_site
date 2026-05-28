"""
model_training.py
-----------------
Crée et entraîne le modèle ReefNet (BioCLIP backbone + MLP head).
"""

import os
import tempfile
import torch
import pandas as pd
from torch.utils.data import DataLoader

from models import CLIPFeatureExtractorWrapper, FeatureExtractorWithHead, create_mlp_head
from datasets import RioDoFogoDataset
from trainer import BaseTrainer


# ── factory ────────────────────────────────────────────────────────────────────

def create_model(labels: list) -> FeatureExtractorWithHead:
    """
    Crée un nouveau modèle ReefNet + MLP head aléatoire.
    labels : liste de codes courts ["CR", "SND", ...]
    """
    backbone = CLIPFeatureExtractorWrapper(
        hugging_face_link="hf-hub:ReefNet/finetuned-bioclip"
    )
    head = create_mlp_head(
        input_dim=backbone.get_output_dim(),
        num_labels=len(labels),
    )
    model = FeatureExtractorWithHead(
        feature_extractor=backbone,
        head=head,
        freeze_backbone=True,   # on entraîne seulement le MLP
    )
    return model


# ── training ───────────────────────────────────────────────────────────────────

def train_model(
    annotations: list,
    labels: list,
    image_folder: str,
    model=None,
    epochs: int = 10,
    lr: float = 1e-4,
    batch_size: int = 16,
) -> FeatureExtractorWithHead:
    """
    Entraîne (ou ré-entraîne) le MLP head sur toutes les annotations accumulées.

    annotations : [{"image": "img.jpg", "ix": 120.5, "iy": 340.2, "label": "CR"}, ...]
    labels      : liste ordonnée des codes courts — l'index = class id
    image_folder: chemin vers le dossier d'images (IMAGE_FOLDER du backend)
    model       : modèle existant à réutiliser (None = créer un nouveau)
    """
    label2id = {lbl: i for i, lbl in enumerate(labels)}

    # ── filtrer les annotations valides ────────────────────────────────────────
    rows = []
    for ann in annotations:
        if not ann.get("label") or ann["label"] not in label2id:
            continue
        rows.append({
            "Name":   ann["image"],
            "Row":    int(ann["iy"]),   # Row = y dans RioDoFogoDataset
            "Column": int(ann["ix"]),   # Column = x
            "Label":  ann["label"],
        })

    if not rows:
        print("[train_model] No valid annotations — skipping training.")
        return model

    df = pd.DataFrame(rows)
    print(f"[train_model] Training on {len(df)} patches from {df['Name'].nunique()} images.")

    # ── CSV temporaire pour RioDoFogoDataset ────────────────────────────────────
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w")
    df.to_csv(tmp.name, index=False)
    tmp.close()

    # ── modèle ─────────────────────────────────────────────────────────────────
    if model is None:
        model = create_model(labels)

    preprocess = model.preprocess_train

    # ── dataset ────────────────────────────────────────────────────────────────
    dataset = RioDoFogoDataset(
        image_dir=image_folder,
        annotation_file=tmp.name,
        crop_size=224,
        transform=preprocess,
        pre_crop=False,
        min_samples=None,
    )
    os.unlink(tmp.name)

    # ── collate : convertit les labels string → ids ────────────────────────────
    def collate_fn(batch):
        imgs, label_strs, _ = zip(*batch)
        ids = torch.tensor([label2id[l] for l in label_strs], dtype=torch.long)
        return torch.stack(imgs), ids

    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=True,
        collate_fn=collate_fn,
        num_workers=0,      # 0 pour éviter les pb de pickling avec FastAPI
    )

    # ── entraînement — seulement le MLP head ───────────────────────────────────
    optimizer = torch.optim.Adam(model.head.parameters(), lr=lr)
    criterion = torch.nn.CrossEntropyLoss()

    trainer = BaseTrainer(
        model=model,
        model_name="reefnet_mlp",
        logger=None,          # BaseLogger crée un run W&B — mettre use_wandb=False si besoin
    )
    trainer.train(
        train_loader=loader,
        val_loader=None,
        epochs=epochs,
        criterion=criterion,
        optimizer=optimizer,
    )

    return model
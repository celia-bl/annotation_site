from torch import nn
import torch
import open_clip
import os


def create_mlp_head(input_dim: int, num_labels: int, dropout=0.3, debug=False):
    """
    MLP head fixe :
    input_dim → 200 → 100 → num_labels
    """

    mlp_head = nn.Sequential(
        nn.Linear(input_dim, 200),
        nn.ReLU(),
        nn.Dropout(dropout),

        nn.Linear(200, 100),
        nn.ReLU(),
        nn.Dropout(dropout),

        nn.Linear(100, num_labels)
    )

    if debug:
        print("=== MLP HEAD DEBUG ===")
        print(f"Input dim: {input_dim}")
        print("Architecture:")
        for i, layer in enumerate(mlp_head):
            print(f"  Layer {i}: {layer}")
        print("======================")

    return mlp_head

class BaseModelWrapper(nn.Module):
    def __init__(self):
        super().__init__()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None

    def forward(self, x):
        return self.model(x)

    def get_preprocessors(self):
        raise NotImplementedError

    def get_tokenizer(self):
        return None

class CLIPWrapper(BaseModelWrapper):
    def __init__(self, weights_path=None, hugging_face_link='hf-hub:imageomics/bioclip'):
        super().__init__()
        try:
            self.model, self.preprocess_train, self.preprocess_val = open_clip.create_model_and_transforms(hugging_face_link)
        except Exception as e:
            print(f"[WARN] Standard OpenCLIP loading failed: {e}")
            print("[INFO] Falling back to manual .pt checkpoint loading")

            # --- fallback : création explicite du backbone ---
            backbone = "ViT-B-16"  # à adapter si besoin

            self.model, self.preprocess_train, self.preprocess_val = \
                open_clip.create_model_and_transforms(
                    backbone,
                    pretrained=None
                )

            # --- déterminer le chemin du .pt ---
            pt_path = './models/weights/ViT-B-16-openai.pt'
            #pt_path = './weights/ViT-B-16-openai.pt'

            if not os.path.isfile(pt_path):
                raise RuntimeError(f"❌ Checkpoint .pt not found: {pt_path}")

            # --- chargement du checkpoint ---
            checkpoint = torch.load(pt_path, map_location="cpu")

            if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
                checkpoint = checkpoint["state_dict"]

            missing, unexpected = self.model.load_state_dict(checkpoint, strict=False)

            if missing:
                print(f"[WARN] Missing keys when loading .pt: {missing}")
            if unexpected:
                print(f"[WARN] Unexpected keys when loading .pt: {unexpected}")

            print(f"[INFO] Successfully loaded OpenCLIP weights from {pt_path}")
        print(self.model, self.preprocess_train, self.preprocess_val)
        try:
            self.tokenizer = open_clip.get_tokenizer(hugging_face_link)
        except Exception as e:
            print(f"[WARN] Tokenizer failed to load {hugging_face_link}")
            print(f"[INFO] Falling back to manual tokenizer")
            self.tokenizer = open_clip.get_tokenizer('ViT-B-16')
            print(f"[INFO] Successfully loaded tokenizer from OpenClip('Vit-B-16')")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.embedding_dim = self.model.visual.output_dim
        if weights_path is not None:
            checkpoint = torch.load(weights_path, map_location=self.device, weights_only=False)
            try:
                if 'state_dict' in checkpoint:
                    self.model.load_state_dict(self._clean_state_dict(checkpoint['state_dict']))
                else:
                    self.model.load_state_dict(self._clean_state_dict(checkpoint))
            except RuntimeError as e:
                raise ValueError(
                    f"Weight loading failure: incompatibility with BioCLIP.\nDetail: {e}"
                )

        self.model.to(self.device)

    @staticmethod
    def _clean_state_dict(state_dict):
        if any(k.startswith("module.") for k in state_dict.keys()):
            return {k.replace("module.", ""): v for k, v in state_dict.items()}
        return state_dict

    def get_preprocessors(self):
        return self.preprocess_train, self.preprocess_val

    def forward(self, images, texts, temperature=0.07):
        """
        images: tensor [B, 3, H, W]
        texts: list of strings of length T (number of classes)
        """
        image_features = self.model.encode_image(images)  # [B, D]
        tokenized = self.tokenizer(texts).to(self.device)  # [B, L]
        text_features = self.model.encode_text(tokenized)  # [B, D]

        # Normalize features
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        # Similarity cosine (logits)
        logits = image_features @ text_features.T / temperature # logits: [B, B], chaque ligne i contient la similarité entre image i et tous les textes
        return logits  # Plus c'est proche de 1, plus image <-> texte sont proches

    @torch.no_grad()
    def predict(self, image, candidate_texts):
        """
        image: tensor [1, 3, H, W]
        candidate_texts: list of strings [T] (hiérarchie ou labels)
        """
        self.eval()
        image_features = self.model.encode_image(image)  # [1, D]
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        tokenized = self.tokenizer(candidate_texts).to(self.device)  # [T, L]
        text_features = self.model.encode_text(tokenized)  # [T, D]
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        # Produit scalaire = similarité cosinus
        sims = image_features @ text_features.T  # [1, T]
        pred_idx = sims.argmax(dim=-1).item()
        pred_label = candidate_texts[pred_idx]
        return pred_label, sims.squeeze(0)  # renvoie aussi les scores si tu veux

    def get_model_size_in_mb(self):
        param_size = 0
        for param in self.model.parameters():
            param_size += param.numel() * param.element_size()
        buffer_size = 0
        for buffer in self.model.buffers():
            buffer_size += buffer.numel() * buffer.element_size()
        size_all_mb = (param_size + buffer_size) / 1024 ** 2
        return size_all_mb
class CLIPFeatureExtractorWrapper(CLIPWrapper):
    def __init__(self, hugging_face_link='hf-hub:imageomics/bioclip'):
        super().__init__(hugging_face_link=hugging_face_link)

    def forward(self, images, texts=None, temperature=None):
        """
        images: tensor [B, 3, H, W]
        Retourne: features non normalisés [B, D]
        """
        if texts is not None:
            raise ValueError("CLIPFeatureExtractorWrapper don't use texts. Only images")
        image_features = self.model.encode_image(images)  # [B, D]
        return image_features

    def get_output_dim(self):
        """Return the dimension of extracted CLIP features."""
        return self.model.visual.output_dim



class FeatureExtractorWithHead(nn.Module):
    def __init__(self, feature_extractor: nn.Module, head: nn.Module, freeze_backbone=True):
        super().__init__()
        self.feature_extractor = feature_extractor
        self.head = head
        if freeze_backbone:
            self.freeze_backbone()
        if hasattr(feature_extractor, 'preprocess_train'):
            self.preprocess_train = feature_extractor.preprocess_train
        if hasattr(feature_extractor, 'preprocess_val'):
            self.preprocess_val = feature_extractor.preprocess_val
        print('Init FeatureExtractorWithHead')

    def freeze_backbone(self):
        for p in self.feature_extractor.parameters():
            p.requires_grad = False

    def forward(self, images):
        features = self.feature_extractor(images)
        out = self.head(features)
        return out

    def get_image_features(self, images):
        features = []
        for image in images:
            features.append(self.feature_extractor(image))
        return features

    def get_features(self, images):
        """Only the features from the backbone."""
        return self.feature_extractor(images)

    def get_output_dim(self):
        """Return the dimension of extracted CLIP features."""
        return self.feature_extractor.get_output_dim()

    def __str__(self):
        lines = []
        lines.append("===== FeatureExtractorWithHead =====")

        # Feature extractor
        lines.append(f"Backbone: {self.feature_extractor.__class__.__name__}")
        if hasattr(self.feature_extractor, 'get_output_dim'):
            lines.append(f"Backbone output dim: {self.feature_extractor.get_output_dim()}")
        else:
            lines.append("Backbone output dim: unknown (no get_output_dim())")

        # MLP architecture
        lines.append("\n--- Classification Head (MLP) ---")
        lines.append(str(self._describe_mlp(self.head)))

        # Param count
        total_params = sum(p.numel() for p in self.parameters())
        trainable_params = sum(p.numel() for p in self.parameters() if p.requires_grad)

        lines.append("\n--- Parameters ---")
        lines.append(f"Total parameters: {total_params:,}")
        lines.append(f"Trainable parameters: {trainable_params:,}")
        lines.append(f"Frozen parameters: {total_params - trainable_params:,}")


        # Backbone frozen?
        backbone_trainable = any(p.requires_grad for p in self.feature_extractor.parameters())
        lines.append(f"\nBackbone frozen: {not backbone_trainable}")
        # 🔍 Detailed list of backbone params
        lines.append("\n--- Backbone Parameters (requires_grad) ---")
        for name, p in self.feature_extractor.named_parameters():
            status = "TRAINABLE" if p.requires_grad else "frozen"
            lines.append(f"  {name:<60} {status}")

        return "\n".join(lines)

    @staticmethod
    def _describe_mlp(mlp: nn.Module):
        """
        Retourne un résumé lisible du MLP :
        - nb de couches
        - taille par couche
        """
        layers = []

        for m in mlp.modules():
            if isinstance(m, nn.Linear):
                layers.append(f"Linear({m.in_features} → {m.out_features})")

        if len(layers) == 0:
            return "Head: not an MLP or no Linear layers found."

        description = "MLP:\n  " + "\n  ".join(layers)
        description += f"\n  #layers={len(layers)}"
        return description
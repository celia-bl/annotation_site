import torch
from PIL import Image
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
import numpy as np
import cv2
from util.coco import decode_rle_mask
from segment_anything.utils.transforms import ResizeLongestSide
#from sam3.model_builder import build_sam3_image_model
#from sam3.model.sam3_image_processor import Sam3Processor

class BaseSegmentationModel:
    def generate(self, image: np.ndarray) -> list:
        raise NotImplementedError

class SAMSegmentation(BaseSegmentationModel):
    def __init__(self, checkpoint, model_type="default"):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        sam = sam_model_registry[model_type](checkpoint=checkpoint)
        sam.to(self.device)

        self.mask_generator = SamAutomaticMaskGenerator(
            sam,
            points_per_side=8,
            points_per_batch=4,
            pred_iou_thresh=0.9,
            stability_score_thresh=0.95,
            min_mask_region_area=100
        )

    def generate(self, image: np.ndarray) -> list:
        h0, w0 = image.shape[:2]

        image_resized = resize_for_sam(image)
        h1, w1 = image_resized.shape[:2]

        scale_x = w0 / w1
        scale_y = h0 / h1
        masks = self.mask_generator.generate(image)

        results = []
        for i, m in enumerate(masks):
            polygons = mask_to_polygons(m["segmentation"])
             #polygons = rescale_polygons(polygons, scale_x, scale_y)
            if not polygons:
                continue

            results.append({
                "id": i,
                "polygons": polygons,
                "label": None,
                "prediction": "unknown",
                "score": m.get("predicted_iou", 0)
            })

        return results


def rescale_polygons(polygons, scale_x, scale_y):
    new_polygons = []
    for poly in polygons:
        new_poly = []
        for x, y in poly:
            new_poly.append([x * scale_x, y * scale_y])
        new_polygons.append(new_poly)
    return new_polygons


class CoralSegmentationAdapter(BaseSegmentationModel):
    def __init__(self, model_path, model_type="vit_b"):
        from segmentation import CoralSegmentation  # ton fichier copié

        self.model = CoralSegmentation(model_path, model_type)

    def generate(self, image: np.ndarray) -> list:
        masks = self.model.generate_masks_json(image)
        '''
        masks = self.model.filter(
            masks,
            min_area=0.01,
            min_confidence=0.7,
            max_iou=0.5
        )'''
        print("LEN MASKS:", len(masks))
        masks.sort(key=lambda x: x["predicted_iou"], reverse=True)
        results = []
        for m in masks:
            # ⚠️ ici faut convertir RLE → polygons
            mask = decode_rle_mask(m["segmentation"])

            polygons = mask_to_polygons(mask)

            if not polygons:
                continue

            results.append({
                "id": m["id"],
                "segmentation": m["segmentation"],
                "polygons": polygons,
                "label": None,
                "prediction": "coral",
                "score": m.get("predicted_iou", 0)
            })
        return results
class SAM3Segmentation:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        #self.model = self.model.half()
        self.model = build_sam3_image_model().to(self.device)
        self.processor = Sam3Processor(self.model)

        # 🔥 tes labels coarse
        '''self.labels = {
            "turf": ["turf algae and sand"],
            "calcareous_algae": ["calcareous algae"],
            "macroalgae": ["an algae", "a seaweed"],
            "coral": ["a coral structure"],
            "sand":["sand"],
            "quadrat":["quadrat", "a plastic square"]
        }'''
        self.labels = {
            "quadrat": ["quadrat", "a plastic square", "white plastic"]
        }

    def generate(self, image: np.ndarray) -> list:
        if isinstance(image, np.ndarray):
            image = Image.fromarray(image)

        with torch.no_grad():
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                inference_state = self.processor.set_image(image)

                results = []
                current_id = 0

                for label, prompts in self.labels.items():
                    for prompt in prompts:

                        output = self.processor.set_text_prompt(
                            state=inference_state,
                            prompt=prompt
                        )

                        masks = output["masks"]
                        scores = output["scores"]

                        for mask, score in zip(masks, scores):

                            # 🔥 conversion propre
                            mask = mask.squeeze()

                            if torch.is_tensor(mask):
                                mask = mask.detach().float().cpu().numpy()

                            mask = mask > 0.5

                            # 🔥 skip uniquement les masques vides
                            if mask.sum() == 0:
                                continue

                            polygons = mask_to_polygons(mask.astype(np.uint8))

                            if not polygons:
                                continue

                            results.append({
                                "id": current_id,
                                "label": label,
                                "prompt": prompt,  # 🔥 utile pour debug
                                "score": float(score),
                                "area": float(mask.sum()),
                                "polygons": polygons
                            })

                            current_id += 1

        return results
def resize_for_sam(image: np.ndarray) -> np.ndarray:
    """Downscale image so its longest side ≤ MAX_DIM."""
    MAX_DIM = 1024
    h, w = image.shape[:2]
    longest = max(h, w)
    if longest <= MAX_DIM:
        return image
    scale = MAX_DIM / longest
    new_w, new_h = int(w * scale), int(h * scale)
    pil = Image.fromarray(image).resize((new_w, new_h), Image.LANCZOS)
    return np.array(pil)

def mask_to_polygons(mask: np.ndarray) -> list:
    if mask.dtype != np.uint8:
        mask = (mask > 0).astype("uint8") * 255

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    contours, _ = cv2.findContours(
        mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    polygons = []
    for c in contours:
        if len(c) >= 3:
            pts = c.squeeze().tolist()

            # éviter les cas dégénérés
            if isinstance(pts[0], (int, float)):
                continue

            polygons.append(pts)

    return polygons

def get_model(name: str):
    if name == "sam":
        return SAMSegmentation("./models/ckpt/sam_vit_h_4b8939.pth")
    elif name == "coralscop":
        return CoralSegmentationAdapter("./models/ckpt/vit_b_coralscop.pth")
    elif name == "sam3":
        return SAM3Segmentation()
    else:
        raise ValueError(f"Unknown model: {name}")

def generate_masks(image_path: str, model_name="sam3"):
    image = np.array(Image.open(image_path))
    model = get_model(model_name)
    masks = model.generate(image)
    return masks
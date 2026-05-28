from torch.utils.data import Dataset
from PIL import Image, ImageOps
from torchvision import transforms
import os
import torch
import numpy as np
import math
from collections import Counter
import matplotlib.pyplot as plt
from label_manager import LabelManager
import pandas as pd

def crop_patch(im: Image.Image, x_center, y_center, crop_size):
    pad = crop_size
    im_padded = ImageOps.expand(im, pad, fill='white')
    left = int(y_center + pad - crop_size / 2)
    upper = int(x_center + pad - crop_size / 2)

    return im_padded.crop((left, upper, left + crop_size, upper + crop_size))

class RioDoFogoDataset(Dataset):
    def __init__(self, image_dir, annotation_file, crop_size=224, transform=None, pre_crop=False, cache_file="riodofogo_cache.pt", cache_threshold=200,
                 label_manager:LabelManager =None, encoding=None, min_samples=None):
        """
        RiodoFogoDataset : based on patches cropped from whole images, annotations in a csv file (Name, Row, Column, Label)
        :param image_dir: path to directory with whole images
        :param annotation_file: CSV such as [Name,Row,Column,Label]
        :param crop_size: size of the patches (size needed for training model after)
        :param transform: torchvision transform to perform on each patch, if None just ToTensor is applied
        :param pre_crop: if True -> crop all patches at loading, else crop on the fly when __get_item__ is called (dataloader)
        :param cache_file: Filename to save/load pre-cropped patches if dataset is large.
        :param cache_threshold: Number of unique images beyond which caching is used.
        :param label_encoder: Predefine label encoder
        :param encoding: Whether to encode the labels to the mapping or just use plain labels -> the output format of the get_item
        :param min_samples: Filter dataset for labels with more than min_samples
        """
        self.image_dir = image_dir
        self.crop_size = crop_size
        self.transform = transform if transform else transforms.ToTensor()
        print("TRANSFORM", transform)
        self.pre_crop = pre_crop
        self.cache_file = os.path.join(image_dir, cache_file)
        self.cache_threshold = cache_threshold
        self.dataset_name = "RiodoFogo"
        self.encoding = encoding
        self.label_manager = label_manager
        self.min_samples_per_label = min_samples

        self.data = self._load_annotations(annotation_file)

        self.data = self._standardize_columns(self.data)

        self.data = self._filter_existing_images(self.data)
        if min_samples != 'None':
            self.data = self._filter_rare_labels(self.data)

        # If pre_crop, croping all patches at once
        if self.pre_crop:
            num_images = self.data["Name"].nunique()
            # If too much images : use a cache_file
            if num_images > self.cache_threshold:
                if os.path.exists(self.cache_file):
                    print(f"Loading pre-cropped patches from cache: {self.cache_file}")
                    self.samples = torch.load(self.cache_file)
                else:
                    print(f"Building cache with {num_images} images → {self.cache_file}")
                    self.samples = self._build_samples()
                    torch.save(self.samples, self.cache_file)
            else:
                # petit dataset → garder en RAM
                print(f"Pre-cropping {num_images} images in memory (no cache).")
                self.samples = self._build_samples()
        else:
            # on-the-fly mode
            self.samples = self.data

    def _load_annotations(self, annotation_file):
        return pd.read_csv(annotation_file)

    def _standardize_columns(self,df):
        df = df.copy()
        if "Name" not in df or "Label" not in df:
            raise ValueError(
                f"{self.__class__.__name__} must define columns 'Name' and 'Label'"
            )
        return df

    def _filter_existing_images(self, df):
        print()
        image_names = [f for f in os.listdir(self.image_dir) if not f.startswith("._")]
        image_names = sorted(image_names)
        print("Filtering existing images...")
        df_filtered = df[df["Name"].isin(image_names)]
        if len(df_filtered) == 0:
            raise ValueError(
                f"No images from annotations exist in {self.image_dir}! "
                f"Check your CSV and image directory."
            )
        return df_filtered

    def _filter_rare_labels(self, df):
        if self.min_samples_per_label is not None:
            label_counts = df["Label"].value_counts()
            print("Filtering rare labels...")
            valid_labels = label_counts[label_counts >= self.min_samples_per_label].index
            if len(valid_labels) == 0:
                raise ValueError(
                    f"[RioDoFogoDataset] No label has at least "
                    f"{self.min_samples_per_label} samples "
                    f"(max = {label_counts.max()})"
                )

            before = len(df)
            df = df[df["Label"].isin(valid_labels)]
            after = len(df)

            print(
                f"[RioDoFogoDataset] "
                f"Filtering labels with < {self.min_samples_per_label} samples: "
                f"{before} → {after} patches, "
                f"{len(valid_labels)} labels kept"
            )

            return df
        else:
            return df

    def _build_samples(self):
        samples = []
        grouped = self.data.groupby("Name")
        for img_name, rows in grouped:
            img_path = os.path.join(self.image_dir, img_name)
            if not os.path.exists(img_path):
                print(f"Warning: image {img_name} not found in {self.image_dir}")
                continue
            im = Image.open(img_path).convert("RGB")
            for _, row in rows.iterrows():
                patch = crop_patch(im, row["Row"], row["Column"], self.crop_size)
                patch = self.transform(patch)
                samples.append((patch, row["Label"], img_name))
        return samples

    def __len__(self):
        return len(self.samples)

    def _get_patch_center(self, row, im):
        """
        Return (row_px, col_px) in pixels
        """
        return int(row["Row"]), int(row["Column"])

    def __getitem__(self, idx):
        if self.pre_crop:
            # patch déjà préparé
            patch, label, img_name = self.samples[idx]
            #return patch, label, img_name
        else:
            # crop à la volée
            row = self.samples.iloc[idx]
            img_path = os.path.join(self.image_dir, row["Name"])
            im = Image.open(img_path).convert("RGB")
            row_px, col_px = self._get_patch_center(row, im)
            patch = crop_patch(im, row_px, col_px, self.crop_size)
            patch = self.transform(patch)
            label = row['Label']
            #return patch, row["Label"], row["Name"]
        if self.encoding == "id":
            label = self.label_manager.to_id(label)
        elif self.encoding == "full_name":
            label = self.label_manager.to_full_name(label)
        elif self.encoding == "hierarchy_prompt":
            label = self.label_manager.to_hierarchy_prompt(label)
        elif self.encoding == "prompt":
            label = self.label_manager.to_prompt(label)

        metadata = {
            "img_path": img_path,
            "idx_df" :idx,
            "row_number":row.name
        }
        return patch, label, metadata

    def label_distribution(self):
        """
        Retun dict {label: count}
        """
        labels = self.data["Label"].tolist()
        counts = Counter(labels)
        return dict(counts)

    def imbalance_stats(self):
        """
        Compute imbalance statistics : min, max count, imbalance ratio (max/min), balance score from Shannon entropy
        :return dict {min: min, max: max, mean: mean, imbalance_ratio: imbalance_ratio, balance_score: balance_score}
        """
        counts = np.array(list(self.label_distribution().values()))
        if len(counts) == 0:
            return None  #empty dataset

        n = counts.sum()
        k = len(counts)
        entropy = -sum((c / n) * math.log(c / n) for c in counts if c > 0) if n > 0 else 0
        max_entropy = math.log(k) if k > 1 else 1
        balance_score = entropy / max_entropy if max_entropy > 0 else 0.0

        return {
            "min": counts.min(),
            "max": counts.max(),
            "mean": counts.mean(),
            "imbalance_ratio": counts.max() / counts.min(),
            "balance_score": balance_score
        }

    @classmethod
    def from_subset(cls, dataset, subset_df):
        """
        Create a new RioDoFogoDataset instance from a subset of an existing dataset's annotations.

        :param dataset: Existing RioDoFogoDataset instance
        :param subset_df: pandas DataFrame containing a subset of annotations
        :return: RioDoFogoDataset instance containing only the subset
        """
        # Create a new empty instance (annotation_file ignored)
        new_dataset = cls.__new__(cls)
        for attr in [
            "image_dir", "crop_size", "transform", "pre_crop", "cache_file",
            "cache_threshold", "dataset_name", "encoding", "label_manager",
        ]:
            setattr(new_dataset, attr, getattr(dataset, attr))

        # Directly assign the subset DataFrame
        new_dataset.data = subset_df.copy()

        # Rebuild samples if pre_crop
        new_dataset.samples = (
            new_dataset._build_samples() if new_dataset.pre_crop else new_dataset.data
        )

        return new_dataset

    def inspect_image_patches(self, img_name, n_patches=25):
        """
        Affiche les premiers n_patches croppés d'une image en grille avec le label au-dessus de chaque patch.
        """
        # Récupérer les patches
        if self.pre_crop:
            print("Using pre-crop")
            patches = [(p, l) for p, l, name in self.samples if name == img_name]
        else:
            rows = self.data[self.data["Name"] == img_name].head(n_patches)
            patches = []
            img_path = os.path.join(self.image_dir, img_name)
            im = Image.open(img_path).convert("RGB")
            for _, row in rows.iterrows():
                row_px, col_px = self._get_patch_center(row, im)
                patch = crop_patch(im, row_px, col_px, self.crop_size)
                #patch = self.transform(patch)
                label = row["Label"]
                patches.append((patch, label))

        if len(patches) == 0:
            print(f"No patches found for image {img_name}")
            return

        patches = patches[:n_patches]

        # Préparer la figure
        n_cols = int(len(patches) ** 0.5)
        n_rows = (len(patches) + n_cols - 1) // n_cols
        fig, axes = plt.subplots(n_rows, n_cols, figsize=(n_cols * 2, n_rows * 2))
        axes = axes.flatten()

        for i, (patch, label) in enumerate(patches):
            img = patch
            # Si ToTensor a été appliqué, remettre en format HWC
            if isinstance(img, torch.Tensor):
                img = img.permute(1, 2, 0).cpu().numpy()
                # Si normalisé (-1,1), on remet dans [0,1]
                if img.min() < 0 or img.max() > 1:
                    img = (img - img.min()) / (img.max() - img.min())
            # Décoder le label si label_manager dispo
            if self.label_manager:
                label = self.label_manager.to_full_name(label)
            axes[i].imshow(img)
            axes[i].set_title(label, fontsize=8)
            axes[i].axis("off")

        # Supprimer les axes vides
        for j in range(i + 1, len(axes)):
            axes[j].axis("off")

        plt.tight_layout()
        plt.show()

    def filter_rare_labels(self, min_samples_per_label):
        counts = self.data["Label"].value_counts()
        valid_labels = counts[counts >= min_samples_per_label].index
        subset_df = self.data[self.data["Label"].isin(valid_labels)]
        return RioDoFogoDataset.from_subset(self, subset_df)

    def get_labels(self):
        return self.data["Label"].values

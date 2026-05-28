import streamlit as st
import os
import time
from PIL import Image, ImageDraw, ImageFont
import random

# -------------------- UTIL: GENERATE POINTS --------------------
def generate_points(width, height, n, strategy="random"):
    points = []
    if strategy == "random":
        for _ in range(n):
            points.append((random.randint(0, width), random.randint(0, height)))
    elif strategy == "grid":
        step = int((width * height / n) ** 0.5)
        for x in range(0, width, step):
            for y in range(0, height, step):
                points.append((x, y))
        points = points[:n]
    return points


# -------------------- SESSION INIT --------------------
if "step" not in st.session_state:
    st.session_state.step = 1

if "images" not in st.session_state:
    st.session_state.images = []

if "config" not in st.session_state:
    st.session_state.config = {}

if "current_image_idx" not in st.session_state:
    st.session_state.current_image_idx = 0

if "points" not in st.session_state:
    st.session_state.points = None

# -------------------- STEP 1: GLOBAL SETUP --------------------
if st.session_state.step == 1:
    st.title("Coral Annotation Tool - Setup")

    import tkinter as tk
    from tkinter import filedialog
    import pandas as pd
    import os

    # ---------- Annotator ----------
    annotator_id = st.text_input("Annotator ID", key="annotator_id")

    # ---------- Init session state ----------
    if "folder_input" not in st.session_state or st.session_state.folder_input == "":
        st.session_state.folder_input = "/home/Celia/Documents/Hierarchical_Classification/fake_data_corals/Rio_do_Fogo_Benthic_Images"

    if "labels_file_input" not in st.session_state or st.session_state.labels_file_input == "":
        st.session_state.labels_file_input = "/home/Celia/Documents/Hierarchical_Classification/fake_data_corals/labelset/labelset.csv"

    # ---------- Folder picker ----------
    def browse_folder():
        root = tk.Tk()
        root.withdraw()
        folder_selected = filedialog.askdirectory()
        root.destroy()

        if folder_selected:
            st.session_state.folder_input = folder_selected

    col1, col2 = st.columns([3, 1])

    with col1:
        folder = st.text_input(
            "Image folder path",
            key="folder_input"
        )

    with col2:
        st.button("Browse", key="browse_folder", on_click=browse_folder)

    # ---------- CSV picker ----------
    def browse_csv():
        root = tk.Tk()
        root.withdraw()
        file_path = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv")])
        root.destroy()

        if file_path:
            st.session_state.labels_file_input = file_path

    col3, col4 = st.columns([3, 1])

    with col3:
        labels_file = st.text_input(
            "Labels CSV path",
            key="labels_file_input"
        )

    with col4:
        st.button("Browse CSV", key="browse_csv", on_click=browse_csv)

    # ---------- Load labels ----------
    labels_loaded = False

    if labels_file:
        if os.path.exists(labels_file):
            try:
                df = pd.read_csv(labels_file)
                labels = df.iloc[:, 0].dropna().astype(str).tolist()

                st.success(f"{len(labels)} labels loaded")
                st.write("Preview:", labels[:5])

                st.session_state.labels = labels
                labels_loaded = True

            except Exception as e:
                st.error(f"Error reading CSV: {e}")
        else:
            st.warning("CSV file not found")

    # ---------- Preview images ----------
    images_loaded = False

    if folder:
        if os.path.exists(folder):
            images = [
                f for f in os.listdir(folder)
                if f.lower().endswith(("png", "jpg", "jpeg"))
            ]

            st.session_state.images = images  # 🔥 IMPORTANT

            st.info(f"{len(images)} images found")
            images_loaded = True
        else:
            st.warning("Folder not found")
            st.session_state.images = []  # 🔥 éviter bug

    # ---------- Next ----------
    if st.button("Next", key="next_button"):

        if not annotator_id:
            st.error("Please enter an annotator ID")
            st.stop()

        if not images_loaded:
            st.error("Please select a valid image folder")
            st.stop()

        if not labels_loaded:
            st.error("Please load a labels CSV")
            st.stop()
        annotator_id = st.session_state.annotator_id  # ✅ lire seulement
        folder = st.session_state.folder_input
        st.session_state.folder = folder
        labels_file = st.session_state.labels_file_input

        st.session_state.step = 2
        st.rerun()  # 🔥 IMPORTANT

# -------------------- STEP 2: CONFIG --------------------
elif st.session_state.step == 2:
    st.title("Configuration")

    # ---------- Presets ----------
    PRESETS = {
        "none": None,
        "default": {
            "sampling": "random",
            "stop_criterion": "fixed_points",
            "n_points": 10,
            "in_sampling": "Point-based",
            "ai_model": "CoralNet",
            "frequency": 20,
            "correction": "Uncertainty"
        }
    }

    preset = st.selectbox("Preset", list(PRESETS.keys()), key="preset")

    # ---------- Apply preset ----------
    if PRESETS[preset] is not None:
        config = PRESETS[preset]

        st.session_state.sampling = config["sampling"]
        st.session_state.stop_criterion = config["stop_criterion"]
        st.session_state.n_points = config["n_points"]
        st.session_state.in_sampling = config["in_sampling"]
        st.session_state.ai_model = config["ai_model"]
        st.session_state.frequency = config["frequency"]
        st.session_state.correction = config["correction"]

    # ---------- Config fields ----------
    sampling = st.selectbox(
        "Sampling Strategy",
        ["random", "active learning"],
        key="sampling"
    )

    stop_criterion = st.selectbox(
        "Stop Criterion",
        ["fixed_points"],
        key="stop_criterion"
    )

    in_sampling = st.selectbox(
        "In-Image Sampling",
        ["Point-based", "Segmentation"],
        key="in_sampling"
    )

    if in_sampling == "Point-based":
        number_points = st.number_input(
            "Number of points per image",
            1, 100, 10,
            key="n_points"
        )

    ai_model = st.selectbox(
        "AI Model",
        ["CoralNet", "..."],
        key="ai_model"
    )

    frequency_retraining = st.number_input(
        "Frequency Retraining",
        1, 100,
        value=20,
        key="frequency"
    )

    list_correction = st.selectbox(
        "Order of labels correction proposition",
        ['Uncertainty', 'Random', 'Alphabetical', 'Hierarchical'],
        key="correction"
    )

    # ---------- Start ----------
    if st.button("Start Annotation"):

        st.session_state.config = {
            "preset": preset,
            "sampling": sampling,
            "stop_criterion": stop_criterion,
            "n_points": st.session_state.get("n_points", None),
            "in_sampling": in_sampling,
            "ai_model": ai_model,
            "frequency": frequency_retraining,
            "correction": list_correction
        }

        st.session_state.current_image_idx = 0
        st.session_state.step = 3
        st.rerun()  # 🔥 IMPORTANT

# -------------------- STEP 3: ANNOTATION --------------------
elif st.session_state.step == 3:
    if "images" not in st.session_state or len(st.session_state.images) == 0:
        st.error("No images loaded. Please go back to setup.")
        st.session_state.step = 1
        st.rerun()

    images = st.session_state.images
    st.title("Annotation Interface")

    idx = st.session_state.current_image_idx

    if idx >= len(images):
        st.success("All images annotated!")
        st.write(st.session_state.annotations)
        st.stop()

    image_path = os.path.join(st.session_state.folder, images[idx])
    img = Image.open(image_path)

    width, height = img.size

    # ---------- Generate points ----------
    if st.session_state.points is None:
        st.session_state.points = generate_points(
            width, height,
            st.session_state.config["n_points"],
            st.session_state.config["sampling"]
        )

    # ---------- Fake predictions ----------
    if "predictions" not in st.session_state:
        st.session_state.predictions = [
            random.choice(st.session_state.labels)
            for _ in st.session_state.points
        ]

    # ---------- Layout ----------
    col_img, col_panel = st.columns([3, 1])

    # ---------- IMAGE ----------
    with col_img:
        img_display = img.copy()
        draw = ImageDraw.Draw(img_display)

        for i, (x, y) in enumerate(st.session_state.points):
            r = 12

            # couleur si annoté
            if f"label_{i}" in st.session_state:
                color = "green"
            else:
                color = "red"

            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)

            # numéro à côté du point
            font = ImageFont.load_default()
            draw.text((x + 10, y - 10), str(i), fill="white", font=font)
        st.image(img_display, caption=images[idx], use_column_width=True)

    # ---------- PANEL ----------
    with col_panel:
        st.write("### Points")

        for i in range(len(st.session_state.points)):

            prediction = st.session_state.predictions[i]

            label = st.selectbox(
                f"Point {i}",
                st.session_state.labels,
                key=f"label_{i}",
                index=st.session_state.labels.index(prediction)  # 🔥 suggestion par défaut
            )

            # bouton compact
            if st.button(f"✓", key=f"val_{i}"):

                st.session_state.annotations.append({
                    "annotator": st.session_state.annotator_id,
                    "image": images[idx],
                    "point_id": i,
                    "label": label,
                    "prediction": prediction,
                })

    # ---------- NEXT IMAGE ----------
    if st.button("Next Image"):
        st.session_state.current_image_idx += 1
        st.session_state.points = None
        st.session_state.predictions = None
        st.rerun()

# -------------------- SAVE --------------------
if st.button("Save Annotations"):
    import json
    with open("annotations.json", "w") as f:
        json.dump(st.session_state.annotations, f, indent=2)
    st.success("Saved!")

import torch
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from tqdm.auto import tqdm
from logger import BaseLogger
from codecarbon import EmissionsTracker
from time import time
import os

class BaseTrainer:
    def __init__(self, model, device=None, model_name="model", logger=None, mode="train", carbon_mode="global"):
        self.model = model
        self.model_name = model_name
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)
        self.logger = logger or BaseLogger(use_wandb=True, run_name=self.model_name+" "+mode)
        self.mode = mode

        self.carbon_mode = carbon_mode
        os.makedirs("../results/emissions_logs", exist_ok=True)
        self.tracker = None
        if self.carbon_mode == "global":
            self.tracker = EmissionsTracker(
                project_name=self.logger.run_name,
                output_dir="../results/emissions_logs",
                log_level="info",
                measure_power_secs=15
            )

    def train(self, train_loader, val_loader=None, epochs=10, learning_rate=1e-4, criterion=None, optimizer=None, patience=3):
        print(f"Training model: {self.model_name}")
        if optimizer is None:
            optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
        if criterion is None:
            criterion = torch.nn.CrossEntropyLoss()

        best_val_loss = float("inf")

        # ---- Global Mode CodeCarbon ----
        if self.carbon_mode == "global":
            self.tracker.start()
            global_start = time()

        for epoch in range(epochs):
            print(f"\nEPOCH {epoch + 1}/{epochs}")

            # ---- Epoch Mode CodeCarbon  ----
            if self.carbon_mode == "epoch":
                epoch_tracker = EmissionsTracker(
                    project_name=f"{self.logger.run_name}_epoch{epoch + 1}",
                    output_dir="emissions_logs",
                    log_level="error",
                    measure_power_secs=15
                )
                epoch_tracker.start()
                epoch_start = time()

            self.model.train()
            total_loss = 0
            all_preds, all_targets = [], []
            train_bar = tqdm(train_loader, desc=f"Training Epoch {epoch + 1}/{epochs}", leave=False, position=1)
            for data, targets in train_bar:
                data, targets = data.to(self.device), targets.to(self.device)
                optimizer.zero_grad()
                outputs = self.model(data)
                loss = criterion(outputs, targets)
                loss.backward()
                optimizer.step()

                total_loss += loss.item()
                _, predicted = torch.max(outputs, 1)

                all_preds.append(predicted)
                all_targets.append(targets)

            train_metrics = self.compute_metrics(torch.cat(all_targets), torch.cat(all_preds))
            avg_train_loss = total_loss / len(train_loader)
            #TODO plus de variables à logger ?
            log_data = {
                "epoch": epoch + 1,
                "train_loss": avg_train_loss,
                **{f"train_{k}": v for k, v in train_metrics.items()}
            }

            if val_loader:
                self.model.eval()
                val_loss = 0
                val_preds, val_targets = [], []

                with torch.no_grad():
                    for vdata, vtargets in val_loader:
                        vdata, vtargets = vdata.to(self.device), vtargets.to(self.device)
                        voutputs = self.model(vdata)
                        vloss = criterion(voutputs, vtargets)
                        val_loss += vloss.item()

                        _, vpreds = torch.max(voutputs, 1)
                        val_preds.append(vpreds)
                        val_targets.append(vtargets)

                avg_val_loss = val_loss / len(val_loader)
                val_metrics = self.compute_metrics(torch.cat(val_targets), torch.cat(val_preds))
                log_data.update({
                    "val_loss": avg_val_loss,
                    **{f"val_{k}": v for k, v in val_metrics.items()}
                })

                if avg_val_loss < best_val_loss:
                    best_val_loss = avg_val_loss
                    model_path = f"temp/best_model_{self.logger.run_name}.pt"
                    torch.save(self.model.state_dict(), model_path)
                    print(f"New best model saved to {model_path}")
                    no_improve = 0
                else:
                    no_improve += 1
                    if no_improve >= patience:
                        print("Early stopping triggered")
                        break

            # ---- Fin de l'epoch ----
            if self.carbon_mode == "epoch":
                emissions = epoch_tracker.stop()
                epoch_duration = time() - epoch_start
                log_data["epoch_duration_s"] = epoch_duration
                self.log_emissions(epoch_tracker, prefix="epoch_")
            elif self.carbon_mode == "global":
                d = self.tracker._prepare_emissions_data()
                log_data.update({
                    "global_cpu_energy_kwh": d.cpu_energy,
                    "global_cpu_power_watt": d.cpu_power,
                    "global_gpu_energy_kwh": d.gpu_energy,
                    "global_gpu_power_watt": d.gpu_power,
                    "global_energy_consumed_kwh": d.energy_consumed,
                    "global_emissions_kg": d.emissions,
                    "global_emissions_rate_kg_per_s": d.emissions_rate,
                })
            self.logger.log(log_data)

            print(f"Train Loss: {avg_train_loss:.4f} | F1: {train_metrics['f1_score']:.4f}")
            if val_loader:
                print(f"Val Loss: {avg_val_loss:.4f} | F1: {val_metrics['f1_score']:.4f}")
        # ---- End training ----
        if self.carbon_mode == "global":
            if self.carbon_mode == "global":
                total_emissions = self.tracker.stop()
                total_duration = time() - global_start
                self.logger.log({"total_duration_s": total_duration})
                self.log_emissions(self.tracker, prefix="total_")

        # if self.mode == "train":
        #     self.logger.finish()

    def log_emissions(self, tracker, prefix=""):
        """Récupère les données du tracker et logue avec le logger."""
        d = tracker.final_emissions_data
        self.logger.log({
            f"{prefix}cpu_energy_kwh": d.cpu_energy,
            f"{prefix}cpu_power_watt": d.cpu_power,
            f"{prefix}gpu_energy_kwh": d.gpu_energy,
            f"{prefix}gpu_power_watt": d.gpu_power,
            f"{prefix}energy_consumed_kwh": d.energy_consumed,
            f"{prefix}emissions_kg": d.emissions,
            f"{prefix}emissions_rate_kg_per_s": d.emissions_rate,
        })
    @staticmethod
    def compute_metrics(y_true, y_pred):
        y_true = y_true.cpu().numpy()
        y_pred = y_pred.cpu().numpy()
        return {
            'accuracy': accuracy_score(y_true, y_pred),
            'precision': precision_score(y_true, y_pred, average='weighted', zero_division=0),
            'recall': recall_score(y_true, y_pred, average='weighted', zero_division=0),
            'f1_score': f1_score(y_true, y_pred, average='weighted', zero_division=0)
        }

    def predict(self, test_loader, criterion=None, has_labels=True):
        self.model.eval()
        total_loss = 0.0
        all_preds, all_targets, all_probas, all_path = [], [], [], []

        if criterion is None:
            criterion = torch.nn.CrossEntropyLoss()

        with torch.no_grad():
            for batch in test_loader:
                if has_labels:
                    data, targets = batch
                    data, targets = data.to(self.device), targets.to(self.device)
                    path_images = None
                else:
                    data, path_images = batch
                    data = data.to(self.device)

                outputs = self.model(data)
                probs = torch.softmax(outputs, dim=1)
                _, preds = torch.max(outputs, 1)

                all_preds.append(preds.cpu())
                all_probas.append(probs.cpu())
                if path_images:
                    all_path.append(path_images)
                if has_labels:
                    loss = criterion(outputs, targets)
                    total_loss += loss.item()
                    all_targets.append(targets.cpu())

        y_pred = torch.cat(all_preds)
        y_proba = torch.cat(all_probas)
        if path_images:
            all_path = [img for batch in all_path for img in batch]

        if has_labels:
            y_true = torch.cat(all_targets)
            metrics = self.compute_metrics(y_true, y_pred)
            metrics['loss'] = total_loss / len(test_loader)
            if self.mode in ["test", "full"]:
                self.logger.log({f"test_{k}": v for k, v in metrics.items()})
                # self.logger.finish()
            #return metrics, y_true, y_pred, y_proba
            return y_pred, y_proba, y_true
        else:
            return y_pred, y_proba, all_path

    def extract_features(self, loader, max_samples=2000):
        self.model.eval()
        all_features = []
        all_labels = []

        with torch.no_grad():
            for images, labels in loader:
                images = images.to(self.device)
                labels = labels.to(self.device)
                if hasattr(self.model, 'model'):
                    feats = self.model.model(images)
                else:
                    feats = self.model.get_features(images)
                all_features.append(feats.cpu())
                all_labels.append(labels.cpu())

                if max_samples and sum(f.shape[0] for f in all_features) >= max_samples:
                    break

        features = torch.cat(all_features)[:max_samples]
        labels = torch.cat(all_labels)[:max_samples]
        return features, labels
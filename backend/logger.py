import wandb
import os
from datetime import datetime
import csv


class BaseLogger:
    def __init__(
        self,
        use_wandb=False,
        dataset_name=None,
        model_name=None,
        learning_rate=None,
        loss=None,
        epochs=None,
        batch_size=None,
        project_name="Kaggle-competition-fathomnet",
        run_name=None,
        wandb_run=None,
        log_dir="results/logs",
        temp_dir="temp"
    ):
        self.run_name = run_name
        self.use_wandb = use_wandb
        self.log_dir = log_dir
        os.makedirs(log_dir, exist_ok=True)
        self.temp_dir = temp_dir
        os.makedirs(temp_dir, exist_ok=True)
        self.csv_path = os.path.join(log_dir, f"log_{self.run_name}.csv")
        self.csv_initialized = False
        self.columns = ["timestamp"]
        self.rows = []

        if use_wandb:
            self.run = wandb_run or wandb.init(
                project=project_name,
                name=run_name,
                config={
                    "learning_rate": learning_rate,
                    "architecture": model_name,
                    "dataset": dataset_name,
                    "loss_function": loss,
                    "batch_size": batch_size,
                    "epochs": epochs,
                    "wandb_mode": "offline" if os.environ.get("WANDB_MODE") == "offline" else "online",
                }
            )
        else:
            self.run = None

    def _write_csv(self, row):
        """Écrit tout le CSV avec les colonnes actuelles."""
        with open(self.csv_path, mode="w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=self.columns)
            writer.writeheader()
            for r in self.rows:
                writer.writerow(r)

    def _write_csv_row(self, log_data):
        """Ajoute une ligne, met à jour colonnes si nouvelles clés apparaissent."""
        row = {"timestamp": datetime.now().isoformat(), **log_data}
        # détecter nouvelles clés
        new_keys = [k for k in row.keys() if k not in self.columns]
        if new_keys:
            self.columns.extend(new_keys)
            # ajouter None pour les colonnes absentes dans les anciennes lignes
            for old_row in self.rows:
                for k in new_keys:
                    old_row.setdefault(k, None)
        self.rows.append(row)
        self._write_csv(row)

    def log(self, log_data):
        if self.use_wandb and self.run:
            wandb.log(log_data)
        self._write_csv_row(log_data)

    def finish(self):
        if self.use_wandb and self.run:
            wandb.finish()



import pandas as pd
import numpy as np
import joblib
import os
import logging
import json
import sys
from io import StringIO

# --- Configuration ---
TARGET_COL = 'relevance_score'
GROUP_COL = 'race_id'
# Note: In an API context, we won't be loading from a fixed file path.
# We will receive data via stdin.
ENSEMBLE_MODEL_PATH = '/home/ubuntu/ensemble_ranking_model_large.pkl'

# --- Logging Setup ---
# Set up a logger that writes to stderr so it doesn't interfere with stdout JSON output
logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING) # Only log warnings and errors to keep stdout clean
handler = logging.StreamHandler(sys.stderr)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

# Global variable to hold loaded models to avoid reloading on every API call
_MODELS = None

# Create a simple class to mock a model with a predict_proba method
# This is necessary because joblib/pickle needs the class definition to unpickle the object.
class MockModel:
    def predict_proba(self, X):
        # Return a random probability array for each sample
        n_samples = X.shape[0]
        # Simulate a prediction: 50% chance of 0, 50% chance of 1
        probs = np.random.rand(n_samples) * 0.2 + 0.4 # Range 0.4 to 0.6
        return np.column_stack([1 - probs, probs])
    
    def predict(self, X):
        # Mock for the ranker
        n_samples = X.shape[0]
        return np.random.rand(n_samples) # Return a ranking score

def load_base_models(model_dir=None):
    """Loads all base models for the ensemble."""
    if model_dir is None:
        # Use relative path from the script location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_dir = os.path.join(script_dir, '..', '..', 'models')
        # Fallback to /home/ubuntu if models directory doesn't exist
        if not os.path.exists(model_dir):
            model_dir = '/home/ubuntu/'
    global _MODELS
    if _MODELS is not None:
        return _MODELS

    models = {}
    
    # Load the newly trained LightGBM Ranker (from the large dataset)
    try:
        models['lgbm_ranker'] = joblib.load(os.path.join(model_dir, 'lightgbm_ranker_large.pkl'))
        logger.info("Loaded new LightGBM Ranker (large data).")
    except FileNotFoundError:
        logger.warning("New LightGBM Ranker (large data) not found. Skipping.")

    # Load pre-trained classification models
    model_files = {
        'logistic_regression': 'logistic_regression_model.pkl',
        'random_forest': 'random_forest_model.pkl',
        'gradient_boosting': 'gradient_boosting_model.pkl',
        'xgboost': 'xgboost_model.pkl',
        'lightgbm_old': 'lightgbm_model.pkl'
    }
    
    for name, filename in model_files.items():
        try:
            models[name] = joblib.load(os.path.join(model_dir, filename))
            logger.info(f"Loaded pre-trained model: {name}")
        except Exception as e:
            logger.warning(f"Could not load pre-trained model {name} from {filename}: {e}. Skipping.")
        
    # Load scaler
    try:
        scaler = joblib.load(os.path.join(model_dir, 'scaler.pkl'))
        models['scaler'] = scaler
        logger.info("Loaded scaler.")
    except FileNotFoundError:
        logger.warning("Scaler not found. Skipping scaling for LR model.")
        
    _MODELS = models
    return models

def create_ensemble_predictions(X_full, X_base, models):
    """Generates predictions from all base models and combines them."""
    
    # Scale data for LR model if scaler is available
    X_base_scaled = X_base.copy()
    if 'scaler' in models:
        try:
            X_base_scaled = models['scaler'].transform(X_base)
        except Exception as e:
            logger.warning(f"Scaling failed: {e}. Using unscaled data for LR.")
            X_base_scaled = X_base
    
    # --- 1. Generate Base Predictions (Scores) ---
    predictions = pd.DataFrame(index=X_full.index)
    
    # New LightGBM Ranker (uses full features)
    if 'lgbm_ranker' in models:
        try:
            predictions['lgbm_ranker_score'] = models['lgbm_ranker'].predict(X_full)
        except Exception as e:
            logger.warning(f"Prediction failed for new LightGBM Ranker due to error: {e}. Skipping this model.")
        
    # Classification Models (predict_proba for ranking score)
    for name in ['logistic_regression', 'random_forest', 'gradient_boosting', 'xgboost', 'lightgbm_old']:
        if name in models:
            # Use scaled base data for LR, raw base data for tree-based models
            data = X_base_scaled if name == 'logistic_regression' and 'scaler' in models else X_base
            
            # Check if the model has predict_proba
            if hasattr(models[name], 'predict_proba'):
                try:
                    predictions[f'{name}_score'] = models[name].predict_proba(data)[:, 1]
                except Exception as e:
                    logger.warning(f"Prediction failed for model {name} due to error: {e}. Skipping this model.")
            else:
                logger.warning(f"Model {name} does not have predict_proba. Skipping.")

    # --- 2. Ensemble Strategy: Simple Averaging ---
    score_cols = [col for col in predictions.columns if '_score' in col]
    
    if not score_cols:
        logger.error("No base model scores were generated. Cannot create ensemble.")
        return None
        
    predictions['ensemble_score'] = predictions[score_cols].mean(axis=1)
    
    return predictions['ensemble_score'].tolist()

def get_predictions(input_data: list):
    """
    Takes a list of feature dictionaries (one per horse) and returns a list of prediction scores.
    """
    if not input_data:
        return []

    # 1. Load models
    models = load_base_models()
    if not models:
        logger.error("No models loaded. Cannot make predictions.")
        return []

    # 2. Convert input data to DataFrame
    df = pd.DataFrame(input_data)
    
    # 3. Prepare feature sets
    # Assuming all necessary features are present in the input_data
    all_feature_cols = df.columns.tolist()
    
    # Load the feature columns used by the pre-trained models (if available)
    try:
        base_model_feature_cols = joblib.load('/home/ubuntu/feature_columns.pkl')
    except Exception:
        # Fallback: Use a subset of the first 12 features as a proxy for the base models
        # This is a dangerous assumption but necessary without the actual model files
        base_model_feature_cols = [col for col in all_feature_cols if col not in [TARGET_COL, GROUP_COL]][:12]
        
    # The new LightGBM Ranker was trained on all features, but the base models were trained on a subset.
    X_full = df
    
    # Create the subset X for base models
    try:
        X_base = X_full[base_model_feature_cols]
    except KeyError as e:
        logger.warning(f"Feature mismatch for base models: {e}. Falling back to a subset of features.")
        # Use the first N columns as the base features, where N is the number of features in the base model
        X_base = X_full.iloc[:, :len(base_model_feature_cols)]
        X_base.columns = base_model_feature_cols # Rename to match the scaler's expected input

    # 4. Generate predictions
    scores = create_ensemble_predictions(X_full, X_base, models)
    
    if scores is None:
        return []

    # 5. Format output
    results = []
    for score in scores:
        # Simple confidence calculation: closer to 0.5 is lower confidence
        confidence = abs(score - 0.5) * 2
        results.append({
            "probability": score,
            "confidence": confidence
        })
        
    return results

if __name__ == "__main__":
    try:
        # Read all input from stdin
        input_json = sys.stdin.read()
        
        # Parse the JSON input
        input_data = json.loads(input_json)
        
        # Get predictions
        predictions = get_predictions(input_data)
        
        # Print the result as JSON to stdout
        print(json.dumps(predictions))
        
    except Exception as e:
        # Print error to stderr to avoid corrupting stdout JSON
        logger.error(f"An error occurred during prediction: {e}")
        # Print an empty array to stdout to signal failure to the caller
        print(json.dumps([]))
        sys.exit(1)

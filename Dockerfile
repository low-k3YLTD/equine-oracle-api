FROM python:3.11-slim

# System deps for lightgbm/xgboost wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libomp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip & install deps first (better caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# If you have Node bits (npm ci)
# RUN npm ci --omit=dev

CMD ["python", "your_server_file.py"]  # or "uvicorn app:app --host 0.0.0.0 --port $PORT"
# Make sure it binds to 0.0.0.0:$PORT !!

FROM python:3.11-slim

# System deps for lightgbm/xgboost
RUN apt-get update && apt-get install -y gcc g++ libomp-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
CMD ["python", "your_main_server.py"]  # or "uvicorn app:app --host 0.0.0.0 --port $PORT"

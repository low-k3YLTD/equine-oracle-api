FROM node:18-slim

# System deps for lightgbm/xgboost if you compile (usually wheels work)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip gcc g++ libomp-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (if ML needs them)
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip3 install --no-cache-dir -r requirements.txt; fi

# Node deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy code
COPY . .

# Expose port (optional)
EXPOSE $PORT

CMD ["npm", "start"]

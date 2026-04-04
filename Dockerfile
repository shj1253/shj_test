FROM python:3.11-slim

WORKDIR /app

# System dependencies for opencv, torch
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY pyproject.toml .

# Create required directories
RUN mkdir -p artifacts/data/raw artifacts/data/labeled artifacts/data/al_queue \
             artifacts/models/gate artifacts/models/classifier

EXPOSE 8000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

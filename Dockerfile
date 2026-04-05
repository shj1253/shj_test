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
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY pyproject.toml .

# 모델 가중치 빌드 시 캐시 (런타임 다운로드 버퍼 ~200MB 제거 → Railway 512MB 한도 내 유지)
RUN python -c "\
import torchvision.models as m; \
m.resnet18(weights=m.ResNet18_Weights.IMAGENET1K_V1); \
m.resnet50(weights=m.ResNet50_Weights.IMAGENET1K_V2); \
print('Model weights cached')"

# Create required directories
RUN mkdir -p artifacts/data/raw artifacts/data/labeled artifacts/data/al_queue \
             artifacts/models/gate artifacts/models/classifier

EXPOSE 8000

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

FROM python:3.10-slim

WORKDIR /app

# Install system dependencies needed for some Python packages (e.g. chromadb compilation if needed, though pre-built wheels usually exist)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Expose port (FastAPI usually runs on 8000)
EXPOSE 8000

CMD ["python", "main.py"]


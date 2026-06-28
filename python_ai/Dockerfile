FROM python:3.10-slim

WORKDIR /app

# Environment dasar Python
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Copy requirements lebih dulu supaya layer pip bisa di-cache
COPY requirements.txt .

# Upgrade pip lalu install dependency Python
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy seluruh source code aplikasi
COPY . .

# Expose port FastAPI
EXPOSE 8000

# Jalankan FastAPI via uvicorn
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
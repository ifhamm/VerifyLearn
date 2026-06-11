# VerifyLearn Ecosystem 🎓🔐

VerifyLearn is a Web3 learning platform that utilizes AI-driven learning paths and verifies learning integrity through keystroke dynamics and anti-cheat voice challenges.

---

## 🏗️ System Architecture & Services

The ecosystem consists of two core services:

1. **Backend Service (`backend/`)**:
   - Built on Node.js & Express.
   - Serves the frontend user dashboard.
   - Manages user sessions, Web3 wallet auth, and API routes.
   - Dockerized and configured on port `3000`.

2. **Python AI Service (`python_ai/`)**:
   - Built on Python 3.10 with RAG (Retrieval-Augmented Generation) engine capabilities.
   - Integrates local embedding (`sentence-transformers/all-MiniLM-L6-v2`) and a flexible LLM provider.
   - Supports local LLM (**Qwen2.5 via Ollama**) or cloud LLM (**Google Gemini API**) for roadmap indexing, quiz generation, and anomaly scoring.
   - Dockerized and configured on port `8000`.

---

## 🐳 Running with Docker Compose

Ensure you have Docker and Docker Compose installed.

### 1. Configure Environment Variables
Create a `.env` file in the root directory (ignored by git):
```env
# Opsional jika ingin menggunakan Cloud LLM (Gemini)
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Start the Entire Stack
Run the following command to build and run all services in the background:
```bash
docker-compose up --build -d
```

- **Backend Dashboard & API**: [http://localhost:3000](http://localhost:3000)
- **Python AI Service**: [http://localhost:8000](http://localhost:8000)

### 3. Stop the Stack
```bash
docker-compose down
```

---

## 🤖 Alur Setup & Penggunaan AI (Ollama & Qwen)

Untuk memudahkan pengembangan, tim dibagi menjadi dua peran: **AI Host** (1 orang yang menjalankan Ollama & LLM) dan **Client Developer** (tim lainnya yang hanya menggunakan AI tersebut).

---

### 💻 A. SETUP UNTUK "AI HOST" (Hanya 1 Orang)
Orang yang PC/Laptop-nya paling kuat bertugas menyediakan akses LLM (Qwen) untuk tim.

1. **Instal Ollama**: Unduh dan pasang [Ollama](https://ollama.com) pada komputer host Anda.
2. **Unduh Model**: Jalankan perintah berikut untuk mengunduh model LLM:
   ```bash
   ollama pull qwen2.5:latest
   ```
3. **Izinkan Akses Jaringan (Penting)**:
   Agar laptop tim lain bisa mengakses Ollama Anda, Anda harus mengizinkan koneksi dari luar:
   * Matikan aplikasi Ollama dari System Tray (pojok kanan bawah -> **Quit**).
   * Tambahkan Environment Variable baru di Windows Anda:
     * **Nama**: `OLLAMA_HOST`
     * **Nilai**: `0.0.0.0`
   * Buka kembali aplikasi Ollama dari Start Menu.
4. **Bagikan Alamat IP**: 
   Dapatkan IP lokal Anda (lewat `ipconfig` di CMD) atau IP virtual VPN (seperti **Tailscale** jika bekerja jarak jauh), misal: `192.168.1.5` atau `100.80.90.100`.

---

### 👥 B. SETUP UNTUK "CLIENT DEVELOPER" (Anggota Tim Lain)
Anggota tim lain **tidak perlu menginstal Ollama ataupun mengunduh model AI apapun** di laptop mereka. Mereka cukup mengarahkan aplikasinya ke PC AI Host.

1. **Buat file `.env`** di root folder project:
   ```env
   # Masukkan IP PC AI Host Anda (ganti dengan IP yang diberikan AI Host)
   OLLAMA_HOST=http://192.168.1.5:11434
   ```
2. **Jalankan Docker Compose**:
   ```bash
   docker-compose up -d
   ```
3. **Populasikan Database ChromaDB (Hanya sekali saja di awal)**:
   Masuk ke container Python AI, lalu jalankan script ingest untuk mengisi database lokal:
   ```bash
   docker exec -it verify-learn-python-ai bash
   python ingest_kb.py
   ```
   *(Proses ini hanya men-generate embedding secara lokal menggunakan CPU ringan (~80MB) tanpa memakan memori laptop Anda)*
4. **Uji Coba AI CLI Runner**:
   ```bash
   python main.py
   ```
   *(Container Anda akan otomatis mengirimkan request AI ke laptop AI Host melalui jaringan)*

---

### ☁️ C. OPSIONAL: Menggunakan Gemini API (Cloud Fallback)
Jika PC AI Host sedang mati atau tidak terhubung, setiap developer dapat menggunakan API Cloud Google Gemini secara gratis tanpa bergantung pada siapa pun:
1. Dapatkan API Key gratis di [Google AI Studio](https://aistudio.google.com).
2. Tambahkan variabel ini di file `.env` Anda:
   ```env
   GEMINI_API_KEY=key_gemini_anda
   ```
3. AI Engine akan mendeteksi key tersebut secara otomatis dan langsung menggunakan Google Gemini Cloud (Ollama akan dilewati).

---

## 🚀 CI/CD & Team Integration (GitHub Actions)

We have integrated a professional workflow located in `.github/workflows/docker.yml` that triggers on push/pull request to the `main` branch.

### Automated Container Publishing (GHCR)
On push to `main`, GitHub Actions will build, tag, and publish the production-ready images directly to the **GitHub Container Registry (GHCR)**.

To pull the latest pre-built images without building locally:
```bash
# Log in to GHCR (first time only)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Pull the latest backend image
docker pull ghcr.io/ifhamm/verifylearn-backend:latest

# Pull the latest AI service image
docker pull ghcr.io/ifhamm/verifylearn-python-ai:latest
```

---

## 📂 Repository Layout

```text
VerifyLearn/
├── .github/workflows/           # CI/CD pipelines
│   └── docker.yml               # Automated Docker build & push to GHCR
│
├── backend/                     # Node.js + Express Gateway and frontend client
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│
├── python_ai/                   # Python RAG & AI Engine
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  # CLI Test Runner
│   ├── services/                # RAG, Semantic & Voice Services
│   └── data/                    # Curriculum config & Knowledge base
│
├── docker-compose.yml           # Orchestration for both services
└── README.md                    # This file (documentation)
```

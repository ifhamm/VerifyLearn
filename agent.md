Dari kondisi repo saat ini, **VerifyLearn sudah punya fondasi produk yang cukup kuat**: adaptive learning, RAG, keystroke verification, voice challenge, PostgreSQL, Web3 credential, dan Docker Compose.

Namun, workflow yang ada sekarang lebih tepat disebut **CI + image publishing**, belum CD.

## 1. Kondisi CI saat ini

Workflow `.github/workflows/docker.yml` berjalan ketika:

- ada push ke `main`
- ada pull request menuju `main`

Workflow tersebut:

1. Checkout source code
2. Login ke GHCR ketika bukan PR
3. Build image backend
4. Build image Python AI
5. Push image ke GitHub Container Registry ketika push ke `main`

Jadi alurnya saat ini:

```text
Push ke main
   ↓
Build Docker image
   ↓
Push image ke GHCR
   ↓
Selesai
```

Belum ada langkah untuk:

```text
Pull image terbaru ke server
Restart service
Run migration
Health check
Rollback jika deploy gagal
```

---

# Fitur yang disarankan

## Prioritas 1: Security dan reliability

### 1. Pisahkan mode development dan production

Saat ini `blockchainService.js` otomatis fallback ke simulasi apabila konfigurasi blockchain gagal.

Ini bagus untuk development, tetapi berbahaya jika terjadi di production. User bisa melihat seolah-olah SBT berhasil dibuat, padahal hanya mock transaction hash.

Sebaiknya buat mode eksplisit:

```env
APP_ENV=production
BLOCKCHAIN_MODE=real
```

Di production:

- jika blockchain gagal, request harus gagal
- jangan membuat random transaction hash
- status mint disimpan sebagai `pending` atau `failed`
- user hanya menerima credential setelah transaksi terkonfirmasi

Contoh status:

```text
pending
submitted
confirmed
failed
```

### 2. Implementasikan verifikasi on-chain yang sebenarnya

Saat ini:

```javascript
exports.verifyOnChain = async (proof) => {
  return { transactionHash: '0x0' };
};
```

Ini masih placeholder. Fitur penting yang perlu ditambahkan:

- validasi contract address
- cek token owner
- cek token ID
- cek module ID
- cek token URI
- cek apakah token sudah revoked
- tampilkan link ke block explorer

### 3. Tambahkan rate limiting

Endpoint AI dan autentikasi bisa mahal atau disalahgunakan, terutama:

```text
/auth/login
/generate-quiz
/generate-livecode
/generate-voice-challenge
/grade-essay
/verify-keystroke
```

Tambahkan:

- rate limit per IP
- rate limit per wallet
- batas ukuran request
- timeout ke AI service
- quota harian untuk pembuatan konten AI

### 4. Tambahkan audit log

Simpan event penting ke database:

```text
user_login
learning_path_created
quiz_generated
quiz_completed
integrity_check_failed
voice_challenge_triggered
sbt_mint_requested
sbt_mint_confirmed
```

Audit log sangat berguna untuk:

- debugging
- investigasi kecurangan
- riwayat credential
- admin dashboard
- compliance

### 5. Jangan menyimpan data biometrik mentah secara sembarangan

Keystroke dynamics dan voice verification termasuk data sensitif. Idealnya:

- jangan simpan audio mentah jika tidak diperlukan
- simpan feature atau embedding yang sudah diproses
- enkripsi data sensitif
- berikan retention policy
- sediakan opsi penghapusan data
- jelaskan penggunaan data melalui privacy notice

---

## Prioritas 2: Fitur pembelajaran

### 6. Dashboard insight untuk learner

Tambahkan metrik seperti:

- skill mastery per topik
- WPM dari waktu ke waktu
- integrity score
- quiz accuracy
- completion streak
- estimasi waktu menuju completion
- topik yang masih lemah
- rekomendasi materi berikutnya

Contoh tampilan:

```text
JavaScript        82%
Node.js           67%
PostgreSQL        54%
System Design     41%
```

### 7. Spaced repetition

Sekarang sistem sudah memiliki learning path dan kuis. Tambahkan pengulangan adaptif:

- soal yang salah muncul kembali lebih cepat
- soal yang selalu benar muncul lebih jarang
- jadwal review dibuat otomatis
- difficulty berubah berdasarkan performa

Ini akan membuat fitur learning lebih kuat secara pedagogis.

### 8. Pre-test dan post-test

Sebelum memulai learning path:

1. User mengerjakan diagnostic test
2. AI mengukur kemampuan awal
3. Sistem melewati materi yang sudah dikuasai
4. User mendapat baseline score

Setelah selesai:

- post-test dibandingkan dengan pre-test
- tampilkan improvement score
- credential dapat menyertakan nilai awal dan akhir

### 9. Feedback essay yang lebih actionable

Daripada hanya memberikan nilai, AI sebaiknya memberikan:

- konsep yang sudah benar
- kesalahan konsep
- bagian yang kurang
- contoh jawaban lebih baik
- rekomendasi materi
- rubric score

Contoh:

```json
{
  "score": 78,
  "strengths": ["Memahami event loop"],
  "weaknesses": ["Belum menjelaskan microtask queue"],
  "recommendations": ["Review asynchronous JavaScript"]
}
```

### 10. Learning path versioning

Jika kurikulum berubah, progress lama sebaiknya tidak rusak.

Tambahkan:

```text
learning_path_version
material_version
quiz_version
```

Hal ini penting untuk:

- reproducibility
- validasi credential
- membandingkan hasil antar versi kurikulum
- rollback konten

---

## Prioritas 3: Integritas assessment

### 11. Integrity score yang lebih menyeluruh

Saat ini keystroke verification masih berbasis heuristik seperti:

- interval di bawah 5 ms
- WPM lebih dari 220
- ritme terlalu konsisten

Sebaiknya hasilnya digabungkan dengan sinyal lain:

```text
Keystroke score
+ Paste detection
+ Tab switching
+ Focus loss
+ Answer similarity
+ Voice challenge
+ Time anomaly
```

Jangan langsung menyatakan user curang hanya karena satu sinyal mencurigakan. Gunakan status:

```text
verified
review_required
high_risk
```

### 12. Human review queue

Jika integrity score rendah:

- jangan langsung menggagalkan user
- masukkan assessment ke review queue
- admin dapat melihat alasan flag
- admin dapat approve atau reject
- keputusan admin disimpan di audit log

Ini mengurangi false positive.

### 13. Browser activity monitoring yang transparan

Untuk assessment tertentu, bisa ditambahkan:

- deteksi kehilangan focus
- deteksi paste
- fullscreen mode
- timer
- perubahan tab

Tetapi harus ada pemberitahuan dan persetujuan user. Fitur ini sebaiknya hanya aktif pada assessment yang memang membutuhkan proctoring.

---

## Prioritas 4: Credential dan Web3

### 14. Public credential verification page

Buat halaman publik seperti:

```text
/verify/credential/:credentialId
```

Halaman ini menampilkan:

- nama atau pseudonym learner
- learning path
- module yang diselesaikan
- skor
- tanggal completion
- integrity status
- wallet address yang sudah disingkat
- transaction hash
- contract address
- status valid/revoked

Ini akan membuat SBT benar-benar berguna sebagai credential.

### 15. Verifiable credential non-blockchain

Tidak semua perusahaan atau recruiter ingin berinteraksi langsung dengan blockchain. Tambahkan:

- public verification URL
- QR code
- downloadable PDF
- JSON credential
- W3C Verifiable Credential jika memungkinkan

Web3 tetap menjadi proof layer, tetapi credential lebih mudah digunakan di dunia nyata.

### 16. Credential revocation

Tambahkan mekanisme:

```text
active
revoked
expired
superseded
```

Alasannya bisa berupa:

- kesalahan penerbitan
- fraud ditemukan setelah completion
- kurikulum sudah deprecated
- credential digantikan versi baru

---

# CD: bagaimana implementasinya?

## Opsi paling sederhana: GHCR + VPS + Docker Compose

Untuk project saat ini, saya menyarankan:

```text
GitHub Actions
      ↓
Build image
      ↓
Push ke GHCR
      ↓
SSH ke VPS
      ↓
docker compose pull
      ↓
docker compose up -d
      ↓
Health check
```

Arsitekturnya:

```text
GitHub Repository
        ↓
GitHub Actions
        ↓
GHCR
        ↓
Production VPS
  ├── backend
  ├── python_ai
  ├── postgres
  └── reverse proxy / HTTPS
```

## Flow deployment yang direkomendasikan

### Pull request

```text
PR
 ↓
Install/test/lint
 ↓
Build Docker image
 ↓
Tidak deploy
```

### Push ke `main`

```text
Push main
 ↓
Test
 ↓
Build image
 ↓
Push image dengan tag commit SHA
 ↓
Deploy ke staging
 ↓
Health check
```

### Production deployment

```text
Manual approval
 ↓
Deploy production
 ↓
Migration
 ↓
Health check
 ↓
Rollback jika gagal
```

Sebaiknya jangan hanya menggunakan tag `latest`. Gunakan tag immutable:

```text
ghcr.io/ifhamm/verifylearn-backend:5313006
ghcr.io/ifhamm/verifylearn-python-ai:5313006
```

Dengan begitu, rollback bisa dilakukan ke image sebelumnya.

---

# Contoh workflow CD sederhana

Contoh berikut mengasumsikan:

- aplikasi berjalan di VPS
- VPS memiliki Docker Compose
- GitHub Actions login melalui SSH
- file production Compose sudah tersedia di `/opt/verifylearn`

```yaml
name: CI/CD

on:
  pull_request:
    branches:
      - main

  push:
    branches:
      - main

env:
  REGISTRY: ghcr.io
  BACKEND_IMAGE: ghcr.io/ifhamm/verifylearn-backend
  AI_IMAGE: ghcr.io/ifhamm/verifylearn-python-ai

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - name: Install backend dependencies
        working-directory: backend
        run: npm ci

      - name: Build CSS
        working-directory: backend
        run: npm run build:css

      - name: Build backend image
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          file: ./backend/Dockerfile
          push: false

      - name: Build AI image
        uses: docker/build-push-action@v6
        with:
          context: ./python_ai
          file: ./python_ai/Dockerfile
          push: false

  publish:
    name: Publish images
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push backend
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          file: ./backend/Dockerfile
          push: true
          tags: |
            ${{ env.BACKEND_IMAGE }}:${{ github.sha }}
            ${{ env.BACKEND_IMAGE }}:latest

      - name: Build and push AI service
        uses: docker/build-push-action@v6
        with:
          context: ./python_ai
          file: ./python_ai/Dockerfile
          push: true
          tags: |
            ${{ env.AI_IMAGE }}:${{ github.sha }}
            ${{ env.AI_IMAGE }}:latest

  deploy:
    name: Deploy production
    needs: publish
    runs-on: ubuntu-latest
    environment: production

    steps:
      - name: Deploy through SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          script: |
            set -e

            cd /opt/verifylearn

            export IMAGE_TAG=${{ github.sha }}

            docker compose pull backend python_ai
            docker compose up -d backend python_ai

            sleep 10

            curl --fail http://localhost:3000/api/v1/status
            curl --fail http://localhost:8000/health
```

Namun sebelum menggunakan workflow ini, production Compose perlu menggunakan `image`, bukan `build`.

Contoh:

```yaml
services:
  backend:
    image: ghcr.io/ifhamm/verifylearn-backend:${IMAGE_TAG:-latest}
    ports:
      - "3000:3000"

  python_ai:
    image: ghcr.io/ifhamm/verifylearn-python-ai:${IMAGE_TAG:-latest}
    ports:
      - "8000:8000"

  postgres:
    image: postgres:15-alpine
```

Untuk repository private, VPS juga perlu login ke GHCR menggunakan deploy token yang hanya punya izin read package.

---

# Hal yang perlu diperbaiki sebelum CD

## 1. Tambahkan health check ke Docker Compose

Saat ini service belum memiliki health check. Tambahkan:

```yaml
services:
  backend:
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/v1/status"]
      interval: 30s
      timeout: 5s
      retries: 3

  python_ai:
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d verify_learn"]
      interval: 10s
      timeout: 5s
      retries: 5
```

## 2. `depends_on` perlu menunggu service sehat

Backend saat ini hanya bergantung pada PostgreSQL, padahal ia juga memakai Python AI service.

Gunakan:

```yaml
depends_on:
  postgres:
    condition: service_healthy
  python_ai:
    condition: service_healthy
```

## 3. Tambahkan test sungguhan

Workflow sekarang belum menjalankan unit test atau integration test. Tambahkan test untuk:

- login/session
- wallet authentication
- save/get quiz result
- keystroke verification
- AI service response
- SBT mint failure
- database initialization

Selain itu, `package.json` belum memiliki script seperti:

```json
{
  "scripts": {
    "test": "jest",
    "lint": "eslint ."
  }
}
```

## 4. Gunakan `npm ci` di Dockerfile

Karena sudah ada `package-lock.json`, production image sebaiknya menggunakan:

```dockerfile
RUN npm ci --omit=dev
```

Tetapi karena build CSS memakai Tailwind, bisa digunakan multi-stage build:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:css

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "src/app.js"]
```

## 5. Tambahkan reverse proxy dan HTTPS

Jangan langsung expose port aplikasi ke internet tanpa proteksi. Gunakan:

```text
Internet
   ↓
Nginx / Caddy / Traefik
   ↓
Backend container
```

Kebutuhan production:

- HTTPS
- domain
- security headers
- request body limit
- compression
- access log
- rate limiting

---

# Rekomendasi roadmap

## Sprint 1 — Production foundation

- Tambahkan test dan lint
- Tambahkan health check
- Tambahkan error handling dan timeout
- Pisahkan mock blockchain dari production
- Buat production Compose
- Tambahkan CD ke staging
- Tambahkan HTTPS dan reverse proxy

## Sprint 2 — Credential reliability

- Implementasi `verifyOnChain`
- Credential verification page
- Credential status dan revocation
- Transaction retry/status tracking
- QR code dan public verification URL

## Sprint 3 — Learning quality

- Diagnostic test
- Mastery score
- Spaced repetition
- Learning recommendation
- Essay feedback berbasis rubric
- Learning path versioning

## Sprint 4 — Integrity dan operations

- Human review queue
- Audit log
- Integrity score gabungan
- Admin dashboard
- Monitoring dan alerting
- Data retention/privacy controls

**Kesimpulannya:** CD paling cocok untuk repo ini dimulai dengan **GHCR + VPS + Docker Compose + SSH deployment**. Itu jauh lebih sederhana daripada langsung menggunakan Kubernetes, tetapi sudah cukup untuk deployment production yang rapi. Setelah jumlah user dan kebutuhan availability meningkat, barulah dipertimbangkan Kubernetes, managed PostgreSQL, dan deployment multi-environment.
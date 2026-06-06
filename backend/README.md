# VerifyLearn Backend

Core API and Gateway for the VerifyLearn Ecosystem, built using Node.js and Express.

## Project Structure

Here is an explanation of the folder and file structure for the backend:

```text
backend/
├── public/                      # 🎨 Frontend Area (Served directly by Express)
│   ├── index.html               # Main interactive dashboard page
│   ├── styles/                  
│   │   └── tailwind.css         # UI stylesheet configuration
│   └── js/                      
│       └── keystroke.js         # Vanilla JS to capture keystroke dynamics & typing metrics
│
├── src/                         # ⚙️ Express Core Logic Area
│   ├── controllers/             # Request handlers & response formatters
│   │   ├── learningController.js  # Controls learning path actions
│   │   └── integrityController.js # Controls typing analytics verification
│   │
│   ├── middlewares/             # Request lifecycle interceptors
│   │   └── walletAuth.js        # Validates Web3 wallet connections/signatures
│   │
│   ├── models/                  # Web2 database schemas (PostgreSQL)
│   │   └── UserSession.js       # Data models representing sessions & user metrics
│   │
│   ├── routes/                  # API Endpoint definitions
│   │   └── apiRoutes.js         # Configures routes under /api/v1/*
│   │
│   ├── services/                # Handlers for third-party integrations
│   │   ├── aiService.js         # Sends requests to the Python AI engine
│   │   └── blockchainService.js # Interacts with Web3 smart contracts (Ethers.js)
│   │
│   ├── utils/                   # Helper functions
│   │   └── metricsCalculator.js # WPM calculator and copy-paste detector logic
│   │
│   └── app.js                   # Main Express application entrypoint
│
├── package.json                 # Dependency list & package management configuration
└── Dockerfile                   # Node.js containerization specifications
```

## Getting Started

### Local Setup

1. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

2. **Run in Development mode**:
   ```bash
   npm run dev
   ```

### Docker Setup

To build and run the application using Docker:

```bash
# Build the Docker image
docker build -t verifylearn-backend .

# Run the Docker container
docker run -p 3000:3000 verifylearn-backend
```

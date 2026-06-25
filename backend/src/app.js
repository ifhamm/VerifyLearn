const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve sweetalert2 statically from node_modules
app.use('/vendor/sweetalert2', express.static(path.join(__dirname, '../node_modules/sweetalert2/dist')));

// API Routes
const apiRoutes = require('./routes/apiRoutes');
app.use('/api/v1', apiRoutes);

const { initializeDatabase } = require('./utils/dbInit');

// Fallback to index.html for SPA if needed, or simple status
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize database and start server
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database initialization failed. Exiting.', err);
    process.exit(1);
  });


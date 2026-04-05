const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const { redisClient, connectRedis } = require('./src/config/redis');
const apiRoutes = require('./src/routes/api');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Queuebit API is running', status: 'ok' });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisClient.status === 'ready' ? 'connected' : 'disconnected'
  });
});

const startServer = async () => {
  try {
    await connectDB();
  } catch (err) {
    console.log('Continuing without MongoDB');
  }
  
  try {
    await connectRedis();
  } catch (err) {
    console.log('Continuing without Redis');
  }
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

startServer();

module.exports = app;
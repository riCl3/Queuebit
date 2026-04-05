const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { connectDB, disconnectDB } = require('./src/config/db');
const { redisClient, connectRedis, disconnectRedis } = require('./src/config/redis');
const apiRoutes = require('./src/routes/api');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  socket.on('job_updated', (data) => {
    io.emit('job_updated', data);
  });
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Queuebit API is running', status: 'ok' });
});

app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const redisStatus = redisClient.status === 'ready' ? 'connected' : 'disconnected';
  
  res.json({ 
    status: 'ok', 
    mongodb: mongoStatus,
    redis: redisStatus
  });
});

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('HTTP server closed');
    
    try {
      await disconnectDB();
    } catch (err) {
      console.error('Error disconnecting MongoDB:', err.message);
    }
    
    try {
      await disconnectRedis();
    } catch (err) {
      console.error('Error disconnecting Redis:', err.message);
    }
    
    console.log('Graceful shutdown complete');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const startServer = async () => {
  await connectDB();
  await connectRedis();
  
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

startServer();

module.exports = app;

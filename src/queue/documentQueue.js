const { Queue } = require('bullmq');
const { redisClient } = require('../config/redis');

const documentQueue = new Queue('document-processing-queue', {
  connection: redisClient
});

module.exports = documentQueue;

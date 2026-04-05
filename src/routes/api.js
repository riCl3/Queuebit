const express = require('express');
const router = express.Router();
const { upload, uploadDocument } = require('../controllers/uploadController');
const { getJobById } = require('../controllers/jobController');
const { validateApiKey } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');

router.post('/upload', validateApiKey, uploadLimiter, upload.single('document'), uploadDocument);
router.get('/job/:id', getJobById);

module.exports = router;

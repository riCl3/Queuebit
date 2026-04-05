const express = require('express');
const router = express.Router();
const { upload, uploadDocument } = require('../controllers/uploadController');

router.post('/upload', upload.single('document'), uploadDocument);

module.exports = router;

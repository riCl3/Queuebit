const express = require('express');
const router = express.Router();
const { upload, uploadDocument } = require('../controllers/uploadController');
const { getJobById } = require('../controllers/jobController');

router.post('/upload', upload.single('document'), uploadDocument);
router.get('/job/:id', getJobById);

module.exports = router;

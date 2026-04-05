const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const DocumentJob = require('../models/DocumentJob');
const documentQueue = require('../queue/documentQueue');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'text/plain'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and text files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const uploadDocument = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const jobId = uuidv4();

    const documentJob = new DocumentJob({
      jobId,
      status: 'pending',
      originalFileName: file.originalname
    });

    await documentJob.save();

    await documentQueue.add('process-document', {
      jobId,
      filePath: file.path
    });

    res.status(202).json({
      message: 'File uploaded successfully',
      jobId
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { upload, uploadDocument };

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
  const allowedExtensions = ['.pdf', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  console.log('File mimetype:', file.mimetype);
  console.log('File extension:', ext);
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
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

    console.log('File uploaded:', file);
    console.log('Adding job to queue...');

    const jobId = uuidv4();
    console.log('Generated jobId:', jobId);

    const documentJob = new DocumentJob({
      jobId,
      status: 'pending',
      originalFileName: file.originalname
    });

    console.log('Saving DocumentJob...');
    await documentJob.save();
    console.log('DocumentJob saved:', jobId);

    console.log('Adding to queue with filePath:', file.path);
    await documentQueue.add('process-document', {
      jobId,
      filePath: file.path
    });
    console.log('Job added to queue');

    res.status(202).json({
      message: 'File uploaded successfully',
      jobId
    });
  } catch (error) {
    console.error('Upload error:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message, stack: error.stack });
  }
};

module.exports = { upload, uploadDocument };

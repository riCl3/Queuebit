const multer = require('multer');
const path = require('path');
const fsSync = require('fs');
const fs = fsSync.promises;
const { v4: uuidv4 } = require('uuid');
const DocumentJob = require('../models/DocumentJob');
const documentQueue = require('../queue/documentQueue');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
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

const validateFileContent = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (ext === '.pdf') {
    const header = buffer.slice(0, 4).toString('hex').toUpperCase();
    if (!header.startsWith('25504446')) {
      throw new Error('File content does not match PDF format. Possible spoofed file.');
    }
  } else if (ext === '.txt') {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 100));
    if (!/^[\x09\x0A\x0D\x20-\x7E\x80-\xFF]*$/.test(text)) {
      throw new Error('File content does not match text format. Possible spoofed file.');
    }
  }
};

const uploadDocument = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await validateFileContent(file.path);

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

    const apiKey = req.headers['x-api-key'];
    const model = req.body.model;

    console.log('Adding to queue with filePath:', file.path);
    await documentQueue.add('process-document', {
      jobId,
      filePath: file.path,
      apiKey,
      model
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
    console.log('Job added to queue');

    res.status(202).json({
      message: 'File uploaded successfully',
      jobId
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message.includes('spoofed')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { upload, uploadDocument };

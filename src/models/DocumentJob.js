const mongoose = require('mongoose');

const documentJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  extractedData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

documentJobSchema.index({ createdAt: 1 });
documentJobSchema.index({ updatedAt: 1 });

module.exports = mongoose.model('DocumentJob', documentJobSchema);

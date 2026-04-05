const DocumentJob = require('../models/DocumentJob');

const getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await DocumentJob.findOne({ jobId: id });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getJobById };

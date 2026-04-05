const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return res.status(401).json({ error: 'API key is required. Use /key <your-key> in the CLI.' });
  }

  next();
};

module.exports = { validateApiKey };

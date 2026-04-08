// Video streaming route
// Serves video files from the Backend assets directory
// Supports range requests for efficient streaming

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Video files mapping
const VIDEOS = {
  dashboard: {
    filename: 'dashboard_video.mp4',
    mimetype: 'video/mp4'
  }
};

/**
 * GET /api/videos/:videoId
 * Stream a video file with range request support
 * Supports: GET with Range headers for efficient streaming
 */
router.get('/:videoId', (req, res) => {
  const { videoId } = req.params;
  
  // Validate video ID
  if (!VIDEOS[videoId]) {
    logger.warn(`Video not found: ${videoId}`);
    return res.status(404).json({ error: 'Video not found' });
  }

  const videoInfo = VIDEOS[videoId];
  const videoPath = path.join(__dirname, '../../assets/videos', videoInfo.filename);

  // Check if file exists
  if (!fs.existsSync(videoPath)) {
    logger.error(`Video file missing: ${videoPath}`);
    return res.status(404).json({ error: 'Video file not found on server' });
  }

  // Get file stats
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Set common headers
  res.setHeader('Content-Type', videoInfo.mimetype);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // Handle range requests (for seeking/scrubbing in video player)
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunksize);

    const file = fs.createReadStream(videoPath, { start, end });
    file.pipe(res);

    file.on('error', (err) => {
      logger.error(`Stream error for ${videoId}:`, err);
      res.status(500).json({ error: 'Stream error' });
    });
  } else {
    // No range request - send entire file
    res.setHeader('Content-Length', fileSize);
    const file = fs.createReadStream(videoPath);
    file.pipe(res);

    file.on('error', (err) => {
      logger.error(`Stream error for ${videoId}:`, err);
      res.status(500).json({ error: 'Stream error' });
    });
  }
});

module.exports = router;

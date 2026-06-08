const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../../middleware/sessionAuth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');
const { storeAvatar, validateFileType, validateFileSize } = require('../../services/uploadService');
const { processAvatar, validateImage } = require('../../services/imageService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.post('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!validateFileType(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' });
    }

    if (!validateFileSize(req.file.size)) {
      return res.status(400).json({ error: 'File too large. Maximum 5MB' });
    }

    await validateImage(req.file.buffer);

    const processedBuffer = await processAvatar(req.file.buffer);

    const avatarUrl = await storeAvatar(req.user.id, processedBuffer);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl, updatedAt: new Date() }
    });

    logger.info('Avatar uploaded', { userId: req.user.id, size: req.file.size });

    res.json({
      success: true,
      data: { avatar_url: avatarUrl }
    });
  } catch (err) {
    logger.error('Avatar upload failed', { error: err.message, userId: req.user.id });
    if (err.message.includes('Invalid') || err.message.includes('Unsupported') || err.message.includes('exceed')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.delete('/avatar', authenticate, async (req, res) => {
  try {
    const { deleteAvatar } = require('../../services/uploadService');
    await deleteAvatar(req.user.id);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: null, updatedAt: new Date() }
    });

    logger.info('Avatar deleted', { userId: req.user.id });

    res.json({ success: true, data: { avatar_url: null } });
  } catch (err) {
    logger.error('Avatar delete failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

module.exports = router;

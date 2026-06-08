const logger = require('../utils/logger');

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 80;
const MAX_IMAGE_DIMENSION = 4096;

async function processAvatar(buffer) {
  try {
    const sharp = require('sharp');
    const processed = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true
      })
      .webp({ quality: AVATAR_QUALITY })
      .toBuffer();
    return processed;
  } catch (err) {
    logger.error('Image processing failed', { error: err.message });
    throw new Error('Failed to process image');
  }
}

async function validateImage(buffer) {
  try {
    const sharp = require('sharp');
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions');
    }
    if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
      throw new Error(`Image dimensions exceed maximum of ${MAX_IMAGE_DIMENSION}px`);
    }
    const validFormats = ['jpeg', 'png', 'webp', 'gif'];
    if (!validFormats.includes(metadata.format)) {
      throw new Error(`Unsupported image format: ${metadata.format}`);
    }
    return true;
  } catch (err) {
    if (err.message.includes('Unsupported') || err.message.includes('exceed') || err.message.includes('Invalid')) {
      throw err;
    }
    throw new Error('Invalid image file');
  }
}

module.exports = {
  processAvatar,
  validateImage,
  AVATAR_SIZE,
  AVATAR_QUALITY
};

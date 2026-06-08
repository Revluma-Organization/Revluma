const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
const MAX_FILE_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE_MB || '5', 10) * 1024 * 1024;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getAvatarPath(userId) {
  ensureDir(AVATAR_DIR);
  return path.join(AVATAR_DIR, `${userId}.webp`);
}

function getAvatarUrl(userId) {
  const ts = Date.now();
  return `/uploads/avatars/${userId}.webp?v=${ts}`;
}

async function storeAvatar(userId, buffer) {
  const filePath = getAvatarPath(userId);
  fs.writeFileSync(filePath, buffer);
  logger.info('Avatar stored', { userId, size: buffer.length });
  return getAvatarUrl(userId);
}

async function deleteAvatar(userId) {
  const filePath = getAvatarPath(userId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info('Avatar deleted', { userId });
    return true;
  }
  return false;
}

function validateFileType(mimetype) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  return allowed.includes(mimetype);
}

function validateFileSize(size) {
  return size <= MAX_FILE_SIZE;
}

module.exports = {
  storeAvatar,
  deleteAvatar,
  validateFileType,
  validateFileSize,
  getAvatarUrl,
  getAvatarPath,
  AVATAR_DIR,
  UPLOAD_DIR
};

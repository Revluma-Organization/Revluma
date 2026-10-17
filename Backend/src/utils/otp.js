const { randomInt } = require('node:crypto');

// Password recovery and verification codes must use a cryptographically secure RNG.
exports.generateVerificationCode = () => String(randomInt(100000, 1000000));

exports.getVerificationExpiry = () => {
  return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
};

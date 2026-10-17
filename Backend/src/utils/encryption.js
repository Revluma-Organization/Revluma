const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const encryptionKey = String(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '');

if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
  throw new Error(
    "SHOPIFY_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal string."
  );
}
const KEY = Buffer.from(encryptionKey, "hex");

function encrypt(text) {
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    KEY,
    iv
  );

  let encrypted = cipher.update(text, "utf8", "hex");

  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, encrypted] =
    encryptedText.split(":");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(ivHex, "hex")
  );

  let decrypted = decipher.update(
    encrypted,
    "hex",
    "utf8"
  );

  decrypted += decipher.final("utf8");

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
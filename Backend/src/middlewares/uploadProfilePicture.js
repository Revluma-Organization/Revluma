const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return cb(
      new Error("Only JPEG, PNG, and WebP images are allowed.")
    );
  }

  cb(null, true);
};

const uploadProfilePicture = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

/**
 * Single "image" field upload that answers rejected files with a clean 400
 * (type or size) instead of bubbling a generic 500 from the error handler.
 */
function singleProfileImage(req, res, next) {
  uploadProfilePicture.single("image")(req, res, (error) => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Image must be 5 MB or smaller."
      : error instanceof multer.MulterError
        ? "Upload a single image in the image field."
        : error.message || "Invalid image upload.";
    return res.status(400).json({ success: false, error: message });
  });
}

module.exports = uploadProfilePicture;
module.exports.singleProfileImage = singleProfileImage;
const multer = require('multer');
const { uploadBufferToCloudinary } = require('../config/cloudinary');

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_MB   = 20;

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, JPG, PNG allowed.`), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
}).fields([{ name: 'warranty_document', maxCount: 1 }]);

module.exports = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ message: `File too large. Max ${MAX_SIZE_MB}MB.` });
      return res.status(400).json({ message: err.message });
    }
    if (err) return res.status(400).json({ message: err.message });

    const warrantyFile = req.files?.warranty_document?.[0];
    if (!warrantyFile) return next();

    try {
      const result = await uploadBufferToCloudinary(warrantyFile.buffer, {
        folder: 'warranty-docs', resource_type: 'auto',
      });
      warrantyFile.path     = result.secure_url;
      warrantyFile.filename = result.public_id;
      next();
    } catch (_) {
      res.status(500).json({ message: 'Cloud upload failed.' });
    }
  });
};

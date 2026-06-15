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
}).fields([
  { name: 'support_document',  maxCount: 1 },
  { name: 'warranty_document', maxCount: 1 },
]);

module.exports = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ success: false, message: `File too large. Max ${MAX_SIZE_MB}MB.` });
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });

    try {
      const supportFile  = req.files?.support_document?.[0];
      const warrantyFile = req.files?.warranty_document?.[0];

      if (supportFile) {
        const result = await uploadBufferToCloudinary(supportFile.buffer, {
          folder: 'asset-docs', resource_type: 'auto',
        });
        supportFile.path     = result.secure_url;
        supportFile.filename = result.public_id;
      }

      if (warrantyFile) {
        const result = await uploadBufferToCloudinary(warrantyFile.buffer, {
          folder: 'warranty-docs', resource_type: 'auto',
        });
        warrantyFile.path     = result.secure_url;
        warrantyFile.filename = result.public_id;
      }

      // Preserve backward-compat: req.file points to the support_document
      req.file = supportFile || null;
      next();
    } catch (_) {
      res.status(500).json({ success: false, message: 'Cloud upload failed.' });
    }
  });
};

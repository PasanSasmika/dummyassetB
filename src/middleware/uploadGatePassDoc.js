const multer = require('multer');
const { uploadBufferToCloudinary } = require('../config/cloudinary');

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_MB   = 20;

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only PDF, JPG, PNG are allowed.'), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
}).single('file');

module.exports = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ success: false, message: `File too large. Maximum size is ${MAX_SIZE_MB}MB.` });
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return next();

    try {
      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder:        `gate-pass-docs/${req.params.assignmentId}`,
        resource_type: 'auto',
      });
      req.file.path     = result.secure_url;
      req.file.filename = result.public_id;
      next();
    } catch (_) {
      res.status(500).json({ success: false, message: 'Cloud upload failed.' });
    }
  });
};

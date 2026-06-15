// middleware/uploadAssignDoc.js
// ─────────────────────────────────────────────────────────
// Multer config specifically for signed assignment documents.
// Files saved to:  uploads/assign-docs/<assignmentId>/
// ─────────────────────────────────────────────────────────

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_MB   = 20;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'assign-docs', String(req.params.assignmentId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts  = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    cb(null, `assign-doc-${req.params.assignmentId}-${ts}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, JPG, PNG are allowed.`), false);
  }
};

const uploadAssignDoc = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
}).single('file'); // field name must be "file"

module.exports = (req, res, next) => {
  uploadAssignDoc(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ success: false, message: `File too large. Maximum size is ${MAX_SIZE_MB}MB.` });
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
};

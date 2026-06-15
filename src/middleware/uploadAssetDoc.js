// middleware/uploadAssetDoc.js
// ─────────────────────────────────────────────────────────
// Multer config for asset creation — handles TWO optional files:
//   - support_document  → asset support doc  → uploads/asset-docs/
//   - warranty_document → warranty doc       → uploads/warranty-docs/
// ─────────────────────────────────────────────────────────

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_MB   = 20;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === 'warranty_document' ? 'warranty-docs' : 'asset-docs';
    const dir    = path.join('uploads', folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts  = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const pfx = file.fieldname === 'warranty_document' ? 'warranty-doc' : 'asset-doc';
    cb(null, `${pfx}-${ts}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, JPG, PNG allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
}).fields([
  { name: 'support_document',  maxCount: 1 },
  { name: 'warranty_document', maxCount: 1 },
]);

module.exports = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ success: false, message: `File too large. Max ${MAX_SIZE_MB}MB.` });
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });

    // Normalise: keep req.file pointing to support_document for backward compat
    req.file = req.files?.support_document?.[0] || null;
    next();
  });
};

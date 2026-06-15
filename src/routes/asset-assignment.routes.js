const express = require('express');
const router  = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const uploadReturnDoc   = require('../middleware/uploadReturnDoc');
const uploadAssignDoc   = require('../middleware/uploadAssignDoc');
const uploadGatePassDoc = require('../middleware/uploadGatePassDoc');

const {
  assignAsset,
  bulkAssignAssets,
  returnAsset,
  bulkReturnAssets,
  getAssetAssignmentHistory,
  getCurrentAssignmentsForUser,
  markAssignmentOverdue,
  getAllAssignments,
  getAssignmentById,
  uploadReturnDocument,
  getReturnDocument,
  uploadAssignDocument,
  getAssignDocument,
  uploadGatePassDocument,
  getGatePassDocument,
} = require('../controllers/asset-assignment.controller');

const { blockIfSalvaged } = require('../controllers/salvage.controller');

router.use(protect);

// ── Static routes first ──────────────────────────────────
router.get('/assets/allassignments',  getAllAssignments);
router.get('/my-assignments',         getCurrentAssignmentsForUser);
router.patch('/assignments/overdue',  restrictTo('Admin'), markAssignmentOverdue);

// ── Bulk assign / return (BEFORE /:assetId) ─────────────
router.post(
  '/assets/bulk-assign',
  restrictTo('Admin', 'Manager', 'Operator'),
  blockIfSalvaged,
  bulkAssignAssets
);
router.post(
  '/assets/bulk-return',
  restrictTo('Admin', 'Manager', 'Operator', 'User'),
  bulkReturnAssets
);

// ── Asset-scoped ─────────────────────────────────────────
router.post(
  '/assets/:assetId/assign',
  restrictTo('Admin', 'Manager', 'Operator'),
  blockIfSalvaged,
  assignAsset
);
router.get('/assets/:assetId/assignments', getAssetAssignmentHistory);

// ── Assignment-scoped ────────────────────────────────────
router.get('/assignments/:assignmentId', getAssignmentById);

router.post(
  '/assignments/:assignmentId/return',
  restrictTo('Admin', 'Manager', 'Operator', 'User'),
  returnAsset
);

// ── Assign document upload / fetch ── NEW ────────────────
router.patch(
  '/assignments/:assignmentId/upload-assign-doc',
  restrictTo('Admin', 'Manager', 'Operator'),
  uploadAssignDoc,          // multer parses the multipart file
  uploadAssignDocument      // controller saves to DB + updates FK
);
router.get(
  '/assignments/:assignmentId/assign-doc',
  getAssignDocument
);

// ── Gate pass document upload / fetch ───────────────────
router.patch(
  '/assignments/:assignmentId/upload-gate-pass',
  restrictTo('Admin', 'Manager', 'Operator'),
  uploadGatePassDoc,
  uploadGatePassDocument
);
router.get(
  '/assignments/:assignmentId/gate-pass-doc',
  getGatePassDocument
);

// ── Return document upload / fetch ──────────────────────
router.post(
  '/assignments/:assignmentId/upload-return-doc',
  restrictTo('Admin', 'Manager', 'Operator', 'User'),
  uploadReturnDoc,
  uploadReturnDocument
);
router.get(
  '/assignments/:assignmentId/return-doc',
  getReturnDocument
);

module.exports = router;

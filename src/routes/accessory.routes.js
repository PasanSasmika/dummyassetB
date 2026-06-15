// routes/accessory.routes.js

const express = require('express');
const router  = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  getAllAccessories,
  getAccessoryById,
  createAccessory,
  updateAccessory,
  deleteAccessory,
  toggleAccessoryStatus,
  getAllAccessoryAssignments,
  getAccessoriesByAsset,
  assignAccessory,
  returnAccessory,
  markAccessoriesOverdue,
} = require('../controllers/accessory.controller');

router.use(protect);

// ── Accessories CRUD ──────────────────────────────────────────────
router.get('/',                                     getAllAccessories);
router.post('/',   restrictTo('Admin','Manager'),   createAccessory);
router.get('/assignmentsall',                      getAllAccessoryAssignments);
router.patch('/assignments/overdue',
  restrictTo('Admin','Manager'),                    markAccessoriesOverdue);
router.get('/assignments/asset/:assetId',           getAccessoriesByAsset);
router.get('/:id',                                  getAccessoryById);
router.put('/:id',  restrictTo('Admin','Manager'),  updateAccessory);
router.delete('/:id', restrictTo('Admin'),          deleteAccessory);
router.patch('/:id/toggle',
  restrictTo('Admin','Manager'),                    toggleAccessoryStatus);

// ── Assignments ───────────────────────────────────────────────────
router.post('/assignments/assign',
  restrictTo('Admin','Manager','Operator'),         assignAccessory);
router.post('/assignments/:assignmentId/return',
  restrictTo('Admin','Manager','Operator'),         returnAccessory);

module.exports = router;

// routes/repairs.routes.js
const express         = require('express');
const router          = express.Router();
const ctrl            = require('../controllers/repair.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const uploadRepairDoc = require('../middleware/uploadrepairdoc');

// Auth required for all
router.use(protect);

// ── Static routes FIRST ──
router.get('/check-warranty/:assetId', ctrl.checkWarranty);
router.get('/asset/:assetId',          ctrl.getRepairsByAsset);

// ── CRUD ──
router.get(   '/',            restrictTo('Admin', 'Manager'), ctrl.getAllRepairs);
router.post(  '/:assetId',    restrictTo('Admin', 'Manager'), uploadRepairDoc, ctrl.createRepair);
router.get(   '/:repairId',   restrictTo('Admin', 'Manager'), ctrl.getRepairById);
router.patch( '/:repairId',   restrictTo('Admin', 'Manager'), uploadRepairDoc, ctrl.updateRepair);
router.delete('/:repairId',   restrictTo('Admin'),             ctrl.deleteRepair);

module.exports = router;

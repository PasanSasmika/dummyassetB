const express = require('express');
const router  = express.Router();

const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  salvageAsset,
  getAllSalvagedAssets,
  getSalvagedAssetById,
  updateSalvageRecord,
  unsalvageAsset,
} = require('../controllers/salvage.controller');

router.use(protect);

// GET  /api/salvage           — list all salvaged assets (Admin, Manager)
router.get('/',          restrictTo('Admin', 'Manager'), getAllSalvagedAssets);

// POST /api/salvage/:assetId  — salvage an asset (Admin, Manager)
router.post('/:assetId', restrictTo('Admin', 'Manager'), salvageAsset);

// GET    /api/salvage/:assetId — get single salvage record
// PATCH  /api/salvage/:assetId — update notes / reason / condition
// DELETE /api/salvage/:assetId — restore asset back to Available (Admin only)
router.get('/:assetId',    restrictTo('Admin', 'Manager'), getSalvagedAssetById);
router.patch('/:assetId',  restrictTo('Admin', 'Manager'), updateSalvageRecord);
router.delete('/:assetId', restrictTo('Admin'),            unsalvageAsset);

module.exports = router;

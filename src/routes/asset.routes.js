// const express = require('express');
// const router  = express.Router();

// const { protect, restrictTo }  = require('../middleware/auth.middleware');
// const uploadAssetDoc           = require('../middleware/uploadAssetDoc');   // ← new

// const {
//   createAsset,
//   getAllAssets,
//   getAssetById,
//   updateAsset,
//   deleteAsset,
//   getAssetsByCategory,
//   updateAssetCIA,
//   assignAssetToUser,
//   getAssetHistory,
//   getMyAssets,
//   bulkCreateAssets,
//   getGlobalAssetLifecycle,
//   getGlobalAssignmentLog,
// } = require('../controllers/asset.controller');

// const warrantyRouter = require('./assetWarranty.routes');

// router.use(protect);

// router
//   .route('/')
//   .get(getAllAssets)
//   // uploadAssetDoc runs before createAsset so req.file is available
//   .post(restrictTo('Admin', 'Manager', 'Operator'), uploadAssetDoc, createAsset);

// router.get('/my-assets',           getMyAssets);
// router.get('/category/:category',  getAssetsByCategory);

// router.post('/bulk', restrictTo('Admin', 'Manager', 'Operator'), bulkCreateAssets);

// router
//   .route('/:id')
//   .get(getAssetById)
//   .patch(restrictTo('Admin', 'Manager', 'Operator'), uploadAssetDoc.any() , updateAsset)
//   .delete(restrictTo('Admin'), deleteAsset);

// router.patch('/:id/cia-classification', restrictTo('Admin', 'Manager'), updateAssetCIA);
// router.post('/:id/assign',  restrictTo('Admin', 'Manager', 'Operator'), assignAssetToUser);
// router.get('/:id/history',  getAssetHistory);

// router.use('/:id/warranties', warrantyRouter);
// router.get('/global/history', restrictTo('Admin', 'Manager'), getGlobalAssetLifecycle);
// router.get('/global/assignments', restrictTo('Admin', 'Manager'), getGlobalAssignmentLog);
// module.exports = router;


const express = require('express');
const router  = express.Router();

const { protect, restrictTo }  = require('../middleware/auth.middleware');
// uploadAssetDoc is a middleware function, so it is used directly without .any()
const uploadAssetDoc           = require('../middleware/uploadAssetDoc');   

const {
  createAsset,
  getAllAssets,
  getAssetById,
  updateAsset,
  deleteAsset,
  getAssetsByCategory,
  updateAssetCIA,
  assignAssetToUser,
  getAssetHistory,
  getMyAssets,
  bulkCreateAssets,
  getGlobalAssetLifecycle,
  getGlobalAssignmentLog,
} = require('../controllers/asset.controller');

const warrantyRouter = require('./assetWarranty.routes');

router.use(protect);

// ─── STATIC ROUTES (Must be defined BEFORE /:id dynamic routes) ────────
router.get('/global/history', restrictTo('Admin', 'Manager'), getGlobalAssetLifecycle);
router.get('/global/assignments', restrictTo('Admin', 'Manager'), getGlobalAssignmentLog);

router.get('/my-assets',           getMyAssets);
router.get('/category/:category',  getAssetsByCategory);
router.post('/bulk', restrictTo('Admin', 'Manager', 'Operator'), bulkCreateAssets);

// ─── ROOT ROUTES ────────────────────────────────────────────────────────
router
  .route('/')
  .get(getAllAssets)
  .post(restrictTo('Admin', 'Manager', 'Operator'), uploadAssetDoc, createAsset);

// ─── DYNAMIC /:id ROUTES ────────────────────────────────────────────────
router
  .route('/:id')
  .get(getAssetById)
  // FIX: Removed .any() to prevent TypeError
  .patch(restrictTo('Admin', 'Manager', 'Operator'), uploadAssetDoc, updateAsset)
  .delete(restrictTo('Admin'), deleteAsset);

router.patch('/:id/cia-classification', restrictTo('Admin', 'Manager'), updateAssetCIA);
router.post('/:id/assign',  restrictTo('Admin', 'Manager', 'Operator'), assignAssetToUser);
router.get('/:id/history',  getAssetHistory);

// ─── NESTED ROUTERS ─────────────────────────────────────────────────────
router.use('/:id/warranties', warrantyRouter);

module.exports = router;
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/assettype.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

router.use(protect);

router.get('/',                      ctrl.getAllAssetTypes);
router.get('/by-category/:category', ctrl.getByCategory);
router.get('/:id',                   ctrl.getAssetTypeById);
router.post('/',                     restrictTo('Admin', 'Manager'), ctrl.createAssetType);
router.patch('/:id',                 restrictTo('Admin', 'Manager'), ctrl.updateAssetType);
// No DELETE by design

module.exports = router;
// app.use('/api/asset-types', require('./routes/assetType.routes'));

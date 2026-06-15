const express = require('express');
const router  = express.Router({ mergeParams: true }); 
const { protect, restrictTo } = require('../middleware/auth.middleware');

const {
  getWarrantiesByAsset,
  getWarrantyById,
  createWarranty,
  updateWarranty,
  deleteWarranty,
} = require('../controllers/assetWarranty.controller');

router.use(protect);


router.route('/')
  .get(getWarrantiesByAsset)
  .post(restrictTo('Admin', 'Manager', 'Operator'), createWarranty);


router.route('/:warrantyId')
  .get(getWarrantyById)
  .patch(restrictTo('Admin', 'Manager', 'Operator'), updateWarranty)
  .delete(restrictTo('Admin', 'Manager'), deleteWarranty);

module.exports = router;

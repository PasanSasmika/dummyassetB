const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  createDesignation,
  getAllDesignations,
  getDesignationsByDepartment,
  getDesignationById,
  updateDesignation,
  deleteDesignation
} = require('../controllers/designation.controller');

router.use(protect);

router.route('/')
  .get(getAllDesignations)
  .post(restrictTo('Admin', 'Manager'), createDesignation);

router.get('/department/:departmentId', getDesignationsByDepartment);

router.route('/:id')
  .get(getDesignationById)
  .patch(restrictTo('Admin', 'Manager'), updateDesignation)
  .delete(restrictTo('Admin'), deleteDesignation);

module.exports = router;

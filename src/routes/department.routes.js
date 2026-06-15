const express = require('express');
const router = express.Router();

const {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment
  // setHeadOfDepartment,   // ← add if you have this function
} = require('../controllers/department.controller');

const { protect, restrictTo } = require('../middleware/auth.middleware');

// Apply authentication to all routes in this router
router.use(protect);

// ────────────────────────────────────────────────
// Public-ish routes (still protected, but no role restriction)
// ────────────────────────────────────────────────
router.route('/')
  .get(getAllDepartments)                    // ← correct: pass function reference
  .post(restrictTo('Admin', 'Manager'), createDepartment);

// ────────────────────────────────────────────────
// Routes with :id parameter
// ────────────────────────────────────────────────
router.route('/:id')
  .get(getDepartmentById)
  .patch(restrictTo('Admin', 'Manager'), updateDepartment)
  .delete(restrictTo('Admin'), deleteDepartment);

// Optional: special action route (if you have this in controller)
// router.patch('/:id/set-head', restrictTo('Admin', 'Manager'), setHeadOfDepartment);

module.exports = router;

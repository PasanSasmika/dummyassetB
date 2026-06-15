const express = require('express');
const router  = express.Router();

const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  registerUser,
  getAllUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  assignRole,
  getMyProfile,
  adminResetPassword,
  userChangePassword,
  bulkUploadUsers,
} = require('../controllers/user.controller');

// Public
router.post('/register', registerUser);

// Protected
router.use(protect);

router.get('/me', getMyProfile);

router.route('/')
  .get(restrictTo('Admin'), getAllUsers);

  router.post('/bulk-upload', restrictTo('Admin'), bulkUploadUsers);

router.route('/:id')
  .get(getUserById)
  .patch(restrictTo('Admin', 'Manager'), updateUser);

// Activate / Deactivate
router.patch('/:id/status', restrictTo('Admin', 'Manager'), updateUserStatus);

// Assign role
router.post('/:id/roles', restrictTo('Admin'), assignRole);


router.post('/:id/reset-password', restrictTo('Admin'), adminResetPassword);

// User changes their own password
router.post('/change-password', userChangePassword);
module.exports = router;

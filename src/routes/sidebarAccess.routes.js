const express = require('express');
const router = express.Router();
const { protect, restrictToSuperAdmin } = require('../middleware/auth.middleware');
const { getAdminUsers, getUserAccess, updateUserAccess } = require('../controllers/sidebarAccess.controller');

router.use(protect, restrictToSuperAdmin);

router.get('/admins', getAdminUsers);
router.get('/:userId', getUserAccess);
router.put('/:userId', updateUserAccess);

module.exports = router;

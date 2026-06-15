// routes/audit.routes.js
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { getAllAuditLogs } = require('../controllers/audit.controller');

// Protect all audit routes and restrict to Admins/Managers
router.use(protect);
router.use(restrictTo('Admin', 'Manager'));

router.get('/', getAllAuditLogs);

module.exports = router;
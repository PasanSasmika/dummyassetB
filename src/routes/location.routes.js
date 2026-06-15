const express = require('express');
const router  = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  getAllLocations, getLocationById, createLocation, updateLocation, deleteLocation,
  getAllSubLocations, getSubLocationById, createSubLocation, updateSubLocation, deleteSubLocation,
} = require('../controllers/location.controller');

router.use(protect);

// ── Sub Locations (MUST be before /:id) ──────────────────
router.get('/suball',          getAllSubLocations);
router.get('/sub/:id',         getSubLocationById);
router.post('/sub',            restrictTo('Admin','Manager'), createSubLocation);
router.put('/sub/:id',         restrictTo('Admin','Manager'), updateSubLocation);
router.delete('/sub/:id',      restrictTo('Admin'),           deleteSubLocation);

// ── Locations ─────────────────────────────────────────────
router.get('/',                getAllLocations);
router.post('/',               restrictTo('Admin','Manager'), createLocation);
router.get('/:id',             getLocationById);
router.put('/:id',             restrictTo('Admin','Manager'), updateLocation);
router.delete('/:id',          restrictTo('Admin'),           deleteLocation);

module.exports = router;

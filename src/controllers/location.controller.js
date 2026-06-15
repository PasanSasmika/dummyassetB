const db = require('../config/db');

// ── LOCATIONS ─────────────────────────────────────────────

exports.getAllLocations = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT l.*,
        COUNT(sl.id) AS sub_location_count
      FROM locations l
      LEFT JOIN sub_locations sl ON sl.location_id = l.id
      GROUP BY l.id
      ORDER BY l.location_name ASC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getLocationById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM locations WHERE id = ?`, [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Location not found' });

    const [subs] = await db.query(
      `SELECT * FROM sub_locations WHERE location_id = ? ORDER BY sub_location_name ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], sub_locations: subs } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createLocation = async (req, res) => {
  try {
    const { location_name, address, details } = req.body;
    if (!location_name)
      return res.status(400).json({ success: false, message: 'location_name is required' });

    const [result] = await db.query(
      `INSERT INTO locations (location_name, address, details, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [location_name, address || null, details || null]
    );
    const [rows] = await db.query(`SELECT * FROM locations WHERE id = ?`, [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const { location_name, address, details } = req.body;
    const [existing] = await db.query(
      `SELECT id FROM locations WHERE id = ?`, [req.params.id]
    );
    if (!existing.length)
      return res.status(404).json({ success: false, message: 'Location not found' });

    await db.query(
      `UPDATE locations SET location_name=?, address=?, details=?, updated_at=NOW()
       WHERE id=?`,
      [location_name, address || null, details || null, req.params.id]
    );
    const [rows] = await db.query(`SELECT * FROM locations WHERE id=?`, [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteLocation = async (req, res) => {
  try {
    const [existing] = await db.query(
      `SELECT id FROM locations WHERE id=?`, [req.params.id]
    );
    if (!existing.length)
      return res.status(404).json({ success: false, message: 'Location not found' });

    await db.query(`DELETE FROM locations WHERE id=?`, [req.params.id]);
    res.json({ success: true, message: 'Location deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUB LOCATIONS ─────────────────────────────────────────

exports.getAllSubLocations = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT sl.*, l.location_name
      FROM sub_locations sl
      JOIN locations l ON sl.location_id = l.id
      ORDER BY l.location_name ASC, sl.sub_location_name ASC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSubLocationById = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT sl.*, l.location_name
      FROM sub_locations sl
      JOIN locations l ON sl.location_id = l.id
      WHERE sl.id = ?
    `, [req.params.id]);
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Sub-location not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createSubLocation = async (req, res) => {
  try {
    const { sub_location_name, location_id, address, details } = req.body;
    if (!sub_location_name)
      return res.status(400).json({ success: false, message: 'sub_location_name is required' });
    if (!location_id)
      return res.status(400).json({ success: false, message: 'location_id is required' });

    const [loc] = await db.query(`SELECT id FROM locations WHERE id=?`, [location_id]);
    if (!loc.length)
      return res.status(404).json({ success: false, message: 'Parent location not found' });

    const [result] = await db.query(`
      INSERT INTO sub_locations (sub_location_name, location_id, address, details, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(6), NOW(6))
    `, [sub_location_name, location_id, address || null, details || null]);

    const [rows] = await db.query(`
      SELECT sl.*, l.location_name FROM sub_locations sl
      JOIN locations l ON sl.location_id = l.id
      WHERE sl.id = ?
    `, [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateSubLocation = async (req, res) => {
  try {
    const { sub_location_name, location_id, address, details } = req.body;
    const [existing] = await db.query(
      `SELECT id FROM sub_locations WHERE id=?`, [req.params.id]
    );
    if (!existing.length)
      return res.status(404).json({ success: false, message: 'Sub-location not found' });

    await db.query(`
      UPDATE sub_locations
      SET sub_location_name=?, location_id=?, address=?, details=?, updated_at=NOW(6)
      WHERE id=?
    `, [sub_location_name, location_id, address || null, details || null, req.params.id]);

    const [rows] = await db.query(`
      SELECT sl.*, l.location_name FROM sub_locations sl
      JOIN locations l ON sl.location_id = l.id
      WHERE sl.id = ?
    `, [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteSubLocation = async (req, res) => {
  try {
    const [existing] = await db.query(
      `SELECT id FROM sub_locations WHERE id=?`, [req.params.id]
    );
    if (!existing.length)
      return res.status(404).json({ success: false, message: 'Sub-location not found' });

    await db.query(`DELETE FROM sub_locations WHERE id=?`, [req.params.id]);
    res.json({ success: true, message: 'Sub-location deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const db = require('../config/db');

// ── GET all warranties for an asset ──────────────────────
exports.getWarrantiesByAsset = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT *,
        CASE WHEN end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS status,
        DATEDIFF(end_date, CURDATE()) AS days_remaining
       FROM asset_warranties
       WHERE asset_id = ?
       ORDER BY end_date DESC`,
      [id]
    );

    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch warranties', error: error.message });
  }
};

// ── GET single warranty ───────────────────────────────────
exports.getWarrantyById = async (req, res) => {
  try {
    const { warrantyId } = req.params;

    const [rows] = await db.query(
      `SELECT *,
        CASE WHEN end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS status,
        DATEDIFF(end_date, CURDATE()) AS days_remaining
       FROM asset_warranties WHERE id = ?`,
      [warrantyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch warranty', error: error.message });
  }
};

// ── CREATE warranty ───────────────────────────────────────
exports.createWarranty = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      provider_name,
      warranty_period_months,
      start_date,
      end_date,
      coverage_details,
    } = req.body;

    // Validate asset exists
    const [asset] = await db.query(`SELECT id FROM assets WHERE id = ?`, [id]);
    if (asset.length === 0) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    // Validate required fields
    if (!provider_name || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'provider_name, start_date, and end_date are required',
      });
    }

    // Auto-calculate period if not provided
    let period = warranty_period_months;
    if (!period) {
      const start = new Date(start_date);
      const end = new Date(end_date);
      period = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
    }

    const [result] = await db.query(
      `INSERT INTO asset_warranties
        (asset_id, provider_name, warranty_period_months, start_date, end_date, coverage_details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, provider_name, period, start_date, end_date, coverage_details || null]
    );

    const [created] = await db.query(
      `SELECT *,
        CASE WHEN end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS status,
        DATEDIFF(end_date, CURDATE()) AS days_remaining
       FROM asset_warranties WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create warranty', error: error.message });
  }
};

// ── UPDATE warranty ───────────────────────────────────────
exports.updateWarranty = async (req, res) => {
  try {
    const { warrantyId } = req.params;
    const {
      provider_name,
      warranty_period_months,
      start_date,
      end_date,
      coverage_details,
    } = req.body;

    const [existing] = await db.query(`SELECT id FROM asset_warranties WHERE id = ?`, [warrantyId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    await db.query(
      `UPDATE asset_warranties SET
        provider_name          = COALESCE(?, provider_name),
        warranty_period_months = COALESCE(?, warranty_period_months),
        start_date             = COALESCE(?, start_date),
        end_date               = COALESCE(?, end_date),
        coverage_details       = COALESCE(?, coverage_details)
       WHERE id = ?`,
      [provider_name, warranty_period_months, start_date, end_date, coverage_details, warrantyId]
    );

    const [updated] = await db.query(
      `SELECT *,
        CASE WHEN end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS status,
        DATEDIFF(end_date, CURDATE()) AS days_remaining
       FROM asset_warranties WHERE id = ?`,
      [warrantyId]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update warranty', error: error.message });
  }
};

// ── DELETE warranty ───────────────────────────────────────
exports.deleteWarranty = async (req, res) => {
  try {
    const { warrantyId } = req.params;

    const [existing] = await db.query(`SELECT id FROM asset_warranties WHERE id = ?`, [warrantyId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    await db.query(`DELETE FROM asset_warranties WHERE id = ?`, [warrantyId]);

    res.json({ success: true, message: 'Warranty deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete warranty', error: error.message });
  }
};

const db = require('../config/db');

const VALID_CATEGORIES = [
  'Human', 'IT Infrastructure', 'Service',
  'Digital', 'Tangible Information', 'End User', 'Facility',
];

exports.getAllAssetTypes = async (req, res) => {
  try {
    const { category } = req.query;

    let query = `
      SELECT
        at.id,
        at.name,
        at.category,
        at.created_at,
        at.updated_at,
        COUNT(a.id) AS asset_count
      FROM asset_types at
      LEFT JOIN assets a ON a.asset_type_id = at.id
    `;
    const params = [];

    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category value' });
      }
      query += ' WHERE at.category = ?';
      params.push(category);
    }

    query += ' GROUP BY at.id ORDER BY at.category, at.name ASC';

    const [rows] = await db.query(query, params);

    // Build grouped object { 'End User': [...], 'Human': [...], ... }
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }

    return res.json({ success: true, count: rows.length, data: rows, grouped });

  } catch (error) {
    console.error('getAllAssetTypes error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch asset types', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/asset-types/by-category/:category
// Lightweight — id + name only, for dropdowns
// ─────────────────────────────────────────────────────────
exports.getByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    const [rows] = await db.query(
      'SELECT id, name FROM asset_types WHERE category = ? ORDER BY name ASC',
      [category]
    );

    return res.json({ success: true, count: rows.length, data: rows });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch asset types', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/asset-types/:id
// ─────────────────────────────────────────────────────────
exports.getAssetTypeById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT
         at.id, at.name, at.category, at.created_at, at.updated_at,
         COUNT(a.id) AS asset_count
       FROM asset_types at
       LEFT JOIN assets a ON a.asset_type_id = at.id
       WHERE at.id = ?
       GROUP BY at.id`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Asset type not found' });
    }

    return res.json({ success: true, data: rows[0] });

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch asset type', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// POST /api/asset-types
// Body: { name, category }
// ─────────────────────────────────────────────────────────
exports.createAssetType = async (req, res) => {
  try {
    const { name, category } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, message: 'name and category are required' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid category value' });
    }

    const trimmedName = name.trim();

    // Duplicate check within same category
    const [[existing]] = await db.query(
      'SELECT id FROM asset_types WHERE name = ? AND category = ?',
      [trimmedName, category]
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `"${trimmedName}" already exists under ${category}`,
      });
    }

    const [result] = await db.query(
      'INSERT INTO asset_types (name, category) VALUES (?, ?)',
      [trimmedName, category]
    );

    return res.status(201).json({
      success: true,
      message: 'Asset type created successfully',
      data: { id: result.insertId, name: trimmedName, category },
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Asset type already exists in this category' });
    }
    console.error('createAssetType error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create asset type', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /api/asset-types/:id
// Body: { name }  — category is IMMUTABLE
// ─────────────────────────────────────────────────────────
exports.updateAssetType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    const [[current]] = await db.query(
      'SELECT id, name, category FROM asset_types WHERE id = ?', [id]
    );
    if (!current) {
      return res.status(404).json({ success: false, message: 'Asset type not found' });
    }

    const trimmedName = name.trim();

    // Duplicate check within same category, excluding self
    const [[conflict]] = await db.query(
      'SELECT id FROM asset_types WHERE name = ? AND category = ? AND id != ?',
      [trimmedName, current.category, id]
    );
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `"${trimmedName}" already exists under ${current.category}`,
      });
    }

    await db.query(
      'UPDATE asset_types SET name = ?, updated_at = NOW() WHERE id = ?',
      [trimmedName, id]
    );

    return res.json({
      success: true,
      message: 'Asset type updated successfully',
      data: { id: Number(id), name: trimmedName, category: current.category },
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Asset type already exists in this category' });
    }
    console.error('updateAssetType error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update asset type', error: error.message });
  }
};

const db = require('../config/db');

// ─────────────────────────────────────────────────────────
// HELPER — log to asset_history
// ─────────────────────────────────────────────────────────
async function logHistory(conn, assetId, changedBy, changeType, details) {
  try {
    await conn.query(
      `INSERT INTO asset_history (asset_id, changed_by, change_type, change_details, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [assetId, changedBy, changeType, JSON.stringify(details)]
    );
  } catch (_) { }
}

// ─────────────────────────────────────────────────────────
// POST /api/salvage/:assetId
// Mark an asset as salvaged → sets status to 'Broken'
// Body: { salvage_reason*, salvage_date*, condition_at_salvage, notes }
// ─────────────────────────────────────────────────────────
exports.salvageAsset = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { assetId } = req.params;
    const { salvage_reason, salvage_date, condition_at_salvage, notes } = req.body;
    const salvaged_by = req.user?.id || null;

    // ── Validate required ──
    if (!salvage_reason || !salvage_date) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'salvage_reason and salvage_date are required.' });
    }

    // ── Asset must exist ──
    const [assetRows] = await conn.query(
      'SELECT id, asset_no, name, status FROM assets WHERE id = ?',
      [assetId]
    );
    if (!assetRows.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Asset not found.' });
    }
    const asset = assetRows[0];

    // ── Already salvaged ──
    if (asset.status === 'Broken') {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ message: 'Asset is already salvaged (Broken).' });
    }

    // ── Cannot salvage while In Use / In Maintenance / In Repair ──
    const blocked = ['In Use', 'In Maintenance', 'In Repair'];
    if (blocked.includes(asset.status)) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        message: `Asset is currently "${asset.status}". Resolve this before salvaging.`,
      });
    }

    // ── Cannot salvage while actively assigned ──
    const [activeAssign] = await conn.query(
      `SELECT id FROM asset_assignments WHERE asset_id = ? AND status = 'Assigned' LIMIT 1`,
      [assetId]
    );
    if (activeAssign.length) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({
        message: 'Asset has an active assignment. Return the asset first before salvaging.',
      });
    }

    // ── Insert salvage record ──
    const [result] = await conn.query(
      `INSERT INTO salvaged_assets
         (asset_id, salvage_reason, salvage_date, salvaged_by, condition_at_salvage, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [assetId, salvage_reason, salvage_date, salvaged_by, condition_at_salvage || null, notes || null]
    );

    // ── Set asset status → Broken ──
    await conn.query(
      `UPDATE assets SET status = 'Broken', updated_at = NOW() WHERE id = ?`,
      [assetId]
    );

    // ── History log ──
    await logHistory(conn, assetId, salvaged_by, 'Salvaged', {
      salvage_reason,
      salvage_date,
      condition_at_salvage: condition_at_salvage || null,
      notes: notes || null,
      previous_status: asset.status,
    });

    await conn.commit();
    conn.release();

    return res.status(201).json({
      message: `Asset "${asset.name}" (${asset.asset_no}) has been salvaged. Status set to Broken.`,
      salvage_id: result.insertId,
      asset_id: Number(assetId),
    });

  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('salvageAsset error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A salvage record already exists for this asset.' });
    }
    return res.status(500).json({ message: 'Failed to salvage asset.', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/salvage
// List all salvaged assets with pagination + search
// Query: ?search=&page=1&limit=20
// ─────────────────────────────────────────────────────────
exports.getAllSalvagedAssets = async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    let where = '';
    const params = [];

    if (search) {
      where = `WHERE (
        a.name            LIKE ? OR
        a.asset_no        LIKE ? OR
        a.category        LIKE ? OR
        sa.salvage_reason LIKE ?
      )`;
      params.push(search, search, search, search);
    }

    const [rows] = await db.query(
      `SELECT
         sa.id                                    AS salvage_id,
         sa.asset_id,
         sa.salvage_reason,
         sa.salvage_date,
         sa.condition_at_salvage,
         sa.notes,
         sa.created_at                            AS salvaged_at,

         a.asset_no,
         a.name                                   AS asset_name,
         a.category,
         a.asset_type_id,
         a.status                                 AS asset_status,
         a.location_id                            AS asset_location_id,
         a.cost,
         a.currency,

         CONCAT(u.first_name, ' ', u.last_name)  AS salvaged_by_name,
         u.email                                  AS salvaged_by_email

       FROM salvaged_assets sa
       JOIN  assets a ON sa.asset_id = a.id
       LEFT JOIN users u ON sa.salvaged_by = u.id
       ${where}
       ORDER BY sa.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM salvaged_assets sa
       JOIN assets a ON sa.asset_id = a.id
       ${where}`,
      params
    );

    const total = countRows[0]?.total || 0;

    return res.status(200).json({
      data: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error('getAllSalvagedAssets error:', err);
    return res.status(500).json({ message: 'Failed to fetch salvaged assets.', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/salvage/:assetId
// Get single salvage record with full asset details
// ─────────────────────────────────────────────────────────
exports.getSalvagedAssetById = async (req, res) => {
  try {
    const { assetId } = req.params;

    const [rows] = await db.query(
      `SELECT
         sa.id                                    AS salvage_id,
         sa.asset_id,
         sa.salvage_reason,
         sa.salvage_date,
         sa.condition_at_salvage,
         sa.notes,
         sa.created_at                            AS salvaged_at,

         a.asset_no,
         a.name                                   AS asset_name,
         a.category,
         a.asset_type_id,
         a.description,
         a.status                                 AS asset_status,
         a.location_id                            AS asset_location_id,
         a.cost,
         a.currency,
         a.po_number,
         a.classification,
         a.cia_confidentiality,
         a.cia_integrity,
         a.cia_availability,
         a.created_at                             AS asset_created_at,

         CONCAT(u.first_name, ' ', u.last_name)  AS salvaged_by_name,
         u.email                                  AS salvaged_by_email

       FROM salvaged_assets sa
       JOIN  assets a ON sa.asset_id = a.id
       LEFT JOIN users u ON sa.salvaged_by = u.id
       WHERE sa.asset_id = ?`,
      [assetId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'No salvage record found for this asset.' });
    }

    return res.status(200).json({ data: rows[0] });

  } catch (err) {
    console.error('getSalvagedAssetById error:', err);
    return res.status(500).json({ message: 'Failed to fetch salvage record.', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /api/salvage/:assetId
// Update salvage record (reason, date, condition, notes)
// ─────────────────────────────────────────────────────────
exports.updateSalvageRecord = async (req, res) => {
  try {
    const { assetId } = req.params;
    const { salvage_reason, salvage_date, condition_at_salvage, notes } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM salvaged_assets WHERE asset_id = ?',
      [assetId]
    );
    if (!existing.length) {
      return res.status(404).json({ message: 'No salvage record found for this asset.' });
    }

    const fields = [];
    const values = [];

    if (salvage_reason !== undefined) { fields.push('salvage_reason = ?'); values.push(salvage_reason); }
    if (salvage_date !== undefined) { fields.push('salvage_date = ?'); values.push(salvage_date); }
    if (condition_at_salvage !== undefined) { fields.push('condition_at_salvage = ?'); values.push(condition_at_salvage); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }

    if (!fields.length) {
      return res.status(400).json({ message: 'No fields provided to update.' });
    }

    values.push(assetId);
    await db.query(
      `UPDATE salvaged_assets SET ${fields.join(', ')} WHERE asset_id = ?`,
      values
    );

    return res.status(200).json({ message: 'Salvage record updated successfully.' });

  } catch (err) {
    console.error('updateSalvageRecord error:', err);
    return res.status(500).json({ message: 'Failed to update salvage record.', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE /api/salvage/:assetId
// Restore a salvaged asset → status back to 'Available'
// Admin only
// ─────────────────────────────────────────────────────────
exports.unsalvageAsset = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { assetId } = req.params;
    const restoredBy = req.user?.id || null;

    const [existing] = await conn.query(
      'SELECT id FROM salvaged_assets WHERE asset_id = ?',
      [assetId]
    );
    if (!existing.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'No salvage record found for this asset.' });
    }

    await conn.query('DELETE FROM salvaged_assets WHERE asset_id = ?', [assetId]);

    await conn.query(
      `UPDATE assets SET status = 'Available', updated_at = NOW() WHERE id = ?`,
      [assetId]
    );

    await logHistory(conn, assetId, restoredBy, 'Unsalvaged', {
      note: 'Asset restored from salvaged (Broken) back to Available',
    });

    await conn.commit();
    conn.release();

    return res.status(200).json({
      message: 'Asset has been restored. Status is now Available.',
    });

  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('unsalvageAsset error:', err);
    return res.status(500).json({ message: 'Failed to restore asset.', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// MIDDLEWARE — blockIfSalvaged
// Use in assignment.routes.js and repair.routes.js
// Prevents salvaged assets from being assigned or repaired
// ─────────────────────────────────────────────────────────
exports.blockIfSalvaged = async (req, res, next) => {
  try {
    const assetId = req.params.assetId || req.params.id || null;
    const assetIds = req.body?.asset_ids || [];

    const idsToCheck = [];
    if (assetId) idsToCheck.push(assetId);
    if (assetIds.length) idsToCheck.push(...assetIds);

    if (!idsToCheck.length) return next();

    const placeholders = idsToCheck.map(() => '?').join(',');
    const [salvaged] = await db.query(
      `SELECT asset_id FROM salvaged_assets WHERE asset_id IN (${placeholders})`,
      idsToCheck
    );

    if (salvaged.length > 0) {
      const ids = salvaged.map(r => r.asset_id).join(', ');
      return res.status(409).json({
        message: `Cannot proceed. The following asset(s) are salvaged and cannot be assigned or repaired: [${ids}]`,
        salvaged_asset_ids: salvaged.map(r => r.asset_id),
      });
    }

    return next();

  } catch (err) {
    console.error('blockIfSalvaged error:', err);
    return res.status(500).json({ message: 'Failed to verify asset salvage status.' });
  }
};

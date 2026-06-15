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
// HELPER — check active warranty for asset ON a specific date
// ─────────────────────────────────────────────────────────
async function getActiveWarranty(conn, assetId, checkDate = null) {
  const dateParam = checkDate || new Date().toISOString().split('T')[0];
  const [rows] = await conn.query(
    `SELECT * FROM asset_warranties
     WHERE asset_id = ?
       AND start_date <= ?
       AND end_date   >= ?
     ORDER BY end_date DESC LIMIT 1`,
    [assetId, dateParam, dateParam]
  );
  return rows.length ? rows[0] : null;
}

// ─────────────────────────────────────────────────────────
// POST /api/repairs/:assetId
// Create a repair record — sets asset status to 'In Repair'
//
// Accepts multipart/form-data (for warranty_document upload) OR
// application/json (when no file is attached).
//
// Route must use uploadAssetDoc middleware so req.files is populated.
//
// Body fields:
//   repair_type*           — 'Service' | 'Damage' | 'Replacement'
//   description*           — text
//   vendor_name            — string
//   repair_cost            — decimal
//   start_date             — date (defaults to today)
//   completion_date        — date (optional)
//   part_warranty_start    — date (Replacement only, optional)
//   part_warranty_end      — date (Replacement only, optional)
//
// File fields (via multer):
//   warranty_document      — PDF / JPG / PNG, stored to uploads/warranty-docs/
//
// Warranty Logic:
//   Service / Damage  → check if start_date falls within active warranty
//                        → if YES: warranty_covered=1, repair_cost forced to 0
//                        → if NO:  warranty_covered=0, cost required
//   Replacement       → warranty_covered always 0
//                        → part warranty dates / doc stored in warranty_* columns
// ─────────────────────────────────────────────────────────
exports.createRepair = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { assetId } = req.params;
    const reported_by = req.user?.id;

    if (!reported_by) {
      await conn.rollback(); conn.release();
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const body = req.body || {};   // guard: multer populates this; fallback prevents crash
    const {
      repair_type = 'Service',
      description,
      vendor_name,
      repair_cost,
      start_date,
      completion_date,
      part_warranty_start,
      part_warranty_end,
    } = body;

    // ── Resolve uploaded warranty document path ──────────────────────────────
    // The uploadAssetDoc middleware stores warranty_document under req.files
    const uploadedDoc = req.files?.warranty_document?.[0];
    const uploadedDocPath = uploadedDoc
      ? uploadedDoc.path.replace(/\\/g, '/')   // normalise Windows paths
      : null;

    // ── Fetch asset ──────────────────────────────────────────────────────────
    const [[asset]] = await conn.query(
      'SELECT id, name, asset_no, status FROM assets WHERE id = ?',
      [assetId]
    );
    if (!asset) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Asset not found' });
    }

    // ── Block if Broken / In Repair / In Use ─────────────────────────────────
    const blockStatuses = ['Broken', 'In Repair'];
    if (blockStatuses.includes(asset.status)) {
      await conn.rollback(); conn.release();
      return res.status(409).json({
        message:
          `Cannot create repair: asset is currently "${asset.status}". ` +
          (asset.status === 'In Use' ? 'Return it first.' :
            asset.status === 'Broken' ? 'Asset is salvaged.' :
              'Already under repair.'),
      });
    }

    // ── Service date (used for warranty check) ───────────────────────────────
    const serviceDate = start_date || new Date().toISOString().split('T')[0];

    // ── Warranty check (Service / Damage only) ───────────────────────────────
    let warranty_covered = 0;
    let finalCost = repair_cost != null ? repair_cost : null;
    let activeWarranty = null;

    if (repair_type !== 'Replacement') {
      activeWarranty = await getActiveWarranty(conn, assetId, serviceDate);
      if (activeWarranty) {
        warranty_covered = 1;
        finalCost = 0.00;
      }
    }

    // ── For Replacement: map part warranty fields → warranty_* columns ───────
    // For Service/Damage: warranty_document column stores uploaded file path
    let warrantyStart = null;
    let warrantyEnd = null;
    let warrantyDocument = null;

    if (repair_type === 'Replacement') {
      warrantyStart = part_warranty_start || null;
      warrantyEnd = part_warranty_end || null;
      warrantyDocument = uploadedDocPath;              // new part's warranty doc
    } else {
      // Service / Damage — store the uploaded doc if any
      warrantyDocument = uploadedDocPath;
    }

    // ── Insert repair ────────────────────────────────────────────────────────
    const [result] = await conn.query(
      `INSERT INTO asset_repairs
         (asset_id, repair_type, reported_by, repair_cost, vendor_name,
          description, start_date, completion_date, status,
          warranty_covered, warranty_start, warranty_end, warranty_document)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)`,
      [
        assetId, repair_type, reported_by,
        finalCost,
        vendor_name || null,
        description || null,
        serviceDate,
        completion_date || null,
        warranty_covered,
        warrantyStart,
        warrantyEnd,
        warrantyDocument,
      ]
    );

    const repairId = result.insertId;

    // ── Update asset status → In Repair ──────────────────────────────────────
    await conn.query(
      "UPDATE assets SET status = 'In Repair', updated_at = NOW() WHERE id = ?",
      [assetId]
    );

    // ── Log history ──────────────────────────────────────────────────────────
    await logHistory(conn, assetId, reported_by, 'Repair Created', {
      repair_id: repairId,
      repair_type,
      vendor_name,
      service_date: serviceDate,
      warranty_covered: warranty_covered
        ? `Yes — covered until ${activeWarranty?.end_date}`
        : 'No',
      document: warrantyDocument || null,
      new_status: 'In Repair',
      ...(repair_type === 'Replacement' && warrantyEnd
        ? { part_warranty: `${warrantyStart} → ${warrantyEnd}` }
        : {}),
    });

    await conn.commit();

    return res.status(201).json({
      message: warranty_covered
        ? `Repair created — covered under warranty (valid until ${activeWarranty?.end_date})`
        : repair_type === 'Replacement'
          ? 'Replacement repair created — part warranty recorded'
          : 'Repair created — no active warranty, cost applies',
      repair_id: repairId,
      warranty_covered: !!warranty_covered,
      warranty_end: activeWarranty?.end_date || null,
      warranty_document: warrantyDocument,
    });

  } catch (err) {
    await conn.rollback();
    console.error('createRepair error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/repairs
// List all repairs with asset + reporter info
// Query: ?search=&status=&repair_type=&page=1&limit=20
// ─────────────────────────────────────────────────────────
exports.getAllRepairs = async (req, res) => {
  try {
    const { search = '', status = '', repair_type = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (a.name LIKE ? OR a.asset_no LIKE ? OR r.vendor_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { where += ' AND r.status = ?'; params.push(status); }
    if (repair_type) { where += ' AND r.repair_type = ?'; params.push(repair_type); }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM asset_repairs r
       JOIN assets a ON a.id = r.asset_id
       WHERE ${where}`,
      [...params]
    );

    const [rows] = await db.query(
      `SELECT r.*,
              a.name AS asset_name, a.asset_no, a.category, a.status AS asset_status,
              CONCAT(u.first_name, ' ', u.last_name) AS reported_by_name,
              u.email AS reported_by_email
       FROM asset_repairs r
       JOIN assets a ON a.id = r.asset_id
       JOIN users  u ON u.id = r.reported_by
       WHERE ${where}
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.json({
      repairs: rows,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('getAllRepairs error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/repairs/asset/:assetId
// ─────────────────────────────────────────────────────────
exports.getRepairsByAsset = async (req, res) => {
  try {
    const { assetId } = req.params;
    const [rows] = await db.query(
      `SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) AS reported_by_name
       FROM asset_repairs r
       JOIN users u ON u.id = r.reported_by
       WHERE r.asset_id = ?
       ORDER BY r.id DESC`,
      [assetId]
    );
    return res.json({ repairs: rows });
  } catch (err) {
    console.error('getRepairsByAsset error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/repairs/:repairId
// ─────────────────────────────────────────────────────────
exports.getRepairById = async (req, res) => {
  try {
    const { repairId } = req.params;
    const [rows] = await db.query(
      `SELECT r.*,
              a.name AS asset_name, a.asset_no, a.category, a.status AS asset_status,
              CONCAT(u.first_name, ' ', u.last_name) AS reported_by_name,
              u.email AS reported_by_email
       FROM asset_repairs r
       JOIN assets a ON a.id = r.asset_id
       JOIN users  u ON u.id = r.reported_by
       WHERE r.id = ?`,
      [repairId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Repair not found' });
    return res.json({ repair: rows[0] });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /api/repairs/:repairId
// Update repair details or change status
//
// Status transitions → asset status:
//   Completed     → Available
//   Replaced      → Available
//   Cannot Repair → stays In Repair (admin decides salvage/retire)
//   In Progress   → In Repair (confirm)
// ─────────────────────────────────────────────────────────
exports.updateRepair = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { repairId } = req.params;
    const updatedBy = req.user?.id;
    const {
      status, vendor_name, repair_cost, description,
      start_date, completion_date,
      warranty_start, warranty_end, warranty_document,
    } = req.body;

    const [[repair]] = await conn.query(
      'SELECT * FROM asset_repairs WHERE id = ?', [repairId]
    );
    if (!repair) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Repair not found' });
    }

    const fields = [], values = [];
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (vendor_name !== undefined) { fields.push('vendor_name = ?'); values.push(vendor_name); }
    if (repair_cost !== undefined) { fields.push('repair_cost = ?'); values.push(repair_cost); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (start_date !== undefined) { fields.push('start_date = ?'); values.push(start_date); }
    if (completion_date !== undefined) { fields.push('completion_date = ?'); values.push(completion_date); }
    if (warranty_start !== undefined) { fields.push('warranty_start = ?'); values.push(warranty_start); }
    if (warranty_end !== undefined) { fields.push('warranty_end = ?'); values.push(warranty_end); }
    if (warranty_document !== undefined) { fields.push('warranty_document = ?'); values.push(warranty_document); }

    // Handle file replacement (if upload middleware is used on this route too)
    const updatedDoc = req.files?.warranty_document?.[0];
    if (updatedDoc) {
      const docPath = updatedDoc.path.replace(/\\/g, '/');
      fields.push('warranty_document = ?');
      values.push(docPath);
    }

    if (fields.length) {
      await conn.query(
        `UPDATE asset_repairs SET ${fields.join(', ')} WHERE id = ?`,
        [...values, repairId]
      );
    }

    // ── Asset status transitions ─────────────────────────────────────────────
    let newAssetStatus = null;
    if (status === 'Completed' || status === 'Replaced') {
      newAssetStatus = 'Available';
    } else if (status === 'In Progress' && repair.status === 'Pending') {
      newAssetStatus = 'In Repair';
    }

    if (newAssetStatus) {
      await conn.query(
        'UPDATE assets SET status = ?, updated_at = NOW() WHERE id = ?',
        [newAssetStatus, repair.asset_id]
      );
      await logHistory(conn, repair.asset_id, updatedBy, 'Repair Status Updated', {
        repair_id: repairId,
        previous_status: repair.status,
        new_repair_status: status,
        asset_status: newAssetStatus,
      });
    }

    await conn.commit();
    return res.json({ message: 'Repair updated successfully' });

  } catch (err) {
    await conn.rollback();
    console.error('updateRepair error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// DELETE /api/repairs/:repairId — Admin only
// ─────────────────────────────────────────────────────────
exports.deleteRepair = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { repairId } = req.params;
    const [[repair]] = await conn.query(
      'SELECT * FROM asset_repairs WHERE id = ?', [repairId]
    );
    if (!repair) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Repair not found' });
    }

    await conn.query('DELETE FROM asset_repairs WHERE id = ?', [repairId]);

    const [[asset]] = await conn.query(
      'SELECT status FROM assets WHERE id = ?', [repair.asset_id]
    );
    if (asset?.status === 'In Repair') {
      await conn.query(
        "UPDATE assets SET status = 'Available', updated_at = NOW() WHERE id = ?",
        [repair.asset_id]
      );
    }

    await conn.commit();
    return res.json({ message: 'Repair deleted and asset restored to Available' });

  } catch (err) {
    await conn.rollback();
    console.error('deleteRepair error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/repairs/check-warranty/:assetId
// Check warranty coverage for a given date
// ─────────────────────────────────────────────────────────
exports.checkWarranty = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { assetId } = req.params;
    const checkDate = req.query.date || null;

    const warranty = await getActiveWarranty(conn, assetId, checkDate);
    return res.json({
      has_warranty: !!warranty,
      warranty: warranty || null,
      warranty_covered: !!warranty,
      checked_date: checkDate || new Date().toISOString().split('T')[0],
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    conn.release();
  }
};

const db = require('../config/db');

// ─────────────────────────────────────────────────────────
// GET ALL ACCESSORIES
// ─────────────────────────────────────────────────────────
exports.getAllAccessories = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        a.*,
        COUNT(aa.id)                        AS total_assignments,
        SUM(aa.status = 'Assigned')         AS active_assignments
      FROM accessories a
      LEFT JOIN accessory_assignments aa ON a.id = aa.accessory_id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET ONE ACCESSORY (with assignment history)
// ─────────────────────────────────────────────────────────
exports.getAccessoryById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM accessories WHERE id = ?`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    const [assignments] = await db.query(`
      SELECT
        aa.*,
        ac.name                                   AS accessory_name,
        ast.name                                  AS asset_name,
        ast.asset_no,
        ast.category,
        CONCAT(u.first_name, ' ', u.last_name)    AS assigned_by_name,
        -- who currently holds the asset
        CONCAT(eu.first_name, ' ', eu.last_name)  AS asset_assigned_to_name,
        eu.email                                  AS asset_assigned_to_email
      FROM accessory_assignments aa
      JOIN  accessories  ac  ON aa.accessory_id = ac.id
      JOIN  assets       ast ON aa.asset_id     = ast.id
      LEFT JOIN users    u   ON aa.assigned_by  = u.id
      -- latest active asset assignment to know the holder
      LEFT JOIN asset_assignments asgn
             ON asgn.asset_id = aa.asset_id
            AND asgn.status   = 'Assigned'
      LEFT JOIN users eu ON asgn.assigned_to = eu.id
      WHERE aa.accessory_id = ?
      ORDER BY aa.assigned_date DESC
    `, [req.params.id]);

    res.json({ success: true, data: { ...rows[0], assignments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// CREATE ACCESSORY
// ─────────────────────────────────────────────────────────
exports.createAccessory = async (req, res) => {
  try {
    const { name, description, is_active = 1 } = req.body;
    if (!name)
      return res.status(400).json({ success: false, message: 'Name is required' });

    const [result] = await db.query(
      `INSERT INTO accessories (name, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [name, description || null, is_active]
    );
    const [rows] = await db.query(
      `SELECT * FROM accessories WHERE id = ?`, [result.insertId]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// UPDATE ACCESSORY
// ─────────────────────────────────────────────────────────
exports.updateAccessory = async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    const { id } = req.params;

    const [existing] = await db.query(
      `SELECT id FROM accessories WHERE id = ?`, [id]
    );
    if (existing.length === 0)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    await db.query(
      `UPDATE accessories
       SET name = ?, description = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, description || null, is_active ?? 1, id]
    );
    const [rows] = await db.query(`SELECT * FROM accessories WHERE id = ?`, [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE ACCESSORY
// ─────────────────────────────────────────────────────────
exports.deleteAccessory = async (req, res) => {
  try {
    const [existing] = await db.query(
      `SELECT id FROM accessories WHERE id = ?`, [req.params.id]
    );
    if (existing.length === 0)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    // block delete if active assignments exist
    const [active] = await db.query(
      `SELECT id FROM accessory_assignments
       WHERE accessory_id = ? AND status = 'Assigned' LIMIT 1`,
      [req.params.id]
    );
    if (active.length > 0)
      return res.status(400).json({
        success: false,
        message: 'Cannot delete — accessory has active assignments'
      });

    await db.query(`DELETE FROM accessories WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Accessory deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// TOGGLE ACTIVE STATUS
// ─────────────────────────────────────────────────────────
exports.toggleAccessoryStatus = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, is_active FROM accessories WHERE id = ?`, [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    const newStatus = rows[0].is_active ? 0 : 1;
    await db.query(
      `UPDATE accessories SET is_active = ?, updated_at = NOW() WHERE id = ?`,
      [newStatus, req.params.id]
    );
    res.json({
      success: true,
      message: `Accessory ${newStatus ? 'activated' : 'deactivated'}`,
      is_active: newStatus,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET ALL ACCESSORY ASSIGNMENTS
// ─────────────────────────────────────────────────────────
exports.getAllAccessoryAssignments = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        aa.id,
        aa.accessory_id,
        aa.asset_id,
        aa.quantity,
        aa.condition_out,
        aa.condition_in,
        aa.assigned_date,
        aa.expected_return_date,
        aa.actual_return_date,
        aa.assigned_by,
        aa.notes,
        aa.status,
        aa.created_at,
        aa.updated_at,

        ac.name                                   AS accessory_name,
        ac.description                            AS accessory_description,

        ast.name                                  AS asset_name,
        ast.asset_no,
        ast.category                              AS asset_category,

        CONCAT(ab.first_name, ' ', ab.last_name)  AS assigned_by_name,
        CONCAT(eu.first_name, ' ', eu.last_name)  AS asset_holder_name,
        eu.email                                  AS asset_holder_email,

        dept.name                                 AS asset_holder_department,
        desig.title                               AS asset_holder_designation,

        CASE
          WHEN aa.status = 'Assigned'
            AND aa.expected_return_date IS NOT NULL
            AND aa.expected_return_date < CURDATE()
          THEN 'Overdue'
          ELSE aa.status
        END                                       AS display_status,

        DATEDIFF(aa.expected_return_date, CURDATE()) AS days_until_due

      FROM accessory_assignments aa

      JOIN  accessories  ac   ON aa.accessory_id = ac.id
      JOIN  assets       ast  ON aa.asset_id     = ast.id

      LEFT JOIN users    ab   ON aa.assigned_by  = ab.id

      LEFT JOIN (
        SELECT asset_id, assigned_to
        FROM asset_assignments
        WHERE status = 'Assigned'
      ) asgn ON asgn.asset_id = aa.asset_id

      LEFT JOIN users        eu    ON eu.id    = asgn.assigned_to
      LEFT JOIN departments  dept  ON dept.id  = eu.department_id
      LEFT JOIN designations desig ON desig.id = eu.designation_id

      ORDER BY aa.assigned_date DESC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('SQL ERROR in getAllAccessoryAssignments:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
// ─────────────────────────────────────────────────────────
// GET ACCESSORIES FOR A SPECIFIC ASSET
// ─────────────────────────────────────────────────────────
exports.getAccessoriesByAsset = async (req, res) => {
  try {
    const { assetId } = req.params;

    const [rows] = await db.query(`
      SELECT
        aa.*,
        ac.name                                  AS accessory_name,
        ac.description                           AS accessory_description,
        CONCAT(ab.first_name, ' ', ab.last_name) AS assigned_by_name,
        CASE
          WHEN aa.status = 'Assigned'
            AND aa.expected_return_date IS NOT NULL
            AND aa.expected_return_date < CURDATE()
          THEN 'Overdue'
          ELSE aa.status
        END                                      AS display_status
      FROM accessory_assignments aa
      JOIN  accessories ac ON aa.accessory_id = ac.id
      LEFT JOIN users   ab ON aa.assigned_by  = ab.id
      WHERE aa.asset_id = ?
      ORDER BY aa.assigned_date DESC
    `, [assetId]);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// ASSIGN ACCESSORY TO ASSET
// ─────────────────────────────────────────────────────────
exports.assignAccessory = async (req, res) => {
  try {
    const {
      accessory_id,
      asset_id,
      quantity = 1,
      condition_out,
      assigned_date,
      expected_return_date,
      notes,
    } = req.body;

    // ── Validate required fields ──
    if (!accessory_id)
      return res.status(400).json({ success: false, message: 'accessory_id is required' });
    if (!asset_id)
      return res.status(400).json({ success: false, message: 'asset_id is required' });

    // ── Check accessory exists and is active ──
    const [acc] = await db.query(
      `SELECT id, name FROM accessories WHERE id = ? AND is_active = 1`,
      [accessory_id]
    );
    if (acc.length === 0)
      return res.status(404).json({
        success: false,
        message: 'Accessory not found or inactive'
      });

    // ── Check asset exists ──
    const [ast] = await db.query(
      `SELECT id, name, asset_no FROM assets WHERE id = ?`,
      [asset_id]
    );
    if (ast.length === 0)
      return res.status(404).json({ success: false, message: 'Asset not found' });

    // ── Check this accessory isn't already actively assigned to the same asset ──
    const [duplicate] = await db.query(
      `SELECT id FROM accessory_assignments
       WHERE accessory_id = ? AND asset_id = ? AND status = 'Assigned' LIMIT 1`,
      [accessory_id, asset_id]
    );
    if (duplicate.length > 0)
      return res.status(400).json({
        success: false,
        message: `${acc[0].name} is already assigned to this asset`
      });

    const [result] = await db.query(`
      INSERT INTO accessory_assignments
        (accessory_id, asset_id, quantity, condition_out,
         assigned_date, expected_return_date, assigned_by,
         notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Assigned', NOW(), NOW())
    `, [
      accessory_id,
      asset_id,
      quantity,
      condition_out || null,
      assigned_date || new Date().toISOString().split('T')[0],
      expected_return_date || null,
      req.user.id,
      notes || null,
    ]);

    res.status(201).json({
      success: true,
      message: `${acc[0].name} assigned to ${ast[0].name} (${ast[0].asset_no}) successfully`,
      assignmentId: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// RETURN ACCESSORY
// ─────────────────────────────────────────────────────────
exports.returnAccessory = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const {
      condition_in,
      actual_return_date = new Date().toISOString().split('T')[0],
    } = req.body;

    const [rows] = await db.query(
      `SELECT id, status FROM accessory_assignments WHERE id = ?`,
      [assignmentId]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Assignment not found' });

    if (rows[0].status === 'Returned')
      return res.status(400).json({
        success: false,
        message: 'Accessory already returned'
      });

    await db.query(`
      UPDATE accessory_assignments
      SET status             = 'Returned',
          condition_in       = ?,
          actual_return_date = ?,
          updated_at         = NOW()
      WHERE id = ?
    `, [condition_in || null, actual_return_date, assignmentId]);

    res.json({ success: true, message: 'Accessory returned successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// MARK OVERDUE (cron / manual trigger)
// ─────────────────────────────────────────────────────────
exports.markAccessoriesOverdue = async (req, res) => {
  try {
    const [result] = await db.query(`
      UPDATE accessory_assignments
      SET status     = 'Overdue',
          updated_at = NOW()
      WHERE status             = 'Assigned'
        AND expected_return_date IS NOT NULL
        AND expected_return_date < CURDATE()
    `);
    res.json({
      success: true,
      message: `${result.affectedRows} accessory assignment(s) marked overdue`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

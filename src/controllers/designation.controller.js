const db = require('../config/db');

exports.createDesignation = async (req, res) => {
  try {
    const {
      department_id,
      title,
      default_cia_confidentiality = 1,
      default_cia_integrity = 1,
      default_cia_availability = 1,
      default_asset_value,
      default_classification,
      default_color_code
    } = req.body;

    if (!department_id || !title) {
      return res.status(400).json({ success: false, message: 'department_id and title are required' });
    }

    const [result] = await db.query(
      `INSERT INTO designations (
        department_id, title,
        default_cia_confidentiality, default_cia_integrity, default_cia_availability,
        default_asset_value, default_classification, default_color_code
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        department_id, title,
        default_cia_confidentiality, default_cia_integrity, default_cia_availability,
        default_asset_value || null, default_classification || null, default_color_code || null
      ]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId, title, department_id }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Designation title already exists in this department' });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ success: false, message: 'Invalid department_id' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllDesignations = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT des.*, dep.name AS department_name
      FROM designations des
      JOIN departments dep ON des.department_id = dep.id
      ORDER BY dep.name, des.title
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDesignationsByDepartment = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM designations WHERE department_id = ? ORDER BY title',
      [req.params.departmentId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDesignationById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT des.*, dep.name AS department_name
       FROM designations des
       JOIN departments dep ON des.department_id = dep.id
       WHERE des.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Designation not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDesignation = async (req, res) => {
  try {
    const {
      title,
      default_cia_confidentiality,
      default_cia_integrity,
      default_cia_availability,
      default_asset_value,
      default_classification,
      default_color_code
    } = req.body;

    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (default_cia_confidentiality !== undefined) { updates.push('default_cia_confidentiality = ?'); values.push(default_cia_confidentiality); }
    if (default_cia_integrity !== undefined) { updates.push('default_cia_integrity = ?'); values.push(default_cia_integrity); }
    if (default_cia_availability !== undefined) { updates.push('default_cia_availability = ?'); values.push(default_cia_availability); }
    if (default_asset_value !== undefined) { updates.push('default_asset_value = ?'); values.push(default_asset_value); }
    if (default_classification !== undefined) { updates.push('default_classification = ?'); values.push(default_classification); }
    if (default_color_code !== undefined) { updates.push('default_color_code = ?'); values.push(default_color_code); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(req.params.id);
    const query = `UPDATE designations SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Designation not found' });
    }

    res.json({ success: true, message: 'Designation updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Designation title already exists in this department' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDesignation = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM designations WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Designation not found' });
    }

    res.json({ success: true, message: 'Designation deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



const db = require('../config/db');

// ────────────────────────────────────────────────
// CREATE Department
// ────────────────────────────────────────────────
exports.createDepartment = async (req, res) => {
  try {
    const { name, description, head_of_department } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Department name is required',
      });
    }

    // Optional: check if name already exists (extra safety)
    const [existing] = await db.query(
      'SELECT id FROM departments WHERE name = ?',
      [name.trim()]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A department with this name already exists',
      });
    }

    const [result] = await db.query(
      `INSERT INTO departments 
         (name, description, head_of_department, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [
        name.trim(),
        description?.trim() || null,
        head_of_department || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: {
        id: result.insertId,
        name: name.trim(),
        description: description?.trim() || null,
      },
    });
  } catch (error) {
    console.error('Create department error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Department name already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create department',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ────────────────────────────────────────────────
// GET All Departments (with optional head name)
// ────────────────────────────────────────────────
exports.getAllDepartments = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        d.id,
        d.name,
        d.description,
        d.head_of_department,
        CONCAT(u.first_name, ' ', u.last_name) AS head_name,
        d.created_at,
        d.updated_at
      FROM departments d
      LEFT JOIN users u ON d.head_of_department = u.id
      ORDER BY d.name ASC
    `);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error('Get all departments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments',
    });
  }
};

// ────────────────────────────────────────────────
// GET Single Department by ID
// ────────────────────────────────────────────────
exports.getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid department ID is required',
      });
    }

    const [rows] = await db.query(
      `
      SELECT 
        d.*,
        CONCAT(u.first_name, ' ', u.last_name) AS head_name
      FROM departments d
      LEFT JOIN users u ON d.head_of_department = u.id
      WHERE d.id = ?
    `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error('Get department by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department',
    });
  }
};

// ────────────────────────────────────────────────
// UPDATE Department
// ────────────────────────────────────────────────
exports.updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, head_of_department } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid department ID is required',
      });
    }

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one field to update is required',
      });
    }

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description.trim() || null);
    }
    if (head_of_department !== undefined) {
      fields.push('head_of_department = ?');
      values.push(head_of_department || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update',
      });
    }

    values.push(id);

    const [result] = await db.query(
      `
      UPDATE departments 
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = ?
    `,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found or no changes made',
      });
    }

    res.json({
      success: true,
      message: 'Department updated successfully',
    });
  } catch (error) {
    console.error('Update department error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Department name already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update department',
    });
  }
};

// ────────────────────────────────────────────────
// DELETE Department
// ────────────────────────────────────────────────
exports.deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid department ID is required',
      });
    }

    const [result] = await db.query('DELETE FROM departments WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    res.json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    console.error('Delete department error:', error);

    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete department — it is referenced by users or designations',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete department',
    });
  }
};

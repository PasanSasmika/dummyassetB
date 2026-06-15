const db     = require('../config/db');
const bcrypt = require('bcryptjs');

// ── Register ──────────────────────────────────────────────
exports.registerUser = async (req, res) => {
  try {
    const {
      username, email, employee_id, password, first_name, last_name,
      department_id, designation_id, role,
    } = req.body;

    if (!username || !email || !employee_id || !password) {
      return res.status(400).json({
        success: false,
        message: 'username, email, employee_id, password are required'
      });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      `INSERT INTO users (
        username, email, employee_id, password_hash, first_name, last_name,
        department_id, designation_id
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        username,
        email,
        employee_id.trim(),           // clean input
        password_hash,
        first_name || null,
        last_name  || null,
        department_id || null,
        designation_id || null
      ]
    );

    const roleName = role || 'User';
    const [roleRow] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);

    if (roleRow.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid role "${roleName}". Valid: Reporter, Admin, Operator, Engineer, User, Manager`,
      });
    }

    await db.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [result.insertId, roleRow[0].id]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId, username, email, employee_id, role: roleName },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      let msg = 'Username or email already exists';
      if (error.sqlMessage?.includes('employee_id')) {
        msg = 'This employee ID is already in use';
      }
      return res.status(409).json({ success: false, message: msg });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.username, u.email, u.employee_id,      -- ← added
             u.first_name, u.last_name, u.status,
             d.name AS department, des.title AS designation,
             GROUP_CONCAT(r.name) AS roles,
             u.created_at
      FROM users u
      LEFT JOIN departments d   ON u.department_id  = d.id
      LEFT JOIN designations des ON u.designation_id = des.id
      LEFT JOIN user_roles ur   ON u.id = ur.user_id
      LEFT JOIN roles r         ON ur.role_id = r.id
      GROUP BY u.id
      ORDER BY u.username
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// ── Get by ID ─────────────────────────────────────────────
exports.getUserById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.employee_id,
              u.first_name, u.last_name, u.status,
              d.name AS department, des.title AS designation,
              GROUP_CONCAT(r.name) AS roles,
              u.created_at, u.updated_at
       FROM users u
       LEFT JOIN departments d   ON u.department_id  = d.id
       LEFT JOIN designations des ON u.designation_id = des.id
       LEFT JOIN user_roles ur   ON u.id = ur.user_id
       LEFT JOIN roles r         ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Get my profile ────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.employee_id,
              u.first_name, u.last_name, u.status, u.is_super_admin,
              d.name AS department, des.title AS designation,
              GROUP_CONCAT(r.name) AS roles,
              u.created_at, u.updated_at
       FROM users u
       LEFT JOIN departments d   ON u.department_id  = d.id
       LEFT JOIN designations des ON u.designation_id = des.id
       LEFT JOIN user_roles ur   ON u.id = ur.user_id
       LEFT JOIN roles r         ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const [accessRows] = await db.query(
      'SELECT panel_key FROM user_sidebar_access WHERE user_id = ?',
      [req.user.id]
    );

    const profile = rows[0];
    profile.is_super_admin = profile.is_super_admin === 1;
    profile.sidebar_access = accessRows.map(r => r.panel_key);

    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const HARDCODED_ADMIN_ID = 999;

// ── Update user ───────────────────────────────────────────
exports.updateUser = async (req, res) => {
  if (Number(req.params.id) === HARDCODED_ADMIN_ID) {
    return res.status(403).json({ success: false, message: 'This account cannot be modified.' });
  }
  try {
    const { first_name, last_name, email, department_id, designation_id } = req.body;

    const [result] = await db.query(
      `UPDATE users
       SET first_name     = COALESCE(?, first_name),
           last_name      = COALESCE(?, last_name),
           email          = COALESCE(?, email),
           department_id  = COALESCE(?, department_id),
           designation_id = COALESCE(?, designation_id)
       WHERE id = ?`,
      [first_name, last_name, email, department_id, designation_id, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Update status (activate / deactivate) ────────────────
exports.updateUserStatus = async (req, res) => {
  if (Number(req.params.id) === HARDCODED_ADMIN_ID) {
    return res.status(403).json({ success: false, message: 'This account cannot be modified.' });
  }
  try {
    const { status } = req.body;

    if (!status || !['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status must be "Active" or "Inactive"',
      });
    }

    const [result] = await db.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: `User ${status === 'Active' ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Assign role ───────────────────────────────────────────
exports.assignRole = async (req, res) => {
  if (Number(req.params.id) === HARDCODED_ADMIN_ID) {
    return res.status(403).json({ success: false, message: 'This account cannot be modified.' });
  }
  try {
    const { role_name, role } = req.body;
    const roleName = role_name || role;

    if (!roleName) {
      return res.status(400).json({ success: false, message: 'role_name required' });
    }

    const [roleRow] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
    if (roleRow.length === 0) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    await db.query(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [req.params.id, roleRow[0].id]
    );

    res.json({ success: true, message: `Role ${roleName} assigned` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Reset Password

exports.adminResetPassword = async (req, res) => {
  if (Number(req.params.id) === HARDCODED_ADMIN_ID) {
    return res.status(403).json({ success: false, message: 'This account cannot be modified.' });
  }
  try {
    const defaultPassword = '1234';
    const password_hash = await bcrypt.hash(defaultPassword, 12);
    
    // Update the password AND set the force reset flag to true (1)
    const [result] = await db.query(
      'UPDATE users SET password_hash = ?, force_password_reset = 1 WHERE id = ?',
      [password_hash, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Password reset to 1234 successfully. User will be forced to change it on next login.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── User Sets Their New Password ──────────────────────────
exports.userChangePassword = async (req, res) => {
  try {
    const { new_password } = req.body;

    if (!new_password || new_password.length < 4) {
      return res.status(400).json({ success: false, message: 'Please provide a valid new password.' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);

    // Update password and REMOVE the force reset flag (set to 0)
    await db.query(
      'UPDATE users SET password_hash = ?, force_password_reset = 0 WHERE id = ?',
      [password_hash, req.user.id] // req.user.id comes from the protect middleware
    );

    res.json({ success: true, message: 'Password updated successfully. You can now use the dashboard.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.bulkUploadUsers = async (req, res) => {
  try {
    const { users } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ success: false, message: 'No user data provided' });
    }

    const errors = [];
    let successCount = 0;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const { username, email, employee_id, password, first_name, last_name, department_id, designation_id, role } = user;

      if (!username || !email || !employee_id || !password) {
        errors.push({ ...user, Upload_Error: 'Missing required fields (username, email, employee_id, password)' });
        continue;
      }

      try {
        const password_hash = await bcrypt.hash(String(password), 12);
        const [result] = await db.query(
          `INSERT INTO users (username, email, employee_id, password_hash, first_name, last_name, department_id, designation_id) VALUES (?,?,?,?,?,?,?,?)`,
          [username, email, String(employee_id).trim(), password_hash, first_name || null, last_name || null, department_id || null, designation_id || null]
        );

        const roleName = role || 'User';
        const [roleRow] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
        
        if (roleRow.length > 0) {
          await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [result.insertId, roleRow[0].id]);
        }
        successCount++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          errors.push({ ...user, Upload_Error: 'Duplicate username, email, or employee_id' });
        } else {
          errors.push({ ...user, Upload_Error: err.message });
        }
      }
    }

    res.json({ success: true, successCount, errorCount: errors.length, errors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
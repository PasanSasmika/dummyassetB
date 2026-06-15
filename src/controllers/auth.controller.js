const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      roles: user.roles ? user.roles.split(',') : [],
      is_super_admin: user.is_super_admin === 1
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.password_hash, u.status, u.force_password_reset,
              u.first_name, u.last_name, u.is_super_admin,
              GROUP_CONCAT(r.name) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r       ON ur.role_id = r.id
       WHERE u.email = ?
       GROUP BY u.id`,
      [email]
    );

    if (rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid email or password' });
    const user = rows[0];

    if (user.status !== 'Active') return res.status(403).json({ success: false, message: `Account is ${user.status}. Contact admin.` });

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = generateToken(user);

    // 2. CHECK THE FLAG HERE
    if (user.force_password_reset === 1) {
      return res.json({
        success: true,
        requirePasswordChange: true, // Special flag for your frontend
        token, // Give them the token so they are authorized to hit the change-password endpoint
        message: 'You must change your default password before continuing.',
      });
    }

    // Fetch sidebar panel access for this user
    const [accessRows] = await db.query(
      'SELECT panel_key FROM user_sidebar_access WHERE user_id = ?',
      [user.id]
    );
    const sidebar_access = accessRows.map(r => r.panel_key);

    // Normal login response
    res.json({
      success: true,
      message: 'Login successful',
      token,
      data: {
        id: user.id, username: user.username, email: user.email,
        first_name: user.first_name, last_name: user.last_name,
        roles: user.roles ? user.roles.split(',') : [],
        is_super_admin: user.is_super_admin === 1,
        sidebar_access
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/auth/logout
exports.logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};
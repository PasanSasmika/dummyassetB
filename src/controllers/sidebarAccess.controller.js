const db = require('../config/db');

// GET /api/sidebar-access/admins
exports.getAdminUsers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.email, u.status
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'Admin' AND u.is_super_admin = 0
      GROUP BY u.id
      ORDER BY u.username
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/sidebar-access/:userId
exports.getUserAccess = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT panel_key FROM user_sidebar_access WHERE user_id = ?',
      [req.params.userId]
    );
    res.json({ success: true, data: rows.map(r => r.panel_key) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/sidebar-access/:userId
exports.updateUserAccess = async (req, res) => {
  const { panels } = req.body;
  const userId = req.params.userId;

  if (!Array.isArray(panels)) {
    return res.status(400).json({ success: false, message: 'panels must be an array' });
  }

  try {
    await db.query('DELETE FROM user_sidebar_access WHERE user_id = ?', [userId]);

    if (panels.length > 0) {
      const values = panels.map(key => [userId, key]);
      await db.query('INSERT INTO user_sidebar_access (user_id, panel_key) VALUES ?', [values]);
    }

    res.json({ success: true, message: 'Sidebar access updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

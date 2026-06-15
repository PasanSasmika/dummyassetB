const db = require('../config/db');

exports.getAllAuditLogs = async (req, res) => {
  try {
    const { search, action_type, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = '1=1';
    const params = [];

    // Search by asset name, asset number, or user name
    if (search) {
      where += ' AND (a.name LIKE ? OR a.asset_no LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)';
      const likeSearch = `%${search}%`;
      params.push(likeSearch, likeSearch, likeSearch, likeSearch);
    }

    if (action_type) {
      where += ' AND ah.change_type = ?';
      params.push(action_type);
    }

    // Get Total Count for Pagination
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total 
       FROM asset_history ah
       LEFT JOIN assets a ON ah.asset_id = a.id
       LEFT JOIN users u ON ah.changed_by = u.id
       WHERE ${where}`,
      params
    );

    // Get Paginated Data
    const [rows] = await db.query(
      `SELECT ah.id, ah.asset_id, ah.changed_by, ah.change_type, ah.change_details,
              DATE_ADD(ah.created_at, INTERVAL '5:30' HOUR_MINUTE) AS created_at,
              a.name AS asset_name, a.asset_no, a.category,
              CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name,
              u.email AS changed_by_email
       FROM asset_history ah
       LEFT JOIN assets a ON ah.asset_id = a.id
       LEFT JOIN users u ON ah.changed_by = u.id
       WHERE ${where}
       ORDER BY ah.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      count: rows.length,
      data: rows
    });

  } catch (error) {
    console.error('Audit Log Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: error.message });
  }
};
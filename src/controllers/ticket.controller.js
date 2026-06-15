const db = require('../config/db');

exports.createTicket = async (req, res) => {
  try {
    const {
      asset_id, issue_type, priority = 'Low',
      title, description
    } = req.body;

    if (!title || !description || !issue_type) {
      return res.status(400).json({ success: false, message: 'title, description, issue_type required' });
    }

    const [result] = await db.query(
      `INSERT INTO tickets (
        asset_id, reporter_id, issue_type, priority,
        title, description, status
      ) VALUES (?,?,?,?,?,?, 'Open')`,
      [
        asset_id || null,
        req.user.id,
        issue_type,
        priority,
        title,
        description
      ]
    );

    res.status(201).json({
      success: true,
      ticketId: result.insertId,
      message: 'Ticket created'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyReportedTickets = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, a.name AS asset_name
       FROM tickets t
       LEFT JOIN assets a ON t.asset_id = a.id
       WHERE t.reporter_id = ?
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTicketsAssignedToMe = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, a.name AS asset_name,
              CONCAT(u.first_name, ' ', u.last_name) AS reporter_name
       FROM tickets t
       LEFT JOIN assets a ON t.asset_id = a.id
       LEFT JOIN users u ON t.reporter_id = u.id
       WHERE t.assignee_id = ?
       ORDER BY 
         CASE t.priority 
           WHEN 'Critical' THEN 1
           WHEN 'High' THEN 2
           WHEN 'Medium' THEN 3
           ELSE 4 
         END, t.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addTicketUpdate = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { update_text } = req.body;

    if (!update_text?.trim()) {
      return res.status(400).json({ success: false, message: 'update_text required' });
    }

    await db.query(
      'INSERT INTO ticket_updates (ticket_id, user_id, update_text) VALUES (?,?,?)',
      [ticketId, req.user.id, update_text]
    );

    res.status(201).json({ success: true, message: 'Update added' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, resolved_at } = req.body;

    if (!status) return res.status(400).json({ success: false, message: 'status required' });

    const extra = status === 'Resolved' || status === 'Closed' ? ', resolved_at = ?' : '';
    const values = status === 'Resolved' || status === 'Closed' ? [resolved_at || new Date(), ticketId] : [status, ticketId];

    const [result] = await db.query(
      `UPDATE tickets SET status = ? ${extra} , updated_at = NOW() WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    res.json({ success: true, message: `Ticket status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAllTickets = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, a.name AS asset_name,
              CONCAT(rep.first_name, ' ', rep.last_name) AS reporter_name,
              CONCAT(asgn.first_name, ' ', asgn.last_name) AS assignee_name
       FROM tickets t
       LEFT JOIN assets a    ON t.asset_id    = a.id
       LEFT JOIN users rep   ON t.reporter_id = rep.id
       LEFT JOIN users asgn  ON t.assignee_id = asgn.id
       ORDER BY
         CASE t.priority
           WHEN 'Critical' THEN 1
           WHEN 'High'     THEN 2
           WHEN 'Medium'   THEN 3
           ELSE 4
         END, t.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTicketById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, a.name AS asset_name,
              CONCAT(rep.first_name, ' ', rep.last_name) AS reporter_name,
              CONCAT(asgn.first_name, ' ', asgn.last_name) AS assignee_name
       FROM tickets t
       LEFT JOIN assets a    ON t.asset_id    = a.id
       LEFT JOIN users rep   ON t.reporter_id = rep.id
       LEFT JOIN users asgn  ON t.assignee_id = asgn.id
       WHERE t.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Fetch updates thread for this ticket
    const [updates] = await db.query(
      `SELECT tu.*, CONCAT(u.first_name, ' ', u.last_name) AS author
       FROM ticket_updates tu
       LEFT JOIN users u ON tu.user_id = u.id
       WHERE tu.ticket_id = ?
       ORDER BY tu.created_at ASC`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...rows[0], updates } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

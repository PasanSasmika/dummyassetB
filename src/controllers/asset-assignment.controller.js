const db = require('../config/db');
const path = require('path');
const fs = require('fs');

// ─── HELPERS ─────────────────────────────────────────────

async function resolveCIAFromDesignation(conn, designationId) {
  if (!designationId) return null;
  const [rows] = await conn.query(
    `SELECT default_cia_confidentiality, default_cia_integrity, default_cia_availability,
            default_asset_value, default_classification, default_color_code, title
     FROM designations WHERE id = ?`,
    [designationId]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function getUserDesignationId(conn, userId) {
  if (!userId) return null;
  const [rows] = await conn.query('SELECT designation_id FROM users WHERE id = ?', [userId]);
  return rows.length > 0 ? rows[0].designation_id : null;
}

async function applyAssetCIA(conn, assetId, cia) {
  if (!cia) return;
  const c = Number(cia.default_cia_confidentiality) || 1;
  const i = Number(cia.default_cia_integrity) || 1;
  const a = Number(cia.default_cia_availability) || 1;
  const assetValue = cia.default_asset_value ? Number(cia.default_asset_value) : Math.max(c, i, a);
  const classification = cia.default_classification || (assetValue >= 3 ? 'High' : assetValue === 2 ? 'Medium' : 'Low');
  const colorCode = cia.default_color_code || (classification === 'High' ? '#ef4444' : classification === 'Medium' ? '#f59e0b' : '#22c55e');
  await conn.query(
    `UPDATE assets SET cia_confidentiality=?, cia_integrity=?, cia_availability=?,
     asset_value=?, classification=?, color_code=?, updated_at=NOW() WHERE id=?`,
    [c, i, a, assetValue, classification, colorCode, assetId]
  );
  return { c, i, a, assetValue, classification, colorCode };
}

async function logHistory(conn, assetId, changedBy, changeType, details) {
  try {
    await conn.query(
      `INSERT INTO asset_history (asset_id, changed_by, change_type, change_details, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [assetId, changedBy, changeType, JSON.stringify(details)]
    );
  } catch (_) { }
}

// ─── ASSIGN ASSET ────────────────────────────────────────
// POST /assignments/assets/:assetId/assign
exports.assignAsset = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assetId } = req.params;
    const {
      assigned_to, assigned_to_department, assigned_to_designation,
      expected_return_date, condition_out, location_id, sub_location_id,
    } = req.body;

    if (!assigned_to && !assigned_to_department && !assigned_to_designation)
      return res.status(400).json({ success: false, message: 'At least one of assigned_to, assigned_to_department, or assigned_to_designation is required' });

    if (location_id) {
      const [loc] = await conn.query('SELECT id FROM locations WHERE id = ?', [location_id]);
      if (!loc.length) return res.status(400).json({ success: false, message: 'Location not found' });
    }
    if (sub_location_id) {
      const [sl] = await conn.query(
        'SELECT id FROM sub_locations WHERE id = ? AND location_id = ?',
        [sub_location_id, location_id]
      );
      if (!sl.length) return res.status(400).json({ success: false, message: 'Sub-location not found or does not belong to selected location' });
    }

    const [assets] = await conn.query('SELECT id, name, status FROM assets WHERE id = ?', [assetId]);
    if (!assets.length) throw new Error('Asset not found');
    if (assets[0].status !== 'Available') throw new Error(`Asset is not available for assignment (current status: ${assets[0].status})`);

    const resolvedDesignationId = assigned_to_designation || (assigned_to ? await getUserDesignationId(conn, assigned_to) : null);
    const ciaData = await resolveCIAFromDesignation(conn, resolvedDesignationId);

    const [result] = await conn.query(
      `INSERT INTO asset_assignments
         (asset_id, assigned_to, assigned_by, assignment_date, expected_return_date,
          condition_out, location_id, sub_location_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Assigned')`,
      [
        assetId, assigned_to || null, req.user.id, new Date().toISOString().split('T')[0],
        expected_return_date || null, condition_out || null, location_id || null, sub_location_id || null,
      ]
    );

    await conn.query("UPDATE assets SET status='In Use', updated_at=NOW() WHERE id=?", [assetId]);

    let ciaUpdated = false, appliedCIA = null;
    if (ciaData) {
      appliedCIA = await applyAssetCIA(conn, assetId, ciaData);
      ciaUpdated = true;
      await logHistory(conn, assetId, req.user.id, 'CIA_AUTO_UPDATE', {
        reason: 'Auto-updated on assignment based on designation',
        assignment_id: result.insertId,
        designation_id: resolvedDesignationId,
        designation_title: ciaData.title,
        location_id: location_id || null,
        sub_location_id: sub_location_id || null,
      });
    } else {
      await logHistory(conn, assetId, req.user.id, 'ASSIGNED', {
        reason: 'Asset assigned — no designation found, CIA unchanged',
        assignment_id: result.insertId,
        location_id: location_id || null,
        sub_location_id: sub_location_id || null,
      });
    }

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Asset assigned successfully',
      assignmentId: result.insertId,
      location_id: location_id || null,
      sub_location_id: sub_location_id || null,
      ciaUpdated,
      ciaSource: ciaUpdated
        ? `Designation: ${ciaData.title} (#${resolvedDesignationId})`
        : 'No designation found — CIA levels unchanged',
      ...(ciaUpdated && {
        newCIA: {
          confidentiality: ciaData.default_cia_confidentiality,
          integrity: ciaData.default_cia_integrity,
          availability: ciaData.default_cia_availability,
          asset_value: appliedCIA.assetValue,
          classification: appliedCIA.classification,
        },
      }),
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── UPLOAD ASSIGN DOCUMENT ──────────────────────────────
// PATCH /assignments/assignments/:assignmentId/upload-assign-doc
exports.uploadAssignDocument = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assignmentId } = req.params;

    // Fetch assignment + asset name
    const [rows] = await conn.query(
      `SELECT aa.id, aa.asset_id, aa.status, aa.assign_document_id, a.name AS asset_name
       FROM asset_assignments aa
       JOIN assets a ON aa.asset_id = a.id
       WHERE aa.id = ?`,
      [assignmentId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Assignment not found' });

    const assignment = rows[0];

    // Must be in Assigned (or Overdue) status — not yet returned
    if (!['Assigned', 'Overdue'].includes(assignment.status))
      return res.status(400).json({
        success: false,
        message: `Cannot upload assign document — status is "${assignment.status}". Asset must be currently assigned.`,
      });

    if (!req.file)
      return res.status(400).json({ success: false, message: 'No file uploaded. Send a PDF/image as "file" field.' });

    const { originalname, path: filePath, size } = req.file;
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Auto-generate document name: "Assignment-<id>-<assetName>-<date>"
    const datePart = new Date().toISOString().split('T')[0];
    const safeAsset = (assignment.asset_name || 'Asset').replace(/[^a-zA-Z0-9]/g, '-');
    const documentName = `Assignment-${assignmentId}-${safeAsset}-${datePart}`;

    // Remove old assign doc if it exists (replace flow)
    if (assignment.assign_document_id) {
      const [old] = await conn.query('SELECT file_path FROM documents WHERE id = ?', [assignment.assign_document_id]);
      if (old.length) { try { fs.unlinkSync(old[0].file_path); } catch (_) { } }
      await conn.query('DELETE FROM documents WHERE id = ?', [assignment.assign_document_id]);
    }

    // Insert into documents table
    const [docResult] = await conn.query(
      `INSERT INTO documents
         (entity_type, entity_id, document_type, document_name, file_path, uploaded_by, uploaded_at)
       VALUES ('Assignment', ?, 'Other', ?, ?, ?, NOW())`,
      [assignmentId, documentName, normalizedPath, req.user.id]
    );
    const newDocId = docResult.insertId;

    // Save FK back to asset_assignments
    await conn.query(
      'UPDATE asset_assignments SET assign_document_id = ?, updated_at = NOW() WHERE id = ?',
      [newDocId, assignmentId]
    );

    await logHistory(conn, assignment.asset_id, req.user.id, 'ASSIGN_DOC_UPLOADED', {
      assignment_id: Number(assignmentId),
      document_id: newDocId,
      document_name: documentName,
      file_path: normalizedPath,
      size_bytes: size,
    });

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Assignment document uploaded successfully.',
      documentId: newDocId,
      assignmentId: Number(assignmentId),
      document: {
        id: newDocId,
        entity_type: 'Assignment',
        entity_id: Number(assignmentId),
        document_type: 'Other',
        document_name: documentName,
        file_path: normalizedPath,
        uploaded_by: req.user.id,
      },
    });
  } catch (err) {
    await conn.rollback();
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { } }
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── GET ASSIGN DOCUMENT ─────────────────────────────────
// GET /assignments/assignments/:assignmentId/assign-doc
exports.getAssignDocument = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM asset_assignments aa
       JOIN  documents d ON aa.assign_document_id = d.id
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE aa.id = ?`,
      [req.params.assignmentId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'No assignment document found for this assignment' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── RETURN ASSET ────────────────────────────────────────
// POST /assignments/assignments/:assignmentId/return
exports.returnAsset = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assignmentId } = req.params;
    const { condition_in, actual_return_date = new Date().toISOString().split('T')[0] } = req.body;

    const [assign] = await conn.query('SELECT asset_id, status FROM asset_assignments WHERE id=?', [assignmentId]);
    if (!assign.length) throw new Error('Assignment not found');
    if (assign[0].status !== 'Assigned') throw new Error(`Assignment cannot be returned (current status: ${assign[0].status})`);

    const assetId = assign[0].asset_id;
    await conn.query(
      "UPDATE asset_assignments SET actual_return_date=?, condition_in=?, status='Returned', updated_at=NOW() WHERE id=?",
      [actual_return_date, condition_in || null, assignmentId]
    );
    await conn.query("UPDATE assets SET status='Available', updated_at=NOW() WHERE id=?", [assetId]);
    await logHistory(conn, assetId, req.user.id, 'RETURNED', {
      reason: 'Asset returned — CIA levels unchanged',
      assignment_id: assignmentId,
      returned_by: req.user.id,
      condition_in: condition_in || null,
    });
    await conn.commit();
    res.json({ success: true, message: 'Asset returned successfully.', assignmentId: Number(assignmentId), awaitingSignedDoc: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── UPLOAD RETURN DOCUMENT ──────────────────────────────
// POST /assignments/assignments/:assignmentId/upload-return-doc
exports.uploadReturnDocument = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assignmentId } = req.params;

    const [rows] = await conn.query(
      `SELECT aa.id, aa.asset_id, aa.status, aa.return_document_id, a.name AS asset_name
       FROM asset_assignments aa JOIN assets a ON aa.asset_id=a.id WHERE aa.id=?`,
      [assignmentId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const assignment = rows[0];
    if (assignment.status !== 'Returned')
      return res.status(400).json({ success: false, message: `Cannot upload return doc — status is "${assignment.status}". Asset must be returned first.` });
    if (!req.file)
      return res.status(400).json({ success: false, message: 'No file uploaded. Send a PDF as "file" field.' });

    const { originalname, path: filePath, size } = req.file;
    const documentName = req.body.document_name || originalname;
    const documentType = req.body.document_type || 'Other';
    const normalizedPath = filePath.replace(/\\/g, '/');

    if (assignment.return_document_id) {
      const [old] = await conn.query('SELECT file_path FROM documents WHERE id=?', [assignment.return_document_id]);
      if (old.length) { try { fs.unlinkSync(old[0].file_path); } catch (_) { } }
      await conn.query('DELETE FROM documents WHERE id=?', [assignment.return_document_id]);
    }

    const [docResult] = await conn.query(
      "INSERT INTO documents (entity_type, entity_id, document_type, document_name, file_path, uploaded_by, uploaded_at) VALUES ('Assignment', ?, ?, ?, ?, ?, NOW())",
      [assignmentId, documentType, documentName, normalizedPath, req.user.id]
    );
    const newDocId = docResult.insertId;
    await conn.query('UPDATE asset_assignments SET return_document_id=?, updated_at=NOW() WHERE id=?', [newDocId, assignmentId]);
    await logHistory(conn, assignment.asset_id, req.user.id, 'RETURN_DOC_UPLOADED', {
      assignment_id: Number(assignmentId), document_id: newDocId,
      document_name: documentName, file_path: normalizedPath, size_bytes: size,
    });
    await conn.commit();
    res.status(201).json({
      success: true, message: 'Signed return document uploaded successfully.',
      documentId: newDocId, assignmentId: Number(assignmentId),
      document: { id: newDocId, entity_type: 'Assignment', entity_id: Number(assignmentId), document_type: documentType, document_name: documentName, file_path: normalizedPath, uploaded_by: req.user.id },
    });
  } catch (err) {
    await conn.rollback();
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { } }
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── UPLOAD GATE PASS DOCUMENT ───────────────────────────
// PATCH /assignments/assignments/:assignmentId/upload-gate-pass
exports.uploadGatePassDocument = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assignmentId } = req.params;

    const [rows] = await conn.query(
      `SELECT aa.id, aa.asset_id, aa.status, aa.gate_pass_document_id, a.name AS asset_name
       FROM asset_assignments aa
       JOIN assets a ON aa.asset_id = a.id
       WHERE aa.id = ?`,
      [assignmentId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'Assignment not found' });

    if (!req.file)
      return res.status(400).json({ success: false, message: 'No file uploaded. Send a PDF/image as "file" field.' });

    const { path: filePath, size } = req.file;
    const normalizedPath = filePath.replace(/\\/g, '/');
    const assignment = rows[0];

    const datePart = new Date().toISOString().split('T')[0];
    const safeAsset = (assignment.asset_name || 'Asset').replace(/[^a-zA-Z0-9]/g, '-');
    const documentName = `GatePass-${assignmentId}-${safeAsset}-${datePart}`;

    if (assignment.gate_pass_document_id) {
      const [old] = await conn.query('SELECT file_path FROM documents WHERE id = ?', [assignment.gate_pass_document_id]);
      if (old.length) { try { fs.unlinkSync(old[0].file_path); } catch (_) { } }
      await conn.query('DELETE FROM documents WHERE id = ?', [assignment.gate_pass_document_id]);
    }

    const [docResult] = await conn.query(
      `INSERT INTO documents
         (entity_type, entity_id, document_type, document_name, file_path, uploaded_by, uploaded_at)
       VALUES ('Assignment', ?, 'Gate Pass', ?, ?, ?, NOW())`,
      [assignmentId, documentName, normalizedPath, req.user.id]
    );
    const newDocId = docResult.insertId;

    await conn.query(
      'UPDATE asset_assignments SET gate_pass_document_id = ?, updated_at = NOW() WHERE id = ?',
      [newDocId, assignmentId]
    );

    await logHistory(conn, assignment.asset_id, req.user.id, 'GATE_PASS_UPLOADED', {
      assignment_id: Number(assignmentId),
      document_id: newDocId,
      document_name: documentName,
      file_path: normalizedPath,
      size_bytes: size,
    });

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Gate pass document uploaded successfully.',
      documentId: newDocId,
      assignmentId: Number(assignmentId),
      document: {
        id: newDocId,
        entity_type: 'Assignment',
        entity_id: Number(assignmentId),
        document_type: 'Gate Pass',
        document_name: documentName,
        file_path: normalizedPath,
        uploaded_by: req.user.id,
      },
    });
  } catch (err) {
    await conn.rollback();
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { } }
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── GET GATE PASS DOCUMENT ───────────────────────────────
exports.getGatePassDocument = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM asset_assignments aa
       JOIN documents d ON aa.gate_pass_document_id = d.id
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE aa.id = ?`,
      [req.params.assignmentId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'No gate pass document found for this assignment' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET RETURN DOCUMENT ─────────────────────────────────
exports.getReturnDocument = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name,' ',u.last_name) AS uploaded_by_name
       FROM asset_assignments aa
       JOIN documents d ON aa.return_document_id=d.id
       LEFT JOIN users u ON d.uploaded_by=u.id
       WHERE aa.id=?`,
      [req.params.assignmentId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'No return document found for this assignment' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET ALL ASSIGNMENTS ─────────────────────────────────
// GET /assignments/assets/allassignments
exports.getAllAssignments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         aa.*,
         a.name                                   AS asset_name,
         a.asset_no,
         a.category,
         at.name                                  AS asset_type,
         a.cia_confidentiality,
         a.cia_integrity,
         a.cia_availability,
         a.classification                         AS asset_classification,
         CONCAT(u1.first_name,' ',u1.last_name)  AS assigned_to_name,
         CONCAT(u2.first_name,' ',u2.last_name)  AS assigned_by_name,
         u1.email                                 AS assigned_to_email,
         d.title                                  AS designation_title,
         d.default_cia_confidentiality,
         d.default_cia_integrity,
         d.default_cia_availability,
         d.default_classification,
         l.id                                     AS location_id,
         l.location_name,
         l.address                                AS location_address,
         sl.id                                    AS sub_location_id,
         sl.sub_location_name,
         sl.details                               AS sub_location_details,
         sl.address                               AS sub_location_address,
         adoc.id                                  AS assign_doc_id,
         adoc.document_name                       AS assign_doc_name,
         adoc.file_path                           AS assign_doc_path,
         adoc.uploaded_at                         AS assign_doc_uploaded_at,
         gpdoc.id                                 AS gate_pass_doc_id,
         gpdoc.document_name                      AS gate_pass_doc_name,
         gpdoc.file_path                          AS gate_pass_doc_path,
         gpdoc.uploaded_at                        AS gate_pass_doc_uploaded_at,
         doc.id                                   AS return_doc_id,
         doc.document_name                        AS return_doc_name,
         doc.file_path                            AS return_doc_path,
         doc.document_type                        AS return_doc_type,
         doc.uploaded_at                          AS return_doc_uploaded_at,
         CASE
           WHEN aa.status='Assigned' AND aa.expected_return_date IS NOT NULL
            AND aa.expected_return_date < CURDATE() THEN 'Overdue'
           ELSE aa.status
         END                                      AS display_status,
         DATEDIFF(aa.expected_return_date, CURDATE()) AS days_until_due
       FROM asset_assignments  aa
       JOIN   assets           a   ON aa.asset_id           = a.id
       LEFT JOIN asset_types   at  ON a.asset_type_id       = at.id
       LEFT JOIN users         u1  ON aa.assigned_to        = u1.id
       LEFT JOIN users         u2  ON aa.assigned_by        = u2.id
       LEFT JOIN designations  d   ON u1.designation_id     = d.id
       LEFT JOIN locations     l   ON aa.location_id        = l.id
       LEFT JOIN sub_locations sl  ON aa.sub_location_id    = sl.id
       LEFT JOIN documents     adoc  ON aa.assign_document_id   = adoc.id
       LEFT JOIN documents     gpdoc ON aa.gate_pass_document_id = gpdoc.id
       LEFT JOIN documents     doc   ON aa.return_document_id   = doc.id
       ORDER BY aa.assignment_date DESC`
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET ASSIGNMENT BY ID ────────────────────────────────
exports.getAssignmentById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         aa.*,
         a.name AS asset_name, a.asset_no, a.description AS asset_description,
         a.category,
         at.name                                            AS asset_type,
         a.status AS asset_status, a.cost, a.currency, a.financial_type, a.po_number,
         a.cia_confidentiality, a.cia_integrity, a.cia_availability, a.asset_value,
         a.classification AS asset_classification, a.color_code AS asset_color_code,
         u1.id AS user_id, u1.first_name AS user_first_name, u1.last_name AS user_last_name,
         u1.email AS user_email, u1.username AS user_username, u1.status AS user_status,
         u2.first_name AS assigned_by_first_name, u2.last_name AS assigned_by_last_name,
         u2.email AS assigned_by_email,
         d.id AS designation_id, d.title AS designation_title,
         d.default_cia_confidentiality, d.default_cia_integrity, d.default_cia_availability,
         d.default_classification, d.default_asset_value,
         dept.id AS department_id, dept.name AS department_name,
         l.id AS location_id, l.location_name, l.address AS location_address, l.details AS location_details,
         sl.id                AS sub_location_id,
         sl.sub_location_name,
         sl.details           AS sub_location_details,
         sl.address           AS sub_location_address,
         adoc.id              AS assign_doc_id,
         adoc.document_name   AS assign_doc_name,
         adoc.file_path       AS assign_doc_path,
         adoc.document_type   AS assign_doc_type,
         adoc.uploaded_at     AS assign_doc_uploaded_at,
         uAdoc.first_name     AS assign_doc_uploader_first,
         uAdoc.last_name      AS assign_doc_uploader_last,
         gpdoc.id             AS gate_pass_doc_id,
         gpdoc.document_name  AS gate_pass_doc_name,
         gpdoc.file_path      AS gate_pass_doc_path,
         gpdoc.document_type  AS gate_pass_doc_type,
         gpdoc.uploaded_at    AS gate_pass_doc_uploaded_at,
         uGP.first_name       AS gate_pass_doc_uploader_first,
         uGP.last_name        AS gate_pass_doc_uploader_last,
         doc.id AS return_doc_id, doc.document_name AS return_doc_name, doc.file_path AS return_doc_path,
         doc.document_type AS return_doc_type, doc.uploaded_at AS return_doc_uploaded_at,
         CONCAT(uDoc.first_name,' ',uDoc.last_name) AS return_doc_uploaded_by_name
       FROM asset_assignments  aa
       JOIN   assets           a    ON aa.asset_id             = a.id
       LEFT JOIN asset_types   at   ON a.asset_type_id         = at.id
       LEFT JOIN users         u1   ON aa.assigned_to          = u1.id
       LEFT JOIN users         u2   ON aa.assigned_by          = u2.id
       LEFT JOIN designations  d    ON u1.designation_id       = d.id
       LEFT JOIN departments   dept ON u1.department_id        = dept.id
       LEFT JOIN locations     l    ON aa.location_id          = l.id
       LEFT JOIN sub_locations sl   ON aa.sub_location_id      = sl.id
       LEFT JOIN documents     adoc  ON aa.assign_document_id   = adoc.id
       LEFT JOIN users         uAdoc ON adoc.uploaded_by        = uAdoc.id
       LEFT JOIN documents     gpdoc ON aa.gate_pass_document_id = gpdoc.id
       LEFT JOIN users         uGP   ON gpdoc.uploaded_by       = uGP.id
       LEFT JOIN documents     doc   ON aa.return_document_id   = doc.id
       LEFT JOIN users         uDoc  ON doc.uploaded_by         = uDoc.id
       WHERE aa.id=?`,
      [req.params.assignmentId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const row = rows[0];
    const isOverdue = row.status === 'Assigned' && row.expected_return_date && new Date(row.expected_return_date) < new Date();
    res.json({
      success: true,
      data: {
        ...row,
        assigned_to_name: row.user_first_name ? `${row.user_first_name} ${row.user_last_name}` : null,
        assigned_by_name: row.assigned_by_first_name ? `${row.assigned_by_first_name} ${row.assigned_by_last_name}` : null,
        display_status: isOverdue ? 'Overdue' : row.status,
        days_until_due: row.expected_return_date ? Math.ceil((new Date(row.expected_return_date) - new Date()) / 86400000) : null,
        assign_document: row.assign_doc_id ? {
          id: row.assign_doc_id,
          name: row.assign_doc_name,
          file_path: row.assign_doc_path,
          type: row.assign_doc_type,
          uploaded_at: row.assign_doc_uploaded_at,
          uploaded_by: row.assign_doc_uploader_first
            ? `${row.assign_doc_uploader_first} ${row.assign_doc_uploader_last}`
            : null,
        } : null,
        gate_pass_document: row.gate_pass_doc_id ? {
          id: row.gate_pass_doc_id,
          name: row.gate_pass_doc_name,
          file_path: row.gate_pass_doc_path,
          type: row.gate_pass_doc_type,
          uploaded_at: row.gate_pass_doc_uploaded_at,
          uploaded_by: row.gate_pass_doc_uploader_first
            ? `${row.gate_pass_doc_uploader_first} ${row.gate_pass_doc_uploader_last}`
            : null,
        } : null,
        return_document: row.return_doc_id ? {
          id: row.return_doc_id,
          name: row.return_doc_name,
          file_path: row.return_doc_path,
          type: row.return_doc_type,
          uploaded_at: row.return_doc_uploaded_at,
          uploaded_by: row.return_doc_uploaded_by_name,
        } : null,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET ASSET ASSIGNMENT HISTORY ───────────────────────
exports.getAssetAssignmentHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         aa.*,
         CONCAT(u1.first_name,' ',u1.last_name) AS assigned_to_name,
         CONCAT(u2.first_name,' ',u2.last_name) AS assigned_by_name,
         u1.email                               AS assigned_to_email,
         d.title AS designation_title, d.default_cia_confidentiality,
         d.default_cia_integrity, d.default_cia_availability, d.default_classification,
         l.location_name, l.address             AS location_address,
         sl.sub_location_name,
         sl.details                             AS sub_location_details,
         sl.address                             AS sub_location_address,
         adoc.id              AS assign_doc_id,
         adoc.document_name   AS assign_doc_name,
         adoc.file_path       AS assign_doc_path,
         adoc.uploaded_at     AS assign_doc_uploaded_at,
         gpdoc.id             AS gate_pass_doc_id,
         gpdoc.document_name  AS gate_pass_doc_name,
         gpdoc.file_path      AS gate_pass_doc_path,
         gpdoc.uploaded_at    AS gate_pass_doc_uploaded_at,
         doc.id               AS return_doc_id,
         doc.document_name    AS return_doc_name,
         doc.file_path        AS return_doc_path,
         doc.uploaded_at      AS return_doc_uploaded_at
       FROM asset_assignments  aa
       LEFT JOIN users         u1    ON aa.assigned_to           = u1.id
       LEFT JOIN users         u2    ON aa.assigned_by           = u2.id
       LEFT JOIN designations  d     ON u1.designation_id        = d.id
       LEFT JOIN locations     l     ON aa.location_id           = l.id
       LEFT JOIN sub_locations sl    ON aa.sub_location_id       = sl.id
       LEFT JOIN documents     adoc  ON aa.assign_document_id    = adoc.id
       LEFT JOIN documents     gpdoc ON aa.gate_pass_document_id = gpdoc.id
       LEFT JOIN documents     doc   ON aa.return_document_id    = doc.id
       WHERE aa.asset_id=? ORDER BY aa.assignment_date DESC`,
      [req.params.assetId]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET MY ASSIGNMENTS ──────────────────────────────────
exports.getCurrentAssignmentsForUser = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         aa.*, a.asset_no, a.name, a.category,
         at.name             AS asset_type,
         a.cia_confidentiality, a.cia_integrity, a.cia_availability, a.classification,
         l.location_name, l.address       AS location_address,
         sl.sub_location_name,
         sl.details                       AS sub_location_details,
         sl.address                       AS sub_location_address,
         adoc.id            AS assign_doc_id,
         adoc.document_name AS assign_doc_name,
         adoc.file_path     AS assign_doc_path,
         adoc.uploaded_at   AS assign_doc_uploaded_at
       FROM asset_assignments  aa
       JOIN   assets           a    ON aa.asset_id          = a.id
       LEFT JOIN asset_types   at   ON a.asset_type_id      = at.id
       LEFT JOIN locations     l    ON aa.location_id       = l.id
       LEFT JOIN sub_locations sl   ON aa.sub_location_id   = sl.id
       LEFT JOIN documents     adoc ON aa.assign_document_id = adoc.id
       WHERE aa.assigned_to=? AND aa.status='Assigned'
       ORDER BY aa.assignment_date DESC`,
      [req.user.id]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── MARK OVERDUE ────────────────────────────────────────
exports.markAssignmentOverdue = async (req, res) => {
  try {
    const [result] = await db.query(
      "UPDATE asset_assignments SET status='Overdue', updated_at=NOW() WHERE status='Assigned' AND expected_return_date IS NOT NULL AND expected_return_date < ?",
      [new Date().toISOString().split('T')[0]]
    );
    res.json({ success: true, message: `${result.affectedRows} assignment(s) marked as Overdue`, affectedRows: result.affectedRows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── BULK ASSIGN ASSETS ──────────────────────────────────
// POST /assignments/assets/bulk-assign
exports.bulkAssignAssets = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      asset_ids, assigned_to, assigned_to_department, assigned_to_designation,
      expected_return_date, condition_out, location_id, sub_location_id,
    } = req.body;

    if (!Array.isArray(asset_ids) || !asset_ids.length)
      return res.status(400).json({ success: false, message: 'asset_ids array is required' });
    if (!assigned_to && !assigned_to_department && !assigned_to_designation)
      return res.status(400).json({ success: false, message: 'At least one assignee is required' });

    if (location_id) {
      const [loc] = await conn.query('SELECT id FROM locations WHERE id=?', [location_id]);
      if (!loc.length) return res.status(400).json({ success: false, message: 'Location not found' });
    }
    if (sub_location_id) {
      const [sl] = await conn.query('SELECT id FROM sub_locations WHERE id=? AND location_id=?', [sub_location_id, location_id]);
      if (!sl.length) return res.status(400).json({ success: false, message: 'Sub-location not found or does not belong to selected location' });
    }

    const [assets] = await conn.query(
      `SELECT a.id, a.name, a.asset_no, a.category, at.name AS asset_type, a.status
       FROM assets a LEFT JOIN asset_types at ON a.asset_type_id=at.id WHERE a.id IN (?)`,
      [asset_ids]
    );
    const notFound = asset_ids.filter(id => !assets.find(a => a.id === id));
    if (notFound.length) throw new Error(`Assets not found: ${notFound.join(', ')}`);
    const unavailable = assets.filter(a => a.status !== 'Available');
    if (unavailable.length) throw new Error(`Not available for assignment: ${unavailable.map(a => a.name).join(', ')}`);

    const resolvedDesignationId = assigned_to_designation || (assigned_to ? await getUserDesignationId(conn, assigned_to) : null);
    const ciaData = await resolveCIAFromDesignation(conn, resolvedDesignationId);
    const date = new Date().toISOString().split('T')[0];
    const results = [];

    for (const assetId of asset_ids) {
      const [r] = await conn.query(
        `INSERT INTO asset_assignments
           (asset_id, assigned_to, assigned_by, assignment_date, expected_return_date,
            condition_out, location_id, sub_location_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Assigned')`,
        [assetId, assigned_to || null, req.user.id, date, expected_return_date || null,
          condition_out || null, location_id || null, sub_location_id || null]
      );
      await conn.query("UPDATE assets SET status='In Use', updated_at=NOW() WHERE id=?", [assetId]);
      if (ciaData) await applyAssetCIA(conn, assetId, ciaData);
      await logHistory(conn, assetId, req.user.id, ciaData ? 'CIA_AUTO_UPDATE' : 'ASSIGNED', {
        assignment_id: r.insertId,
        assigned_to_user: assigned_to || null,
        assigned_to_dept: assigned_to_department || null,
        assigned_to_desig: assigned_to_designation || null,
        location_id: location_id || null,
        sub_location_id: sub_location_id || null,
      });
      const a = assets.find(x => x.id === assetId);
      results.push({
        assignmentId: r.insertId, assetId,
        assetName: a?.name, assetNo: a?.asset_no, category: a?.category, asset_type: a?.asset_type,
        location_id: location_id || null, sub_location_id: sub_location_id || null,
      });
    }

    await conn.commit();
    res.status(201).json({
      success: true,
      message: `${asset_ids.length} asset(s) assigned successfully`,
      assignments: results,
      ciaUpdated: !!ciaData,
      ciaSource: ciaData ? `Designation: ${ciaData.title}` : null,
      newCIA: ciaData ? {
        confidentiality: ciaData.default_cia_confidentiality,
        integrity: ciaData.default_cia_integrity,
        availability: ciaData.default_cia_availability,
        classification: ciaData.default_classification,
      } : null,
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ─── BULK RETURN ASSETS ──────────────────────────────────
// POST /assignments/assets/bulk-return
exports.bulkReturnAssets = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { assignment_ids, condition_in, actual_return_date = new Date().toISOString().split('T')[0] } = req.body;

    if (!Array.isArray(assignment_ids) || !assignment_ids.length)
      return res.status(400).json({ success: false, message: 'assignment_ids array is required' });

    const [assignments] = await conn.query(
      `SELECT aa.id, aa.asset_id, aa.status, a.name AS asset_name, a.asset_no,
              CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name
       FROM asset_assignments aa
       JOIN assets a ON aa.asset_id=a.id
       LEFT JOIN users u ON aa.assigned_to=u.id
       WHERE aa.id IN (?)`,
      [assignment_ids]
    );
    const notFound = assignment_ids.filter(id => !assignments.find(a => a.id === id));
    if (notFound.length) throw new Error(`Assignments not found: ${notFound.join(', ')}`);
    const notAssigned = assignments.filter(a => a.status !== 'Assigned');
    if (notAssigned.length) throw new Error(`Cannot return — not in Assigned status: ${notAssigned.map(a => a.asset_name).join(', ')}`);

    const results = [];
    for (const assign of assignments) {
      await conn.query(
        "UPDATE asset_assignments SET actual_return_date=?, condition_in=?, status='Returned', updated_at=NOW() WHERE id=?",
        [actual_return_date, condition_in || null, assign.id]
      );
      await conn.query("UPDATE assets SET status='Available', updated_at=NOW() WHERE id=?", [assign.asset_id]);
      await logHistory(conn, assign.asset_id, req.user.id, 'RETURNED', {
        reason: 'Bulk return — CIA levels unchanged', assignment_id: assign.id,
        returned_by: req.user.id, condition_in: condition_in || null,
      });
      results.push({ assignmentId: assign.id, assetId: assign.asset_id, assetName: assign.asset_name, assetNo: assign.asset_no, awaitingSignedDoc: true });
    }
    await conn.commit();
    res.json({ success: true, message: `${assignment_ids.length} asset(s) returned successfully`, returned: results });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

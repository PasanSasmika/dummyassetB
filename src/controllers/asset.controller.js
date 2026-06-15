const db = require('../config/db');
// const clickhouse = require('../config/clickhouse');

const CATEGORY_PREFIXES = {
  'Human': 'HUM',
  'IT Infrastructure': 'ITI',
  'Service': 'SRV',
  'Digital': 'DIG',
  'Tangible Information': 'TAN',
  'End User': 'END',
  'Facility': 'FAC',
};

const CATEGORY_TABLE_MAP = {
  'IT Infrastructure': {
    table: 'asset_it_infrastructure',
    fields: 'manufacturer, model, serial_number, ip_address, mac_address',
  },
  'Human': {
    table: 'asset_human',
    fields: 'designation_id, department_id, assigned_employee_id',
  },
  'Service': {
    table: 'asset_service',
    fields: 'provider_name, contact_person, sla_document_ref, expiry_date',
  },
  'Digital': {
    table: 'asset_digital',
    fields: 'version_number, license_key, digital_storage_path, encryption_algorithm',
  },
  'Tangible Information': {
    table: 'asset_tangible_info',
    fields: 'document_type, storage_safes_location, retention_period_days',
  },
  'End User': {
    table: 'asset_end_user',
    fields: 'device_type, brand, model, date_of_purchase, serial_number, `condition`',
  },
  'Facility': {
    table: 'asset_facility',
    fields: 'facility_type, building_name, floor_level, capacity',
  },
};

// ─────────────────────────────────────────────────────────
// Category Permission Rules
// ─────────────────────────────────────────────────────────

// Categories that can have Financial fields (cost, po_number, financial_type, currency)
const FINANCIAL_CATEGORIES = ['IT Infrastructure', 'End User', 'Service', 'Digital'];

// Categories that support warranties
const WARRANTY_CATEGORIES = ['IT Infrastructure', 'End User', 'Facility', 'Digital', 'Service'];

// Categories that support Support Documents
const SUPPORT_DOC_CATEGORIES = ['IT Infrastructure', 'End User', 'Service', 'Digital', 'Tangible Information', 'Facility'];

// Categories that have a Status field (Human & Tangible Info are excluded)
const STATUS_CATEGORIES = ['IT Infrastructure', 'End User', 'Service', 'Digital', 'Facility'];

// ─────────────────────────────────────────────────────────
// Helper: strip financial fields for restricted categories
// ─────────────────────────────────────────────────────────
function resolveFinancialFields(category, body) {
  if (!FINANCIAL_CATEGORIES.includes(category)) {
    return {
      financial_type: 'None',
      po_number: null,
      cost: 0,
      net_value: 0,
      currency: 'USD',
    };
  }
  return {
    financial_type: body.financial_type || 'None',
    po_number: body.po_number || null,
    cost: body.cost || 0,
    net_value: body.net_value || 0,
    currency: body.currency || 'USD',
  };
}

// ─────────────────────────────────────────────────────────
// Helper: resolve status (Human & Tangible Info → always 'Available', locked)
// ─────────────────────────────────────────────────────────
function resolveStatus(category, requestedStatus) {
  if (!STATUS_CATEGORIES.includes(category)) return 'Available';
  return requestedStatus || 'Available';
}

// ─────────────────────────────────────────────────────────
// Helper: insert warranty document and return its id
// ─────────────────────────────────────────────────────────
async function insertWarrantyDocument(connection, { warrantyId, file, document_type, uploaded_by }) {
  if (!file) return null;
  const document_name = file.originalname;
  const file_path = file.path.replace(/\\/g, '/');
  const [docResult] = await connection.query(
    `INSERT INTO documents
       (entity_type, entity_id, document_type, document_name, file_path, uploaded_by)
     VALUES ('Warranty', ?, ?, ?, ?, ?)`,
    [warrantyId, document_type || 'Warranty', document_name, file_path, uploaded_by]
  );
  return docResult.insertId;
}

// ─────────────────────────────────────────────────────────
// Helper: insert support document and return its id
// ─────────────────────────────────────────────────────────
async function insertSupportDocument(connection, { assetId, file, document_type, uploaded_by }) {
  if (!file) return null;
  const document_name = file.originalname;
  const file_path = file.path.replace(/\\/g, '/');
  const [docResult] = await connection.query(
    `INSERT INTO documents
       (entity_type, entity_id, document_type, document_name, file_path, uploaded_by)
     VALUES ('Asset', ?, ?, ?, ?, ?)`,
    [assetId, document_type || 'Other', document_name, file_path, uploaded_by]
  );
  return docResult.insertId;
}

// ─────────────────────────────────────────────────────────
// POST /api/assets
// ─────────────────────────────────────────────────────────
exports.createAsset = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      name, category,
      asset_type_id,
      description,

      asset_owner_user_id,
      asset_owner_designation_id,
      asset_custodian_user_id,
      asset_custodian_designation_id,

      cia_confidentiality = 1, cia_integrity = 1, cia_availability = 1,
      asset_value, classification, color_code,

      location_id, sub_location_id,
      remarks,

      support_document_type,

      // Category-specific fields
      manufacturer, model, serial_number, ip_address, mac_address,
      designation_id, department_id, assigned_employee_id,
      provider_name, contact_person, sla_document_ref, expiry_date,
      version_number, license_key, digital_storage_path, encryption_algorithm,
      document_type, storage_safes_location, retention_period_days,
      device_type, brand, date_of_purchase, condition,
      facility_type, building_name, floor_level, capacity,

      // Warranty fields
      warranty_provider_name,
      warranty_period_months,
      warranty_start_date,
      warranty_end_date,
      warranty_coverage_details,
      warranty_document_type,
    } = req.body;

    if (!name || !category) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'name and category are required' });
    }

    // ── Resolve category-restricted fields ───────────────
    const financial = resolveFinancialFields(category, req.body);
    const status = resolveStatus(category, req.body.status);

    const prefix = CATEGORY_PREFIXES[category] || 'AST';
    const asset_no = `${prefix}-${Date.now().toString().slice(-6)}`;

    // ── 1. Insert core asset row ──────────────────────────
    const [result] = await connection.query(
      `INSERT INTO assets (
        asset_no, name, category, asset_type_id, description,
        asset_owner_user_id, asset_owner_designation_id,
        asset_custodian_user_id, asset_custodian_designation_id,
        cia_confidentiality, cia_integrity, cia_availability,
        asset_value, classification, color_code,
        financial_type, po_number, cost, currency,
        location_id, sub_location_id,
        remarks, status, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        asset_no, name.trim(), category,
        asset_type_id || null,
        description || null,
        asset_owner_user_id || null,
        asset_owner_designation_id || null,
        // Human assets have no custodian concept — force null
        category === 'Human' ? null : (asset_custodian_user_id || null),
        category === 'Human' ? null : (asset_custodian_designation_id || null),
        cia_confidentiality, cia_integrity, cia_availability,
        asset_value || null,
        classification || null,
        color_code || null,
        financial.financial_type,
        financial.po_number,
        financial.cost,
        financial.currency,
        // Human assets don't need location
        category === 'Human' ? null : (location_id || null),
        category === 'Human' ? null : (sub_location_id || null),
        remarks || null,
        status,
        req.user.id,
      ]
    );

    const assetId = result.insertId;

    // ── 2. Support document upload (skip for Human) ───────
    let supportDocumentId = null;
    if (req.file && SUPPORT_DOC_CATEGORIES.includes(category)) {
      supportDocumentId = await insertSupportDocument(connection, {
        assetId,
        file: req.file,
        document_type: support_document_type || 'Other',
        uploaded_by: req.user.id,
      });
      await connection.query(
        'UPDATE assets SET support_document_id = ? WHERE id = ?',
        [supportDocumentId, assetId]
      );
    }

    // ── 3. Category-specific sub-table insert ─────────────
    if (category === 'IT Infrastructure') {
      await connection.query(
        `INSERT INTO asset_it_infrastructure
           (asset_id, manufacturer, model, serial_number, ip_address, mac_address)
         VALUES (?,?,?,?,?,?)`,
        [assetId, manufacturer || null, model || null, serial_number || null, ip_address || null, mac_address || null]
      );

    } else if (category === 'Human') {
      await connection.query(
        `INSERT INTO asset_human (asset_id, designation_id, department_id, assigned_employee_id)
         VALUES (?,?,?,?)`,
        [assetId, designation_id || null, department_id || null, assigned_employee_id || null]
      );

    } else if (category === 'Service') {
      await connection.query(
        `INSERT INTO asset_service
           (asset_id, provider_name, contact_person, sla_document_ref, expiry_date)
         VALUES (?,?,?,?,?)`,
        [assetId, provider_name || null, contact_person || null, sla_document_ref || null, expiry_date || null]
      );

    } else if (category === 'Digital') {
      await connection.query(
        `INSERT INTO asset_digital
           (asset_id, version_number, license_key, digital_storage_path, encryption_algorithm)
         VALUES (?,?,?,?,?)`,
        [assetId, version_number || null, license_key || null, digital_storage_path || null, encryption_algorithm || null]
      );

    } else if (category === 'Tangible Information') {
      await connection.query(
        `INSERT INTO asset_tangible_info
           (asset_id, document_type, storage_safes_location, retention_period_days)
         VALUES (?,?,?,?)`,
        [assetId, document_type || null, storage_safes_location || null, retention_period_days || null]
      );

    } else if (category === 'End User') {
      await connection.query(
        `INSERT INTO asset_end_user
           (asset_id, device_type, brand, model, date_of_purchase, serial_number, \`condition\`)
         VALUES (?,?,?,?,?,?,?)`,
        [assetId, device_type || null, brand || null, model || null, date_of_purchase || null, serial_number || null, condition || null]
      );

    } else if (category === 'Facility') {
      await connection.query(
        `INSERT INTO asset_facility
           (asset_id, facility_type, building_name, floor_level, capacity)
         VALUES (?,?,?,?,?)`,
        [assetId, facility_type || null, building_name || null, floor_level || null, capacity || null]
      );
    }

    // ── 4. Warranty insert (only for allowed categories) ──
    let warrantyId = null;
    if (
      WARRANTY_CATEGORIES.includes(category) &&
      warranty_provider_name &&
      warranty_start_date &&
      warranty_end_date
    ) {
      let period = warranty_period_months;
      if (!period) {
        const start = new Date(warranty_start_date);
        const end = new Date(warranty_end_date);
        period = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
      }

      const [wResult] = await connection.query(
        `INSERT INTO asset_warranties
           (asset_id, provider_name, warranty_period_months, start_date, end_date, coverage_details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [assetId, warranty_provider_name, period, warranty_start_date, warranty_end_date, warranty_coverage_details || null]
      );
      warrantyId = wResult.insertId;

      if (req.files?.warranty_document?.[0]) {
        await insertWarrantyDocument(connection, {
          warrantyId,
          file: req.files.warranty_document[0],
          document_type: warranty_document_type || 'Warranty',
          uploaded_by: req.user.id,
        });
      }
    }

    await connection.commit();

    // ── 5. ClickHouse analytics log ───────────────────────
    // try {
    //   await clickhouse.insert({
    //     table: 'analytics_logs',
    //     values: [{
    //       id: Date.now(),
    //       report_type: 'asset_created',
    //       generated_by: req.user.id,
    //       filters_used: JSON.stringify({ asset_no, category, name }),
    //       event_date: new Date().toISOString().slice(0, 10),
    //     }],
    //     format: 'JSONEachRow',
    //   });
    // } catch (chErr) {
    //   console.error('ClickHouse log failed:', chErr.message);
    // }

    return res.status(201).json({
      success: true,
      message: 'Asset created successfully',
      data: { id: assetId, asset_no, category, support_document_id: supportDocumentId, warranty_id: warrantyId },
    });

  } catch (error) {
    await connection.rollback();
    console.error('createAsset error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Asset number already exists, please try again' });
    }
    return res.status(500).json({ success: false, message: 'Failed to create asset', error: error.message });
  } finally {
    connection.release();
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets
// ─────────────────────────────────────────────────────────
exports.getAllAssets = async (req, res) => {
  try {
    const { search, category, status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const where = ['1=1'];
    const params = [];

    if (search) {
      where.push('(a.name LIKE ? OR a.asset_no LIKE ? OR l.location_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (category) { where.push('a.category = ?'); params.push(category); }
    if (status) { where.push('a.status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id
       WHERE ${whereClause}`,
      params
    );

    const [rows] = await db.query(
      `SELECT
         a.id, a.asset_no, a.name, a.category,
         a.asset_type_id,
         t.name                                      AS asset_type_name,
         a.status,
         l.location_name,
         sl.sub_location_name,
         a.cost, a.currency,
         a.classification, a.color_code, a.created_at,
         CONCAT(ou.first_name, ' ', ou.last_name)   AS owner_user_name,
         od.title                                    AS owner_designation_title,
         CONCAT(cu.first_name, ' ', cu.last_name)   AS custodian_user_name,
         cd.title                                    AS custodian_designation_title
       FROM assets a
       LEFT JOIN asset_types   t  ON t.id  = a.asset_type_id
       LEFT JOIN locations     l  ON l.id  = a.location_id
       LEFT JOIN sub_locations sl ON sl.id = a.sub_location_id
       LEFT JOIN users         ou ON ou.id = a.asset_owner_user_id
       LEFT JOIN designations  od ON od.id = a.asset_owner_designation_id
       LEFT JOIN users         cu ON cu.id = a.asset_custodian_user_id
       LEFT JOIN designations  cd ON cd.id = a.asset_custodian_designation_id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    return res.json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error('getAllAssets error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assets', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets/:id
// ─────────────────────────────────────────────────────────
exports.getAssetById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT
         a.*,
         t.name                                      AS asset_type_name,
         t.category                                  AS asset_type_category,
         l.location_name,
         l.address                                   AS location_address,
         sl.sub_location_name,
         sl.address                                  AS sub_location_address,
         CONCAT(ou.first_name, ' ', ou.last_name)   AS owner_user_name,
         od.title                                    AS owner_designation_title,
         CONCAT(cu.first_name, ' ', cu.last_name)   AS custodian_user_name,
         cd.title                                    AS custodian_designation_title,
         d.document_name                             AS support_document_name,
         d.file_path                                 AS support_document_path,
         d.document_type                             AS support_document_type
       FROM assets a
       LEFT JOIN asset_types   t  ON t.id  = a.asset_type_id
       LEFT JOIN locations     l  ON l.id  = a.location_id
       LEFT JOIN sub_locations sl ON sl.id = a.sub_location_id
       LEFT JOIN users         ou ON ou.id = a.asset_owner_user_id
       LEFT JOIN designations  od ON od.id = a.asset_owner_designation_id
       LEFT JOIN users         cu ON cu.id = a.asset_custodian_user_id
       LEFT JOIN designations  cd ON cd.id = a.asset_custodian_designation_id
       LEFT JOIN documents     d  ON d.id  = a.support_document_id
       WHERE a.id = ?`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Asset not found' });

    const asset = rows[0];

    let categoryDetails = null;
    const cfg = CATEGORY_TABLE_MAP[asset.category];
    if (cfg) {
      const [catRows] = await db.query(
        `SELECT ${cfg.fields} FROM ${cfg.table} WHERE asset_id = ?`, [id]
      );
      categoryDetails = catRows[0] || null;
    }

    // Only fetch warranties for allowed categories
    let warranties = [];
    if (WARRANTY_CATEGORIES.includes(asset.category)) {
      const [wRows] = await db.query(
        `SELECT
           id, provider_name, warranty_period_months,
           start_date, end_date, coverage_details, created_at,
           CASE WHEN end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS warranty_status,
           DATEDIFF(end_date, CURDATE()) AS days_remaining
         FROM asset_warranties
         WHERE asset_id = ?
         ORDER BY end_date DESC`,
        [id]
      );
      warranties = wRows;
    }

    // Attach permission flags so frontend knows what to show
    const permissions = {
      hasFinancial: FINANCIAL_CATEGORIES.includes(asset.category),
      hasWarranty: WARRANTY_CATEGORIES.includes(asset.category),
      hasSupportDoc: SUPPORT_DOC_CATEGORIES.includes(asset.category),
      hasStatus: STATUS_CATEGORIES.includes(asset.category),
      hasCustodian: asset.category !== 'Human',
      hasLocation: asset.category !== 'Human',
    };

    return res.json({
      success: true,
      data: { ...asset, category_details: categoryDetails, warranties, permissions },
    });
  } catch (error) {
    console.error('getAssetById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch asset', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /api/assets/:id
// ─────────────────────────────────────────────────────────

exports.updateAsset = async (req, res) => {
  try {
    const { id } = req.params;
    
    // FIX: Add fallback to prevent crash if multer isn't parsing the FormData
    const body = req.body || {}; 

    const [[existing]] = await db.query('SELECT category FROM assets WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Asset not found' });

    const { category } = existing;

    let ALLOWED = [
      'name', 'description',
      'asset_owner_user_id', 'asset_owner_designation_id',
      'asset_type_id',
      'remarks',
      'cia_confidentiality', 'cia_integrity', 'cia_availability',
      'asset_value', 'classification', 'color_code',
    ];

    if (STATUS_CATEGORIES.includes(category)) {
      ALLOWED.push('status');
    }

    if (category !== 'Human') {
      ALLOWED.push('location_id', 'sub_location_id');
      ALLOWED.push('asset_custodian_user_id', 'asset_custodian_designation_id');
    }

    if (FINANCIAL_CATEGORIES.includes(category)) {
      ALLOWED.push('cost', 'currency', 'po_number', 'financial_type', 'net_value');
    }

    const updates = [];
    const values = [];

    // Safely iterate over the body
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update. Please ensure your PATCH route uses multer.' });
    }

    values.push(id);
    await db.query(
      `UPDATE assets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    return res.json({ success: true, message: 'Asset updated successfully' });
  } catch (error) {
    console.error('updateAsset error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update asset', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// DELETE /api/assets/:id
// ─────────────────────────────────────────────────────────
exports.deleteAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM assets WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    return res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete asset', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets/category/:category
// ─────────────────────────────────────────────────────────
exports.getAssetsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const [rows] = await db.query(
      `SELECT
         a.id, a.asset_no, a.name, a.category,
         a.asset_type_id,
         t.name             AS asset_type_name,
         a.status,
         l.location_name,
         sl.sub_location_name,
         a.cost, a.currency, a.classification
       FROM assets a
       LEFT JOIN asset_types   t  ON t.id  = a.asset_type_id
       LEFT JOIN locations     l  ON l.id  = a.location_id
       LEFT JOIN sub_locations sl ON sl.id = a.sub_location_id
       WHERE a.category = ?
       ORDER BY a.name ASC`,
      [category]
    );
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch assets by category', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /api/assets/:id/cia-classification
// ─────────────────────────────────────────────────────────
exports.updateAssetCIA = async (req, res) => {
  try {
    const { id } = req.params;
    const { cia_confidentiality, cia_integrity, cia_availability, classification, color_code, asset_value } = req.body;

    const updates = []; const values = [];
    if (cia_confidentiality !== undefined) { updates.push('cia_confidentiality = ?'); values.push(cia_confidentiality); }
    if (cia_integrity !== undefined) { updates.push('cia_integrity = ?'); values.push(cia_integrity); }
    if (cia_availability !== undefined) { updates.push('cia_availability = ?'); values.push(cia_availability); }
    if (classification !== undefined) { updates.push('classification = ?'); values.push(classification); }
    if (color_code !== undefined) { updates.push('color_code = ?'); values.push(color_code); }
    if (asset_value !== undefined) { updates.push('asset_value = ?'); values.push(asset_value); }

    if (!updates.length) {
      return res.status(400).json({ success: false, message: 'At least one CIA field required' });
    }

    values.push(id);
    const [result] = await db.query(
      `UPDATE assets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, values
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    return res.json({ success: true, message: 'CIA classification updated' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update CIA', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// POST /api/assets/:id/assign
// ─────────────────────────────────────────────────────────
exports.assignAssetToUser = async (req, res) => {
  try {
    const { id: assetId } = req.params;
    const { assigned_to, expected_return_date, condition_out } = req.body;

    if (!assigned_to) {
      return res.status(400).json({ success: false, message: 'assigned_to (user id) is required' });
    }

    const [[asset]] = await db.query('SELECT status, category FROM assets WHERE id = ?', [assetId]);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

    if (asset.category === 'Human') {
      return res.status(400).json({ success: false, message: 'Human assets cannot be assigned via this endpoint' });
    }

    if (asset.status !== 'Available') {
      return res.status(400).json({ success: false, message: 'Asset is not available for assignment' });
    }

    const [result] = await db.query(
      `INSERT INTO asset_assignments
         (asset_id, assigned_to, assigned_by, assignment_date, expected_return_date, condition_out, status)
       VALUES (?, ?, ?, CURDATE(), ?, ?, 'Assigned')`,
      [assetId, assigned_to, req.user.id, expected_return_date || null, condition_out || null]
    );

    await db.query("UPDATE assets SET status = 'In Use', updated_at = NOW() WHERE id = ?", [assetId]);

    return res.status(201).json({
      success: true,
      message: 'Asset assigned successfully',
      assignmentId: result.insertId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to assign asset', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets/:id/history
// ─────────────────────────────────────────────────────────
exports.getAssetHistory = async (req, res) => {
  try {
    const { id: assetId } = req.params;

    const [rows] = await db.query(
      `SELECT
         ah.*,
         CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
       FROM asset_history ah
       LEFT JOIN users u ON ah.changed_by = u.id
       WHERE ah.asset_id = ?
       ORDER BY ah.created_at DESC`,
      [assetId]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch asset history',
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets/my-assets
// ─────────────────────────────────────────────────────────
exports.getMyAssets = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         a.id, a.asset_no, a.name, a.category,
         a.asset_type_id,
         t.name             AS asset_type_name,
         a.status,
         l.location_name,
         sl.sub_location_name,
         aa.assignment_date, aa.expected_return_date, aa.condition_out
       FROM assets a
       JOIN asset_assignments aa ON a.id = aa.asset_id
       LEFT JOIN asset_types   t  ON t.id  = a.asset_type_id
       LEFT JOIN locations     l  ON l.id  = a.location_id
       LEFT JOIN sub_locations sl ON sl.id = a.sub_location_id
       WHERE aa.assigned_to = ? AND aa.status = 'Assigned'
       ORDER BY aa.assignment_date DESC`,
      [req.user.id]
    );
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch your assets', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// POST /api/assets/bulk  (End User only)
// ─────────────────────────────────────────────────────────
exports.bulkCreateAssets = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { assets } = req.body;
    if (!Array.isArray(assets) || !assets.length) {
      return res.status(400).json({ success: false, message: 'No assets provided' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      const { asset: a, endUser: eu } = assets[i];
      try {
        const asset_no = a.asset_no || `END-${Date.now().toString().slice(-6)}-${i}`;

        const [result] = await connection.query(
          `INSERT INTO assets
             (asset_no, name, category, asset_type_id, status,
              location_id, sub_location_id,
              asset_owner_user_id, asset_owner_designation_id,
              cost, currency, financial_type, po_number,
              description, remarks,
              cia_confidentiality, cia_integrity, cia_availability,
              asset_value, classification, created_by)
           VALUES (?, ?, 'End User', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            asset_no, a.name,
            a.asset_type_id || null,
            a.status || 'Available',
            a.location_id || null,
            a.sub_location_id || null,
            a.asset_owner_user_id || null,
            a.asset_owner_designation_id || null,
            a.cost || null,
            a.currency || 'USD',
            a.financial_type || 'None',
            a.po_number || null,
            a.description || null,
            a.remarks || null,
            a.cia_confidentiality ?? 1,
            a.cia_integrity ?? 1,
            a.cia_availability ?? 1,
            a.asset_value ?? 1,
            a.classification || 'Low',
            req.user.id,
          ]
        );

        const assetId = result.insertId;

        await connection.query(
          `INSERT INTO asset_end_user
             (asset_id, device_type, brand, model, date_of_purchase, serial_number, \`condition\`)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [assetId, eu?.device_type || null, eu?.brand || null, eu?.model || null, eu?.date_of_purchase || null, eu?.serial_number || null, eu?.condition || null]
        );

        created.push(assetId);
      } catch (err) {
        errors.push({ row: i + 1, name: assets[i]?.asset?.name || '—', error: err.message });
      }
    }

    if (created.length === 0) {
      await connection.rollback();
    } else {
      await connection.commit();
    }

    // try {
    //   await clickhouse.insert({
    //     table: 'analytics_logs',
    //     values: [{
    //       id: Date.now(),
    //       report_type: 'bulk_asset_created',
    //       generated_by: req.user.id,
    //       filters_used: JSON.stringify({ category: 'End User', count: created.length }),
    //       event_date: new Date().toISOString().slice(0, 10),
    //     }],
    //     format: 'JSONEachRow',
    //   });
    // } catch (chErr) {
    //   console.error('ClickHouse log failed:', chErr.message);
    // }

    return res.status(201).json({
      success: true,
      created: created.length,
      errors,
      message: `${created.length} End User asset(s) created successfully`,
    });
  } catch (error) {
    await connection.rollback();
    console.error('bulkCreateAssets error:', error);
    return res.status(500).json({ success: false, message: 'Bulk import failed', error: error.message });
  } finally {
    connection.release();
  }
};



exports.getGlobalAssetLifecycle = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (a.name LIKE ? OR a.asset_no LIKE ? OR u.first_name LIKE ?)';
      const likeSearch = `%${search}%`;
      params.push(likeSearch, likeSearch, likeSearch);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM asset_history ah 
       LEFT JOIN assets a ON ah.asset_id = a.id 
       LEFT JOIN users u ON ah.changed_by = u.id WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT ah.*, 
              DATE_ADD(ah.created_at, INTERVAL '5:30' HOUR_MINUTE) AS created_at,
              a.name AS asset_name, a.asset_no, a.category, 
              CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
       FROM asset_history ah
       LEFT JOIN assets a ON ah.asset_id = a.id
       LEFT JOIN users u ON ah.changed_by = u.id
       WHERE ${where}
       ORDER BY ah.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ success: true, total, totalPages: Math.ceil(total / Number(limit)), page: Number(page), data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch global asset history', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────
// GET /api/assets/global/assignments (Global Assignment Log)
// ─────────────────────────────────────────────────────────
exports.getGlobalAssignmentLog = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (a.name LIKE ? OR a.asset_no LIKE ? OR u1.first_name LIKE ?)';
      const likeSearch = `%${search}%`;
      params.push(likeSearch, likeSearch, likeSearch);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM asset_assignments aa 
       LEFT JOIN assets a ON aa.asset_id = a.id 
       LEFT JOIN users u1 ON aa.assigned_to = u1.id WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT aa.*, 
              DATE_ADD(aa.assignment_date, INTERVAL '5:30' HOUR_MINUTE) AS assignment_date,
              a.name AS asset_name, a.asset_no, 
              CONCAT(u1.first_name, ' ', u1.last_name) AS assigned_to_name,
              CONCAT(u2.first_name, ' ', u2.last_name) AS assigned_by_name
       FROM asset_assignments aa
       LEFT JOIN assets a ON aa.asset_id = a.id
       LEFT JOIN users u1 ON aa.assigned_to = u1.id
       LEFT JOIN users u2 ON aa.assigned_by = u2.id
       WHERE ${where}
       ORDER BY aa.assignment_date DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ success: true, total, totalPages: Math.ceil(total / Number(limit)), page: Number(page), data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch global assignment log', error: error.message });
  }
};
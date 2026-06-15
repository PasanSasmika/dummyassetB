const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const MIGRATION_KEY = 'migration-admin-key-vogue';
const DB_NAME = process.env.DB_NAME || 'asset_management_db';
const SQL_DIR = path.join(__dirname, '..', 'migrations', 'sql');

function getMigrationFiles() {
  return fs.readdirSync(SQL_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

async function getConnection() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'mysql',
    database: DB_NAME,
    multipleStatements: true,
  });
  return conn;
}

function authGuard(req, res, next) {
  if (req.headers['x-migration-key'] !== MIGRATION_KEY) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
}

// GET /api/migration/status
router.get('/status', authGuard, async (req, res) => {
  let conn;
  try {
    conn = await getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT NOT NULL AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [rows] = await conn.query(
      'SELECT filename, applied_at FROM schema_migrations ORDER BY id'
    );
    const files = getMigrationFiles();
    const appliedSet = new Set(rows.map(r => r.filename));
    const appliedMap = Object.fromEntries(rows.map(r => [r.filename, r.applied_at]));

    const applied = [];
    const pending = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        applied.push({ filename: file, applied_at: appliedMap[file] });
      } else {
        pending.push({ filename: file });
      }
    }

    res.json({ success: true, applied, pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

// GET /api/migration/test-connection
router.get('/test-connection', authGuard, async (req, res) => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || 'mysql',
    });
    await conn.query('SELECT 1');
    const [dbRows] = await conn.query(
      `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [DB_NAME]
    );
    const dbExists = dbRows.length > 0;
    res.json({
      success: true,
      message: 'Connection successful.',
      details: {
        host:      process.env.DB_HOST || 'localhost',
        user:      process.env.DB_USER || 'root',
        database:  DB_NAME,
        db_exists: dbExists,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Connection failed: ${err.message}` });
  } finally {
    if (conn) await conn.end();
  }
});

// POST /api/migration/seed
router.post('/seed', authGuard, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const logs   = [];
  let conn;
  try {
    conn = await getConnection();

    // Roles
    await conn.query(`
      INSERT IGNORE INTO roles (name) VALUES
      ('Admin'), ('Manager'), ('Employee'), ('Engineer'), ('Operator'), ('Reporter'), ('User')
    `);
    logs.push('✓ Core roles seeded.');

    // Admin user
    const [existingAdmin] = await conn.query('SELECT id FROM users WHERE email = ?', ['admin@vogue.com']);
    let adminId;
    if (existingAdmin.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      const [r] = await conn.query(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['admin', 'admin@vogue.com', hash, 'System', 'Admin', 'Active']
      );
      adminId = r.insertId;
      logs.push('✓ Admin user created (admin@vogue.com / admin123).');
    } else {
      adminId = existingAdmin[0].id;
      logs.push('~ Admin user already exists, skipped.');
    }
    const [adminRole] = await conn.query(`SELECT id FROM roles WHERE name = 'Admin'`);
    if (adminRole.length) {
      await conn.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [adminId, adminRole[0].id]);
    }

    // Employee user
    const [existingEmp] = await conn.query('SELECT id FROM users WHERE email = ?', ['employee@vogue.com']);
    let empId;
    if (existingEmp.length === 0) {
      const hash = await bcrypt.hash('employee123', 12);
      const [r] = await conn.query(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['employee', 'employee@vogue.com', hash, 'Jane', 'Doe', 'Active']
      );
      empId = r.insertId;
      logs.push('✓ Employee user created (employee@vogue.com / employee123).');
    } else {
      empId = existingEmp[0].id;
      logs.push('~ Employee user already exists, skipped.');
    }
    const [empRole] = await conn.query(`SELECT id FROM roles WHERE name = 'Employee'`);
    if (empRole.length) {
      await conn.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [empId, empRole[0].id]);
    }

    logs.push('Seed completed successfully.');
    res.json({ success: true, logs });
  } catch (err) {
    logs.push(`✗ Error: ${err.message}`);
    res.status(500).json({ success: false, logs });
  } finally {
    if (conn) await conn.end();
  }
});

// POST /api/migration/run
router.post('/run', authGuard, async (req, res) => {
  let conn;
  const logs = [];

  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'mysql',
      multipleStatements: true,
    });

    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    await conn.query(`USE \`${DB_NAME}\``);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT NOT NULL AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [appliedRows] = await conn.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.filename));
    const files = getMigrationFiles();
    const pending = files.filter(f => !appliedSet.has(f));

    if (pending.length === 0) {
      return res.json({ success: true, logs: ['All migrations are already up to date.'] });
    }

    logs.push(`Found ${pending.length} pending migration(s).`);

    for (const file of pending) {
      try {
        const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
        await conn.query(sql);
        await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
        logs.push(`✓ ${file} — applied`);
      } catch (fileErr) {
        const alreadyExists =
          fileErr.code === 'ER_TABLE_EXISTS_ERROR' ||
          fileErr.code === 'ER_DUP_KEYNAME' ||
          (fileErr.message && fileErr.message.toLowerCase().includes('already exists'));

        if (alreadyExists) {
          await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
          logs.push(`~ ${file} — skipped (already exists, marked as applied)`);
        } else {
          logs.push(`✗ ${file} — FAILED: ${fileErr.message}`);
          return res.status(500).json({ success: false, logs });
        }
      }
    }

    logs.push('All migrations completed successfully.');
    res.json({ success: true, logs });
  } catch (err) {
    logs.push(`Error: ${err.message}`);
    res.status(500).json({ success: false, logs });
  } finally {
    if (conn) await conn.end();
  }
});

module.exports = router;

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'asset_management_db';
const SQL_DIR = path.join(__dirname, 'sql');

function getMigrationFiles() {
  return fs.readdirSync(SQL_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'mysql',
    multipleStatements: true,
  });

  try {
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

    if (process.argv.includes('--status')) {
      const [rows] = await conn.query(
        'SELECT filename, applied_at FROM schema_migrations ORDER BY id'
      );
      const files = getMigrationFiles();
      const appliedSet = new Set(rows.map(r => r.filename));
      console.log('\nMigration status:');
      for (const file of files) {
        const tag = appliedSet.has(file) ? '[applied]' : '[pending]';
        console.log(`  ${tag}  ${file}`);
      }
      return;
    }

    const [appliedRows] = await conn.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.filename));

    const files = getMigrationFiles();
    const pending = files.filter(f => !appliedSet.has(f));

    if (pending.length === 0) {
      console.log('All migrations are up to date.');
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)...`);

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
      process.stdout.write(`  -> ${file} ... `);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log('done');
    }

    console.log('\nAll migrations completed successfully.');
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();


// npm run migrate  
//         # run all pending migrations
//   npm run migrate:status   # show applied vs pending
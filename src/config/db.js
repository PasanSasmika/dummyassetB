require('dotenv').config(); // 👈 Moved to line 1 so variables load first
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10), 
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'mysql',
  database: process.env.DB_NAME || 'asset_management_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+05:30',
  dateStrings: true,
  multipleStatements: true,
});

pool.getConnection()
  .then(() => console.log('MySQL pool connected successfully'))
  .catch(err => console.error('MySQL pool connection failed:', err));

module.exports = pool;

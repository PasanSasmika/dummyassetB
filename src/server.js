require('dotenv').config();
const http = require('http');
const app = require('./app');
const cron = require('node-cron');
const db = require('./config/db');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

cron.schedule('0 0 1 */4 *', async () => {
  try {
    const [result] = await db.execute(
      `DELETE FROM asset_history WHERE created_at < DATE_SUB(NOW(), INTERVAL 4 MONTH)`
    );
    if (result.affectedRows > 0) {
      console.log(`[Audit Cleanup] Deleted ${result.affectedRows} logs older than 4 months.`);
    } else {
      console.log(`[Audit Cleanup] No old logs to delete.`);
    }
  } catch (error) {
    console.error('[Audit Cleanup] Error deleting old logs:', error);
  }
});

server.listen(PORT, () => {
  console.log(`───────────────────────────────────────────────`);
  console.log(`   Server running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`   Listening on port: ${PORT}`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`───────────────────────────────────────────────`);
});

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('Received shutdown signal. Closing server...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });


  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};


process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);   // Ctrl+C


process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION!  Shutting down...');
  console.error(err.name, err.message);
  server.close(() => process.exit(1));
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION!  Shutting down...');
  console.error(err);
  server.close(() => process.exit(1));
});

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

// Import routes
const departmentRoutes = require('./routes/department.routes');
const designationRoutes = require('./routes/designation.routes');
const userRoutes = require('./routes/user.routes');
const assetRoutes = require('./routes/asset.routes');
const authRoutes = require('./routes/auth.routes');
const assetAssignmentRoutes = require('./routes/asset-assignment.routes');
const ticketRoutes = require('./routes/ticket.routes');
const accessoryRoutes = require('./routes/accessory.routes');
const locationRoutes = require('./routes/location.routes');
const salvagedAssetRoutes = require('./routes/salvage.routes');
const repairRoutes = require('./routes/repair.routes');
const assettypeRoutes = require('./routes/assettype.routes');
const auditRoutes = require('./routes/audit.routes');
const migrationRoutes = require('./routes/migration.routes');
const sidebarAccessRoutes = require('./routes/sidebarAccess.routes');
const path = require('path');



const app = express();


app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}


app.get('/', (req, res) => {
  res.json({
    message: 'Asset Management API',
    status: 'running',
    version: '1.0.0'
  });
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/api/departments', departmentRoutes);
app.use('/api/designations', designationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/assignments', assetAssignmentRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/accessories', accessoryRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/salvage', salvagedAssetRoutes);
app.use('/api/repairs', repairRoutes);
app.use('/api/asset-types', assettypeRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/migration', migrationRoutes);
app.use('/api/sidebar-access', sidebarAccessRoutes);


app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});


app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = app;



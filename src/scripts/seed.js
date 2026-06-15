require('dotenv').config(); // Loads your .env variables so the DB connects
const db = require('../config/db'); // Points to your MySQL connection pool
const bcrypt = require('bcryptjs');

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seed process...');

    // 1. Insert Core Roles (INSERT IGNORE prevents duplicates if you run this twice)
    console.log('Injecting core roles...');
    await db.query(`
      INSERT IGNORE INTO roles (id, name) VALUES 
      (1, 'Admin'), 
      (2, 'Manager'), 
      (3, 'Employee')
    `);

    // 2. Check if the admin user already exists to prevent errors
    const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', ['admin@vogue.com']);
    let userId;

    if (existingUsers.length === 0) {
      console.log('Creating System Admin user...');
      
      const hashedPassword = await bcrypt.hash('admin123', 12);

      // Insert the user (Adjusting to match the columns you provided earlier)
      const [userResult] = await db.query(`
        INSERT INTO users (username, email, password_hash, first_name, last_name, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `, ['admin', 'admin@vogue.com', hashedPassword, 'System', 'Admin', 'Active']);
      
      userId = userResult.insertId;
    } else {
      console.log('Admin user already exists. Skipping user creation.');
      userId = existingUsers[0].id;
    }

    // 3. Link the Admin User to the Admin Role (Role ID: 1)
    console.log('Assigning Admin role to user...');
    await db.query(`
      INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)
    `, [userId, 1]);

    // Mark seed admin as Super Admin
    console.log('Setting Super Admin flag...');
    await db.query('UPDATE users SET is_super_admin = 1 WHERE id = ?', [userId]);

    // 4. Seed a regular Employee user
    const [existingEmployee] = await db.query('SELECT id FROM users WHERE email = ?', ['employee@vogue.com']);
    let employeeId;

    if (existingEmployee.length === 0) {
      console.log('Creating Employee user...');
      const hashedPassword = await bcrypt.hash('employee123', 12);

      const [empResult] = await db.query(`
        INSERT INTO users (username, email, password_hash, first_name, last_name, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `, ['employee', 'employee@vogue.com', hashedPassword, 'Jane', 'Doe', 'Active']);

      employeeId = empResult.insertId;
    } else {
      console.log('Employee user already exists. Skipping user creation.');
      employeeId = existingEmployee[0].id;
    }

    console.log('Assigning Employee role to user...');
    await db.query(`
      INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)
    `, [employeeId, 3]);

    console.log('✅ Seeding completed successfully!');
    process.exit(0); // Exit the script safely
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1); // Exit with failure code
  }
};

seedDatabase();



// node src/scripts/seed.js

//admin123     

  // - Email: employee@vogue.com
  // - Password: employee123  - Role: Employee (role_id: 3)
  // - Name: Jane Doe
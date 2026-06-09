const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const pool = require('./db');
const {
  signToken,
  hashPassword,
  verifyPassword,
  maybeUpgradePasswordHash,
  requireAuth,
  sanitizeUser,
} = require('./auth');

const execFileAsync = promisify(execFile);
const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'smtrade_user';
const DB_PASSWORD = process.env.DB_PASSWORD || 'StrongPass123!';
const DB_NAME = process.env.DB_NAME || 'smtrade_db';

function safeBackupName(filename) {
  return /^smtrade_backup_[\w-]+\.sql$/.test(filename) ? filename : null;
}

async function runMysqlDump(outFile) {
  const { stdout } = await execFileAsync('mysqldump', [
    '-h', DB_HOST, '-u', DB_USER, `--password=${DB_PASSWORD}`,
    '--single-transaction', '--routines', '--triggers', DB_NAME,
  ], { maxBuffer: 50 * 1024 * 1024 });
  fs.writeFileSync(outFile, stdout);
}

function runMysqlRestore(inFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn('mysql', ['-h', DB_HOST, '-u', DB_USER, `-p${DB_PASSWORD}`, DB_NAME]);
    const stream = fs.createReadStream(inFile);
    stream.pipe(proc.stdin);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `mysql exited ${code}`))));
    stream.on('error', reject);
  });
}

const app = express();
const ALLOWED_ORIGINS = [
  'https://soft.smtradeint.com',
  'http://localhost:8080',
  'http://localhost:5173',
];
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3105);

// Support an isolated API prefix for this app on shared VPS domains.
// Requests to /smtrade-api/* are handled by the same routes as /api/*.
app.use((req, _res, next) => {
  if (req.url.startsWith('/smtrade-api/')) {
    req.url = req.url.replace('/smtrade-api/', '/api/');
  }
  next();
});

// ============ HEALTH ============
// Lightweight check to verify which backend Nginx is proxying to.
// Use after every deploy: curl -i http://localhost:3105/api/health
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'smtrade-api',
    port: PORT,
    time: new Date().toISOString(),
  });
});

// ============ AUTH (public) ============
app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const [rows] = await pool.query(
      `SELECT * FROM users
       WHERE LOWER(TRIM(username)) = ? OR LOWER(TRIM(email)) = ?`,
      [username, username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await verifyPassword(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await maybeUpgradePasswordHash(pool, user.id, password, user.password);
    res.json({
      token: signToken(user),
      user: sanitizeUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public document verification (no auth required)
app.get('/api/verify/:type/:docId', async (req, res) => {
  try {
    const { type, docId } = req.params;
    const normalized = String(docId).toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const findByNumber = async (rows, numberField) =>
      rows.find((r) => String(r[numberField]).toLowerCase().replace(/[^a-z0-9-]/g, '-') === normalized);

    if (type === 'invoice') {
      const [rows] = await pool.query(`SELECT id, invoice_number as invoiceNumber, date, customer_name as customerName,
        customer_address as customerAddress, customer_phone as customerPhone, customer_email as customerEmail,
        total_amount as totalAmount, tax, total_paid as totalPaid, status, amount_in_words as amountInWords,
        signature_received as signatureReceived, signature_prepared as signaturePrepared,
        signature_authorize as signatureAuthorize, notes FROM invoices`);
      const doc = await findByNumber(rows, 'invoiceNumber');
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM invoice_items WHERE invoice_id=?', [doc.id]);
      const [payments] = await pool.query('SELECT id, date, method, description, amount FROM invoice_payments WHERE invoice_id=?', [doc.id]);
      return res.json({ ...doc, items, payments });
    }

    if (type === 'quotation') {
      const [rows] = await pool.query(`SELECT id, quotation_number as quotationNumber, date, customer_name as customerName,
        customer_address as customerAddress, customer_phone as customerPhone, total_amount as totalAmount, status,
        amount_in_words as amountInWords, signature_received as signatureReceived, signature_prepared as signaturePrepared,
        signature_authorize as signatureAuthorize, notes FROM quotations`);
      const doc = await findByNumber(rows, 'quotationNumber');
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM quotation_items WHERE quotation_id=?', [doc.id]);
      return res.json({ ...doc, items });
    }

    if (type === 'challan') {
      const [rows] = await pool.query(`SELECT id, challan_number as challanNumber, date, customer_name as customerName,
        customer_address as customerAddress, customer_phone as customerPhone, total_quantity as totalQuantity,
        order_no as orderNo, status, signature_received as signatureReceived, signature_prepared as signaturePrepared,
        signature_authorize as signatureAuthorize, notes FROM challans`);
      const doc = await findByNumber(rows, 'challanNumber');
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM challan_items WHERE challan_id=?', [doc.id]);
      return res.json({ ...doc, items });
    }

    if (type === 'purchase-order') {
      const [rows] = await pool.query(`SELECT id, po_number as poNumber, date, supplier_name as supplierName,
        supplier_address as supplierAddress, supplier_phone as supplierPhone, total_amount as totalAmount, status,
        amount_in_words as amountInWords, signature_received as signatureReceived, signature_prepared as signaturePrepared,
        signature_authorize as signatureAuthorize, notes FROM purchase_orders`);
      const doc = await findByNumber(rows, 'poNumber');
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM purchase_order_items WHERE po_id=?', [doc.id]);
      return res.json({ ...doc, items });
    }

    return res.status(400).json({ error: 'Invalid document type' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protect all remaining /api routes
app.use((req, res, next) => {
  if (req.path === '/api/health' || req.path === '/api/auth/login' || req.path.startsWith('/api/verify/')) {
    return next();
  }
  if (req.url.startsWith('/api/')) return requireAuth(req, res, next);
  next();
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role, email, created_at as createdAt FROM users WHERE id = ?',
      [req.user.sub]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'User ID, current password and new password are required' });
    }
    if (req.user.sub !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const [rows] = await pool.query('SELECT id, password FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const valid = await verifyPassword(currentPassword, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hash, userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USERS ============
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, password, name, role, email, created_at as createdAt FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const role = req.body?.role;
    const email = String(req.body?.email || '').trim();
    if (!username || !password || !name) return res.status(400).json({ error: 'Username, password and name are required' });
    const id = uuidv4();
    await pool.query('INSERT INTO users (id, username, password, name, role, email) VALUES (?, ?, ?, ?, ?, ?)', [id, username, password, name, role || 'staff', email]);
    res.json({ id, username, password, name, role: role || 'staff', email, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const name = String(req.body?.name || '').trim();
    const role = req.body?.role || 'staff';
    const email = String(req.body?.email || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !name) return res.status(400).json({ error: 'Username and name are required' });

    if (password) {
      await pool.query('UPDATE users SET username=?, password=?, name=?, role=?, email=? WHERE id=?', [username, password, name, role, email, req.params.id]);
    } else {
      await pool.query('UPDATE users SET username=?, name=?, role=?, email=? WHERE id=?', [username, name, role, email, req.params.id]);
    }
    res.json({ id: req.params.id, username, name, role, email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ CUSTOMERS ============
app.get('/api/customers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, organization, address, phone, email, created_at as createdAt FROM customers ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { name, organization, address, phone, email } = req.body;
    const id = uuidv4();
    await pool.query('INSERT INTO customers (id, name, organization, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [id, name, organization || '', address || '', phone || '', email || '']);
    res.json({ id, name, organization, address, phone, email, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const { name, organization, address, phone, email } = req.body;
    await pool.query('UPDATE customers SET name=?, organization=?, address=?, phone=?, email=? WHERE id=?', [name, organization, address, phone, email, req.params.id]);
    res.json({ id: req.params.id, ...req.body });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PRODUCTS ============
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, unit_price as unitPrice, unit_type as unitType, created_at as createdAt FROM products ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, description, unitPrice, unitType } = req.body;
    const id = uuidv4();
    await pool.query('INSERT INTO products (id, name, description, unit_price, unit_type) VALUES (?, ?, ?, ?, ?)', [id, name, description || '', unitPrice || 0, unitType || '']);
    res.json({ id, name, description, unitPrice, unitType, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, description, unitPrice, unitType } = req.body;
    await pool.query('UPDATE products SET name=?, description=?, unit_price=?, unit_type=? WHERE id=?', [name, description, unitPrice, unitType, req.params.id]);
    res.json({ id: req.params.id, ...req.body });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ INVOICES ============
app.get('/api/invoices', async (req, res) => {
  try {
    const [invoices] = await pool.query(`SELECT id, invoice_number as invoiceNumber, date, customer_id as customerId, 
      customer_name as customerName, customer_address as customerAddress, customer_phone as customerPhone, 
      customer_email as customerEmail, total_amount as totalAmount, tax, total_paid as totalPaid,
      status, amount_in_words as amountInWords, signature_received as signatureReceived,
      signature_prepared as signaturePrepared, signature_authorize as signatureAuthorize,
      notes, created_at as createdAt FROM invoices ORDER BY created_at DESC`);
    
    for (let inv of invoices) {
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM invoice_items WHERE invoice_id=?', [inv.id]);
      const [payments] = await pool.query('SELECT id, date, method, description, amount FROM invoice_payments WHERE invoice_id=?', [inv.id]);
      inv.items = items;
      inv.payments = payments;
    }
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, invoice_number as invoiceNumber, date, customer_id as customerId, 
      customer_name as customerName, customer_address as customerAddress, customer_phone as customerPhone, 
      customer_email as customerEmail, total_amount as totalAmount, tax, total_paid as totalPaid,
      status, amount_in_words as amountInWords, signature_received as signatureReceived,
      signature_prepared as signaturePrepared, signature_authorize as signatureAuthorize,
      notes, created_at as createdAt FROM invoices WHERE id=?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const inv = rows[0];
    const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM invoice_items WHERE invoice_id=?', [inv.id]);
    const [payments] = await pool.query('SELECT id, date, method, description, amount FROM invoice_payments WHERE invoice_id=?', [inv.id]);
    inv.items = items;
    inv.payments = payments;
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const d = req.body;
    const id = d.id || uuidv4();
    await pool.query(`INSERT INTO invoices (id, invoice_number, date, customer_id, customer_name, customer_address, 
      customer_phone, customer_email, total_amount, tax, total_paid, status, amount_in_words, 
      signature_received, signature_prepared, signature_authorize, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.invoiceNumber, d.date, d.customerId, d.customerName, d.customerAddress, d.customerPhone,
       d.customerEmail || '', d.totalAmount, d.tax || 0, d.totalPaid || 0, d.status || 'draft',
       d.amountInWords || '', d.signatureReceived || '', d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '']);
    
    if (d.items && d.items.length > 0) {
      for (const item of d.items) {
        await pool.query('INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    if (d.payments && d.payments.length > 0) {
      for (const p of d.payments) {
        await pool.query('INSERT INTO invoice_payments (id, invoice_id, date, method, description, amount) VALUES (?, ?, ?, ?, ?, ?)',
          [p.id || uuidv4(), id, p.date, p.method, p.description, p.amount]);
      }
    }
    res.json({ ...d, id, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const d = req.body;
    const id = req.params.id;
    await pool.query(`UPDATE invoices SET invoice_number=?, date=?, customer_id=?, customer_name=?, customer_address=?,
      customer_phone=?, customer_email=?, total_amount=?, tax=?, total_paid=?, status=?, amount_in_words=?,
      signature_received=?, signature_prepared=?, signature_authorize=?, notes=? WHERE id=?`,
      [d.invoiceNumber, d.date, d.customerId, d.customerName, d.customerAddress, d.customerPhone,
       d.customerEmail || '', d.totalAmount, d.tax || 0, d.totalPaid || 0, d.status, d.amountInWords || '',
       d.signatureReceived || '', d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '', id]);
    
    await pool.query('DELETE FROM invoice_items WHERE invoice_id=?', [id]);
    if (d.items && d.items.length > 0) {
      for (const item of d.items) {
        await pool.query('INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    await pool.query('DELETE FROM invoice_payments WHERE invoice_id=?', [id]);
    if (d.payments && d.payments.length > 0) {
      for (const p of d.payments) {
        await pool.query('INSERT INTO invoice_payments (id, invoice_id, date, method, description, amount) VALUES (?, ?, ?, ?, ?, ?)',
          [p.id || uuidv4(), id, p.date, p.method, p.description, p.amount]);
      }
    }
    res.json({ ...d, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM invoices WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ QUOTATIONS ============
app.get('/api/quotations', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, quotation_number as quotationNumber, date, customer_id as customerId,
      customer_name as customerName, customer_address as customerAddress, customer_phone as customerPhone,
      total_amount as totalAmount, status, amount_in_words as amountInWords, valid_until as validUntil,
      signature_received as signatureReceived, signature_prepared as signaturePrepared,
      signature_authorize as signatureAuthorize, notes, created_at as createdAt FROM quotations ORDER BY created_at DESC`);
    for (let q of rows) {
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM quotation_items WHERE quotation_id=?', [q.id]);
      q.items = items;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/quotations/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, quotation_number as quotationNumber, date, customer_id as customerId,
      customer_name as customerName, customer_address as customerAddress, customer_phone as customerPhone,
      total_amount as totalAmount, status, amount_in_words as amountInWords, valid_until as validUntil,
      signature_received as signatureReceived, signature_prepared as signaturePrepared,
      signature_authorize as signatureAuthorize, notes, created_at as createdAt FROM quotations WHERE id=?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const q = rows[0];
    const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM quotation_items WHERE quotation_id=?', [q.id]);
    q.items = items;
    res.json(q);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/quotations', async (req, res) => {
  try {
    const d = req.body;
    const id = d.id || uuidv4();
    await pool.query(`INSERT INTO quotations (id, quotation_number, date, customer_id, customer_name, customer_address,
      customer_phone, total_amount, status, amount_in_words, valid_until, signature_received, signature_prepared,
      signature_authorize, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.quotationNumber, d.date, d.customerId, d.customerName, d.customerAddress, d.customerPhone,
       d.totalAmount, d.status || 'draft', d.amountInWords || '', d.validUntil || '', d.signatureReceived || '',
       d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '']);
    if (d.items) {
      for (const item of d.items) {
        await pool.query('INSERT INTO quotation_items (id, quotation_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    res.json({ ...d, id, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/quotations/:id', async (req, res) => {
  try {
    const d = req.body;
    const id = req.params.id;
    await pool.query(`UPDATE quotations SET quotation_number=?, date=?, customer_id=?, customer_name=?, customer_address=?,
      customer_phone=?, total_amount=?, status=?, amount_in_words=?, valid_until=?, signature_received=?,
      signature_prepared=?, signature_authorize=?, notes=? WHERE id=?`,
      [d.quotationNumber, d.date, d.customerId, d.customerName, d.customerAddress, d.customerPhone,
       d.totalAmount, d.status, d.amountInWords || '', d.validUntil || '', d.signatureReceived || '',
       d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '', id]);
    await pool.query('DELETE FROM quotation_items WHERE quotation_id=?', [id]);
    if (d.items) {
      for (const item of d.items) {
        await pool.query('INSERT INTO quotation_items (id, quotation_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    res.json({ ...d, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/quotations/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM quotations WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ CHALLANS ============
app.get('/api/challans', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, challan_number as challanNumber, date, order_no as orderNo,
      customer_id as customerId, customer_name as customerName, customer_address as customerAddress,
      customer_phone as customerPhone, total_quantity as totalQuantity, status,
      signature_received as signatureReceived, signature_prepared as signaturePrepared,
      signature_authorize as signatureAuthorize, notes, created_at as createdAt FROM challans ORDER BY created_at DESC`);
    for (let c of rows) {
      const [items] = await pool.query(`SELECT id, item_name as itemName, details, size, delivery_qty as deliveryQty,
        balance_qty as balanceQty, unit FROM challan_items WHERE challan_id=?`, [c.id]);
      c.items = items;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/challans/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, challan_number as challanNumber, date, order_no as orderNo,
      customer_id as customerId, customer_name as customerName, customer_address as customerAddress,
      customer_phone as customerPhone, total_quantity as totalQuantity, status,
      signature_received as signatureReceived, signature_prepared as signaturePrepared,
      signature_authorize as signatureAuthorize, notes, created_at as createdAt FROM challans WHERE id=?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const c = rows[0];
    const [items] = await pool.query(`SELECT id, item_name as itemName, details, size, delivery_qty as deliveryQty,
      balance_qty as balanceQty, unit FROM challan_items WHERE challan_id=?`, [c.id]);
    c.items = items;
    res.json(c);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/challans', async (req, res) => {
  try {
    const d = req.body;
    const id = d.id || uuidv4();
    await pool.query(`INSERT INTO challans (id, challan_number, date, order_no, customer_id, customer_name,
      customer_address, customer_phone, total_quantity, status, signature_received, signature_prepared,
      signature_authorize, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.challanNumber, d.date, d.orderNo || '', d.customerId, d.customerName, d.customerAddress,
       d.customerPhone, d.totalQuantity, d.status || 'draft', d.signatureReceived || '',
       d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '']);
    if (d.items) {
      for (const item of d.items) {
        await pool.query(`INSERT INTO challan_items (id, challan_id, item_name, details, size, delivery_qty, balance_qty, unit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id || uuidv4(), id, item.itemName, item.details || '', item.size || '', item.deliveryQty, item.balanceQty || 0, item.unit]);
      }
    }
    res.json({ ...d, id, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/challans/:id', async (req, res) => {
  try {
    const d = req.body;
    const id = req.params.id;
    await pool.query(`UPDATE challans SET challan_number=?, date=?, order_no=?, customer_id=?, customer_name=?,
      customer_address=?, customer_phone=?, total_quantity=?, status=?, signature_received=?,
      signature_prepared=?, signature_authorize=?, notes=? WHERE id=?`,
      [d.challanNumber, d.date, d.orderNo || '', d.customerId, d.customerName, d.customerAddress,
       d.customerPhone, d.totalQuantity, d.status, d.signatureReceived || '',
       d.signaturePrepared || '', d.signatureAuthorize || '', d.notes || '', id]);
    await pool.query('DELETE FROM challan_items WHERE challan_id=?', [id]);
    if (d.items) {
      for (const item of d.items) {
        await pool.query(`INSERT INTO challan_items (id, challan_id, item_name, details, size, delivery_qty, balance_qty, unit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id || uuidv4(), id, item.itemName, item.details || '', item.size || '', item.deliveryQty, item.balanceQty || 0, item.unit]);
      }
    }
    res.json({ ...d, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/challans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM challans WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PURCHASE ORDERS ============
app.get('/api/purchase-orders', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, po_number as poNumber, date, supplier_name as supplierName,
      supplier_address as supplierAddress, supplier_phone as supplierPhone, supplier_email as supplierEmail,
      total_amount as totalAmount, status, amount_in_words as amountInWords, notes,
      created_at as createdAt FROM purchase_orders ORDER BY created_at DESC`);
    for (let po of rows) {
      const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM purchase_order_items WHERE po_id=?', [po.id]);
      po.items = items;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/purchase-orders/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, po_number as poNumber, date, supplier_name as supplierName,
      supplier_address as supplierAddress, supplier_phone as supplierPhone, supplier_email as supplierEmail,
      total_amount as totalAmount, status, amount_in_words as amountInWords, notes,
      created_at as createdAt FROM purchase_orders WHERE id=?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const po = rows[0];
    const [items] = await pool.query('SELECT id, description, quantity, unit_price as unitPrice, total FROM purchase_order_items WHERE po_id=?', [po.id]);
    po.items = items;
    res.json(po);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/purchase-orders', async (req, res) => {
  try {
    const d = req.body;
    const id = d.id || uuidv4();
    await pool.query(`INSERT INTO purchase_orders (id, po_number, date, supplier_name, supplier_address,
      supplier_phone, supplier_email, total_amount, status, amount_in_words, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.poNumber, d.date, d.supplierName, d.supplierAddress, d.supplierPhone, d.supplierEmail || '',
       d.totalAmount, d.status || 'draft', d.amountInWords || '', d.notes || '']);
    if (d.items) {
      for (const item of d.items) {
        await pool.query('INSERT INTO purchase_order_items (id, po_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    res.json({ ...d, id, createdAt: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/purchase-orders/:id', async (req, res) => {
  try {
    const d = req.body;
    const id = req.params.id;
    await pool.query(`UPDATE purchase_orders SET po_number=?, date=?, supplier_name=?, supplier_address=?,
      supplier_phone=?, supplier_email=?, total_amount=?, status=?, amount_in_words=?, notes=? WHERE id=?`,
      [d.poNumber, d.date, d.supplierName, d.supplierAddress, d.supplierPhone, d.supplierEmail || '',
       d.totalAmount, d.status, d.amountInWords || '', d.notes || '', id]);
    await pool.query('DELETE FROM purchase_order_items WHERE po_id=?', [id]);
    if (d.items) {
      for (const item of d.items) {
        await pool.query('INSERT INTO purchase_order_items (id, po_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)',
          [item.id || uuidv4(), id, item.description, item.quantity, item.unitPrice, item.total]);
      }
    }
    res.json({ ...d, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/purchase-orders/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM purchase_orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ COMPANY SETTINGS ============
app.get('/api/settings', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT name, tagline, address, phone, email, website, logo,
      signature_received as signatureReceived, signature_prepared as signaturePrepared,
      signature_authorize as signatureAuthorize FROM company_settings WHERE id=1`);
    if (rows.length === 0) {
      return res.json({ name: 'S. M. Trade International', tagline: '', address: '', phone: '', email: '', website: '', logo: '' });
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    const d = req.body;
    const [existing] = await pool.query('SELECT id FROM company_settings WHERE id=1');
    if (existing.length === 0) {
      await pool.query(`INSERT INTO company_settings (id, name, tagline, address, phone, email, website, logo,
        signature_received, signature_prepared, signature_authorize) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.name, d.tagline || '', d.address || '', d.phone || '', d.email || '', d.website || '', d.logo || '',
         d.signatureReceived || '', d.signaturePrepared || '', d.signatureAuthorize || '']);
    } else {
      await pool.query(`UPDATE company_settings SET name=?, tagline=?, address=?, phone=?, email=?, website=?, logo=?,
        signature_received=?, signature_prepared=?, signature_authorize=? WHERE id=1`,
        [d.name, d.tagline || '', d.address || '', d.phone || '', d.email || '', d.website || '', d.logo || '',
         d.signatureReceived || '', d.signaturePrepared || '', d.signatureAuthorize || '']);
    }
    res.json(d);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ DB DIAGNOSTICS (admin) ============
app.get('/api/diagnostics', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const [[{ invoiceCount }]] = await pool.query('SELECT COUNT(*) as invoiceCount FROM invoices');
    const [[{ customerCount }]] = await pool.query('SELECT COUNT(*) as customerCount FROM customers');
    const [[{ quotationCount }]] = await pool.query('SELECT COUNT(*) as quotationCount FROM quotations');
    const [invoices] = await pool.query(
      'SELECT id, invoice_number as invoiceNumber, customer_name as customerName, date, total_amount as totalAmount, status, created_at as createdAt FROM invoices ORDER BY created_at DESC LIMIT 20'
    );
    const [databases] = await pool.query('SHOW DATABASES');
    res.json({
      database: DB_NAME,
      host: DB_HOST,
      invoiceCount, customerCount, quotationCount,
      recentInvoices: invoices,
      databases: databases.map((d) => d.Database),
      backupDir: BACKUP_DIR,
      backupFiles: fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql')),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ BACKUPS ============
app.get('/api/backups', async (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql'));
    const backups = files.map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return {
        filename,
        size: stat.size,
        created: stat.mtime.toISOString(),
        type: filename.includes('_auto_') ? 'auto' : 'manual',
      };
    }).sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(backups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/backups', async (req, res) => {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `smtrade_backup_manual_${ts}.sql`;
    const outFile = path.join(BACKUP_DIR, filename);
    await runMysqlDump(outFile);
    res.json({ filename, size: fs.statSync(outFile).size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/backups/:filename/download', async (req, res) => {
  try {
    const filename = safeBackupName(req.params.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.download(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/backups/:filename', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const filename = safeBackupName(req.params.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/backups/:filename/restore', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const filename = safeBackupName(req.params.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    await runMysqlRestore(filePath);
    const [[{ invoiceCount }]] = await pool.query('SELECT COUNT(*) as invoiceCount FROM invoices');
    res.json({ success: true, message: 'Database restored', invoiceCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ DASHBOARD STATS ============
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [[{ customerCount }]] = await pool.query('SELECT COUNT(*) as customerCount FROM customers');
    const [[{ invoiceCount }]] = await pool.query('SELECT COUNT(*) as invoiceCount FROM invoices');
    const [[{ quotationCount }]] = await pool.query('SELECT COUNT(*) as quotationCount FROM quotations');
    const [[{ challanCount }]] = await pool.query('SELECT COUNT(*) as challanCount FROM challans');
    const [[{ poCount }]] = await pool.query('SELECT COUNT(*) as poCount FROM purchase_orders');
    const [[{ productCount }]] = await pool.query('SELECT COUNT(*) as productCount FROM products');
    const [[{ paidInvoiceCount }]] = await pool.query('SELECT COUNT(*) as paidInvoiceCount FROM invoices WHERE status = "paid"');
    const [[{ totalRevenue }]] = await pool.query('SELECT COALESCE(SUM(total_amount), 0) as totalRevenue FROM invoices WHERE status IN ("paid", "partial")');
    res.json({ customerCount, invoiceCount, quotationCount, challanCount, poCount, productCount, paidInvoiceCount, totalRevenue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const server = app.listen(PORT, () => {
  console.log(`SM Trade API running on port ${PORT}`);
  console.log(`DB: ${DB_NAME} @ ${DB_HOST}`);
});

server.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

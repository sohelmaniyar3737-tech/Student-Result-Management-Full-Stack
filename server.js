require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const { auth, allow } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'student_result_manager',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  ssl: process.env.PGHOST?.includes('neon.tech')
  ? { rejectUnauthorized: false }
  : false,
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function resultStats(subjects) {
  const totalMarks = subjects.reduce((sum, s) => sum + Number(s.marks), 0);
  const maxMarks = subjects.length * 100;
  const percentage = Number(((totalMarks / maxMarks) * 100).toFixed(2));
  let grade = 'F';
  if (percentage >= 90) grade = 'A+';
  else if (percentage >= 80) grade = 'A';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 60) grade = 'C';
  else if (percentage >= 50) grade = 'D';
  const status = percentage >= 50 && subjects.every(s => Number(s.marks) >= 35) ? 'Pass' : 'Fail';
  return { totalMarks, maxMarks, percentage, grade, status };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('teacher','student')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      roll_number VARCHAR(50) UNIQUE NOT NULL,
      course VARCHAR(100) NOT NULL DEFAULT 'BCA',
      semester VARCHAR(50) NOT NULL DEFAULT 'Semester 6',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      student_id INTEGER UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_marks INTEGER NOT NULL,
      max_marks INTEGER NOT NULL,
      percentage NUMERIC(5,2) NOT NULL,
      grade VARCHAR(3) NOT NULL,
      status VARCHAR(10) NOT NULL CHECK (status IN ('Pass','Fail')),
      published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS result_subjects (
      id SERIAL PRIMARY KEY,
      result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      marks INTEGER NOT NULL CHECK (marks >= 0 AND marks <= 100),
      UNIQUE (result_id, subject_id)
    );
  `);
}

async function getResult(resultId) {
  const resultQuery = await pool.query(`
    SELECT r.id, r.student_id AS student_record_id, r.teacher_id, r.total_marks, r.max_marks,
           r.percentage::float AS percentage, r.grade, r.status, r.published,
           s.student_id, s.name, s.email, s.roll_number, s.course, s.semester, s.user_id
    FROM results r
    JOIN students s ON s.id = r.student_id
    WHERE r.id = $1
  `, [resultId]);
  if (!resultQuery.rows[0]) return null;
  const row = resultQuery.rows[0];
  const subjects = await pool.query(`
    SELECT rs.id, sub.id AS subject_id, sub.name, rs.marks
    FROM result_subjects rs
    JOIN subjects sub ON sub.id = rs.subject_id
    WHERE rs.result_id = $1
    ORDER BY rs.id
  `, [resultId]);
  return {
    _id: row.id,
    id: row.id,
    student: {
      _id: row.student_record_id,
      id: row.student_record_id,
      user: row.user_id,
      studentId: row.student_id,
      name: row.name,
      email: row.email,
      rollNumber: row.roll_number,
      course: row.course,
      semester: row.semester,
    },
    totalMarks: row.total_marks,
    maxMarks: row.max_marks,
    percentage: row.percentage,
    grade: row.grade,
    status: row.status,
    published: row.published,
    subjects: subjects.rows.map(x => ({ _id: x.id, subjectId: x.subject_id, name: x.name, marks: x.marks }))
  };
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'Student Result Manager API', database: 'PostgreSQL' });
  } catch (err) {
    res.status(503).json({ ok: false, message: 'Database unavailable.', error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) return res.status(400).json({ message: 'Email, password and role are required.' });
    if (!['teacher', 'student'].includes(role)) return res.status(400).json({ message: 'Invalid role.' });
    const q = await pool.query('SELECT id, name, email, password, role FROM users WHERE email = $1', [String(email).toLowerCase().trim()]);
    const user = q.rows[0];
    if (!user || user.role !== role) return res.status(401).json({ message: 'Invalid credentials or selected role.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials or selected role.' });
    res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ message: 'Login failed.', error: err.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const q = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
  if (!q.rows[0]) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: q.rows[0] });
});

app.get('/api/dashboard/stats', auth, allow('teacher'), async (req, res) => {
  try {
    const [students, results, passed, average, top] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM students'),
      pool.query('SELECT COUNT(*)::int AS count FROM results'),
      pool.query("SELECT COUNT(*)::int AS count FROM results WHERE status = 'Pass'"),
      pool.query('SELECT COALESCE(ROUND(AVG(percentage), 1), 0)::float AS avg FROM results'),
      pool.query('SELECT COALESCE(MAX(percentage), 0)::float AS max FROM results')
    ]);
    const studentCount = students.rows[0].count;
    const resultCount = results.rows[0].count;
    const passedCount = passed.rows[0].count;
    res.json({ students: studentCount, results: resultCount, passRate: resultCount ? Number(((passedCount / resultCount) * 100).toFixed(1)) : 0, averagePercentage: average.rows[0].avg, topPercentage: top.rows[0].max });
  } catch (err) { res.status(500).json({ message: 'Could not load dashboard statistics.', error: err.message }); }
});

app.get('/api/students', auth, allow('teacher'), async (req, res) => {
  try {
    const q = String(req.query.search || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE s.name ILIKE $1 OR s.student_id ILIKE $1 OR s.roll_number ILIKE $1 OR s.email ILIKE $1`;
    }
    const students = await pool.query(`
      SELECT s.id, s.user_id, s.student_id, s.name, s.email, s.roll_number, s.course, s.semester,
             r.id AS result_id, r.total_marks, r.max_marks, r.percentage::float AS percentage, r.grade, r.status
      FROM students s
      LEFT JOIN results r ON r.student_id = s.id
      ${where}
      ORDER BY s.created_at DESC
    `, params);
    res.json({ students: students.rows.map(s => ({
      _id: s.id, id: s.id, user: s.user_id, studentId: s.student_id, name: s.name, email: s.email,
      rollNumber: s.roll_number, course: s.course, semester: s.semester,
      result: s.result_id ? { _id: s.result_id, totalMarks: s.total_marks, maxMarks: s.max_marks, percentage: s.percentage, grade: s.grade, status: s.status } : null
    })) });
  } catch (err) { res.status(500).json({ message: 'Could not load students.', error: err.message }); }
});

app.post('/api/students', auth, allow('teacher'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, rollNumber, course, semester, studentId, password } = req.body;
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!name || !normalizedEmail || !rollNumber || !studentId || !password) return res.status(400).json({ message: 'Name, email, roll number, student ID and password are required.' });
    if (!validEmail(normalizedEmail)) return res.status(400).json({ message: 'Please enter a valid email address.' });
    if (String(password).length < 6) return res.status(400).json({ message: 'Student password must be at least 6 characters.' });
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1 UNION SELECT id FROM students WHERE student_id = $2 OR roll_number = $3 OR email = $1 LIMIT 1', [normalizedEmail, String(studentId).trim(), String(rollNumber).trim()]);
    if (existing.rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'A student with this email, ID or roll number already exists.' }); }
    const hashed = await bcrypt.hash(password, 12);
    const user = await client.query('INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role', [String(name).trim(), normalizedEmail, hashed, 'student']);
    const student = await client.query('INSERT INTO students (user_id,student_id,name,email,roll_number,course,semester) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,student_id,name,email,roll_number,course,semester', [user.rows[0].id, String(studentId).trim(), String(name).trim(), normalizedEmail, String(rollNumber).trim(), course || 'BCA', semester || 'Semester 6']);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Student account created successfully.', student: { _id: student.rows[0].id, ...student.rows[0] } });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ message: 'Could not create student.', error: err.message }); }
  finally { client.release(); }
});

app.put('/api/students/:id', auth, allow('teacher'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, rollNumber, course, semester, studentId } = req.body;
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!name || !validEmail(normalizedEmail) || !rollNumber || !studentId) return res.status(400).json({ message: 'Name, valid email, roll number and student ID are required.' });
    await client.query('BEGIN');
    const current = await client.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Student not found.' }); }
    const duplicate = await client.query('SELECT id FROM students WHERE (student_id=$1 OR roll_number=$2 OR email=$3) AND id<>$4 LIMIT 1', [String(studentId).trim(), String(rollNumber).trim(), normalizedEmail, req.params.id]);
    const userDup = await client.query('SELECT id FROM users WHERE email=$1 AND id<>$2 LIMIT 1', [normalizedEmail, current.rows[0].user_id]);
    if (duplicate.rows[0] || userDup.rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Another student already uses this email, ID or roll number.' }); }
    await client.query('UPDATE users SET name=$1,email=$2 WHERE id=$3', [String(name).trim(), normalizedEmail, current.rows[0].user_id]);
    const updated = await client.query('UPDATE students SET name=$1,email=$2,roll_number=$3,course=$4,semester=$5,student_id=$6 WHERE id=$7 RETURNING id,student_id,name,email,roll_number,course,semester', [String(name).trim(), normalizedEmail, String(rollNumber).trim(), course || 'BCA', semester || 'Semester 6', String(studentId).trim(), req.params.id]);
    await client.query('COMMIT');
    res.json({ message: 'Student updated successfully.', student: { _id: updated.rows[0].id, ...updated.rows[0] } });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ message: 'Could not update student.', error: err.message }); }
  finally { client.release(); }
});

app.delete('/api/students/:id', auth, allow('teacher'), async (req, res) => {
  try {
    const q = await pool.query('SELECT user_id FROM students WHERE id=$1', [req.params.id]);
    if (!q.rows[0]) return res.status(404).json({ message: 'Student not found.' });
    await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    res.json({ message: 'Student and associated result deleted.' });
  } catch (err) { res.status(500).json({ message: 'Could not delete student.', error: err.message }); }
});

app.post('/api/results', auth, allow('teacher'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { studentId, subjects } = req.body;
    if (!studentId || !Array.isArray(subjects) || subjects.length < 1) return res.status(400).json({ message: 'Student and at least one subject are required.' });
    const cleaned = subjects.map(s => ({ name: String(s.name || '').trim(), marks: Number(s.marks) }));
    if (cleaned.some(s => !s.name || !Number.isInteger(s.marks) || s.marks < 0 || s.marks > 100)) return res.status(400).json({ message: 'Every subject needs a name and whole-number marks from 0 to 100.' });
    const duplicateNames = new Set(cleaned.map(s => s.name.toLowerCase()));
    if (duplicateNames.size !== cleaned.length) return res.status(400).json({ message: 'Subject names must be unique in a result.' });
    const student = await client.query('SELECT id FROM students WHERE id=$1', [studentId]);
    if (!student.rows[0]) return res.status(404).json({ message: 'Student not found.' });
    const stats = resultStats(cleaned);
    await client.query('BEGIN');
    const old = await client.query('SELECT id FROM results WHERE student_id=$1', [studentId]);
    let resultId;
    if (old.rows[0]) {
      resultId = old.rows[0].id;
      await client.query('UPDATE results SET teacher_id=$1,total_marks=$2,max_marks=$3,percentage=$4,grade=$5,status=$6,published=true,updated_at=NOW() WHERE id=$7', [req.user.id, stats.totalMarks, stats.maxMarks, stats.percentage, stats.grade, stats.status, resultId]);
      await client.query('DELETE FROM result_subjects WHERE result_id=$1', [resultId]);
    } else {
      const created = await client.query('INSERT INTO results (student_id,teacher_id,total_marks,max_marks,percentage,grade,status,published) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id', [studentId, req.user.id, stats.totalMarks, stats.maxMarks, stats.percentage, stats.grade, stats.status]);
      resultId = created.rows[0].id;
    }
    for (const s of cleaned) {
      const subject = await client.query('INSERT INTO subjects (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [s.name]);
      await client.query('INSERT INTO result_subjects (result_id,subject_id,marks) VALUES ($1,$2,$3)', [resultId, subject.rows[0].id, s.marks]);
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Result saved successfully.', result: await getResult(resultId) });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ message: 'Could not save result.', error: err.message }); }
  finally { client.release(); }
});

app.get('/api/results/:id', auth, async (req, res) => {
  try {
    const result = await getResult(req.params.id);
    if (!result) return res.status(404).json({ message: 'Result not found.' });
    if (req.user.role === 'student' && String(result.student.user) !== String(req.user.id)) return res.status(403).json({ message: 'You can only view your own result.' });
    res.json({ result });
  } catch (err) { res.status(500).json({ message: 'Could not load result.', error: err.message }); }
});

app.get('/api/my-result', auth, allow('student'), async (req, res) => {
  try {
    const studentQ = await pool.query('SELECT id,student_id,name,email,roll_number,course,semester,user_id FROM students WHERE user_id=$1', [req.user.id]);
    if (!studentQ.rows[0]) return res.status(404).json({ message: 'Student profile not found.' });
    const s = studentQ.rows[0];
    const resultQ = await pool.query('SELECT id FROM results WHERE student_id=$1 AND published=true', [s.id]);
    const result = resultQ.rows[0] ? await getResult(resultQ.rows[0].id) : null;
    res.json({ student: { _id:s.id, id:s.id, user:s.user_id, studentId:s.student_id, name:s.name, email:s.email, rollNumber:s.roll_number, course:s.course, semester:s.semester }, result });
  } catch (err) { res.status(500).json({ message: 'Could not load your result.', error: err.message }); }
});

function formatSemesterValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  return raw.replace(/^semester\s+/i, '').trim() || 'N/A';
}

function buildResultMarksheet(doc, result) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const pageWidth = right - left;
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  doc.fillColor('#111827').lineWidth(1);
  doc.font('Helvetica-Bold').fontSize(18).text('STUDENT RESULT MANAGEMENT SYSTEM', { align: 'center' });
  doc.moveDown(0.25);
  doc.fontSize(14).text('STUDENT RESULT', { align: 'center' });
  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.8);

  const infoBoxTop = doc.y;
  const infoBoxHeight = 120;
  doc.rect(left, infoBoxTop, pageWidth, infoBoxHeight).stroke();
  doc.font('Helvetica-Bold').fontSize(11).text('STUDENT INFORMATION', left + 20, infoBoxTop + 12, { width: pageWidth - 40, align: 'center' });
  doc.moveTo(left + 18, infoBoxTop + 28).lineTo(right - 18, infoBoxTop + 28).stroke();

  const infoRows = [
    ['Student Name', result.student.name || 'N/A'],
    ['Student ID', result.student.studentId || 'N/A'],
    ['Roll Number', result.student.rollNumber || 'N/A'],
    ['Course', result.student.course || 'N/A'],
    ['Semester', formatSemesterValue(result.student.semester)]
  ];

  const labelWidth = 125;
  const valueX = left + 170;
  let infoY = infoBoxTop + 42;
  doc.font('Helvetica').fontSize(10);
  infoRows.forEach(([label, value]) => {
    doc.text(label, left + 34, infoY, { width: labelWidth, align: 'left' });
    doc.text(`: ${value}`, valueX, infoY);
    infoY += 18;
  });

  doc.moveDown(1.3);
  const tableTop = doc.y + 6;
  const columns = [
    { title: 'Sr. No.', width: 52 },
    { title: 'Subject Name', width: 240 },
    { title: 'Max Marks', width: 92 },
    { title: 'Marks Obtained', width: 108 }
  ];
  const tableLeft = left;
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const headerHeight = 26;
  const rowHeight = 24;

  doc.font('Helvetica-Bold').fontSize(11).text('SUBJECT-WISE MARKS', { align: 'center' });
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.4);

  let x = tableLeft;
  doc.font('Helvetica-Bold').fontSize(9);
  columns.forEach((col) => {
    doc.rect(x, tableTop, col.width, headerHeight).fillColor('#eef2ff').stroke();
    doc.fillColor('#111827').text(col.title, x + 6, tableTop + 8, { width: col.width - 12, align: 'center' });
    x += col.width;
  });
  x = tableLeft;
  let y = tableTop + headerHeight;
  doc.font('Helvetica').fontSize(9.2);
  result.subjects.forEach((subject, index) => {
    const cells = [
      String(index + 1),
      subject.name,
      '100',
      String(subject.marks)
    ];
    columns.forEach((col, colIndex) => {
      const cellX = x;
      const cellWidth = col.width;
      const isNumeric = colIndex === 0 || colIndex === 2 || colIndex === 3;
      doc.rect(cellX, y, cellWidth, rowHeight).stroke();
      const textX = isNumeric ? cellX : cellX + 8;
      const textWidth = isNumeric ? cellWidth : cellWidth - 16;
      doc.fillColor('#111827').text(cells[colIndex], textX, y + 7, { width: textWidth, align: isNumeric ? 'center' : 'left' });
      x += col.width;
    });
    x = tableLeft;
    y += rowHeight;
  });

  doc.moveDown(1.4);
  doc.font('Helvetica-Bold').fontSize(11).text('RESULT SUMMARY', { align: 'center' });
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.5);

  const summaryY = doc.y + 4;
  doc.font('Helvetica').fontSize(10);
  doc.text(`Total Marks       : ${result.totalMarks} / ${result.maxMarks}`, left + 18, summaryY);
  doc.text(`Percentage        : ${Number(result.percentage).toFixed(2)}%`, left + 18, summaryY + 22);
  doc.text(`Grade             : ${result.grade}`, left + 18, summaryY + 44);
  doc.text(`Result Status     : ${String(result.status).toUpperCase()}`, left + 18, summaryY + 66);

  doc.moveDown(2.5);
  doc.font('Helvetica').fontSize(9).text(`Generated Date: ${dateLabel}`, left + 18);

  const signatureY = doc.y + 18;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('__________________________', right - 150, signatureY, { width: 150, align: 'center' });
  doc.text('Teacher / Authorized Signature', right - 150, signatureY + 16, { width: 150, align: 'center' });

  doc.moveDown(1.3);
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#374151').text('Generated by Student Result Management System', { align: 'center' });
}

app.get('/api/results/:id/pdf', auth, async (req, res) => {
  try {
    const result = await getResult(req.params.id);
    if (!result) return res.status(404).json({ message: 'Result not found.' });
    if (req.user.role === 'student' && String(result.student.user) !== String(req.user.id)) return res.status(403).json({ message: 'You can only download your own result.' });
    const doc = new PDFDocument({ size: 'A4', margin: 50, layout: 'portrait' });
    const safeName = String(result.student.studentId || 'result').replace(/[^a-z0-9_-]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-result.pdf"`);
    doc.pipe(res);
    buildResultMarksheet(doc, result);
    doc.end();
  } catch (err) { res.status(500).json({ message: 'Could not generate PDF.', error: err.message }); }
});

app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  if (!process.env.JWT_SECRET) {
    console.error('Missing JWT_SECRET in .env');
    process.exit(1);
  }
  try {
    await initDatabase();
    await pool.query('SELECT 1');
    console.log(`PostgreSQL connected. Server running at http://localhost:${PORT}`);
    app.listen(PORT);
  } catch (err) {
    console.error('PostgreSQL connection failed:', err.message);
    console.error('Check PostgreSQL is running and your PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD values in .env.');
    process.exit(1);
  }
}

start();

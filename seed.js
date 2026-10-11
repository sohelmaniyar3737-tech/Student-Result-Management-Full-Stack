require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'student_result_manager',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(160) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL CHECK (role IN ('teacher','student')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_id VARCHAR(50) UNIQUE NOT NULL, name VARCHAR(120) NOT NULL, email VARCHAR(160) UNIQUE NOT NULL,
        roll_number VARCHAR(50) UNIQUE NOT NULL, course VARCHAR(100) NOT NULL DEFAULT 'BCA',
        semester VARCHAR(50) NOT NULL DEFAULT 'Semester 6', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY, name VARCHAR(120) UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY, student_id INTEGER UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL, total_marks INTEGER NOT NULL,
        max_marks INTEGER NOT NULL, percentage NUMERIC(5,2) NOT NULL, grade VARCHAR(3) NOT NULL,
        status VARCHAR(10) NOT NULL CHECK (status IN ('Pass','Fail')), published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS result_subjects (
        id SERIAL PRIMARY KEY, result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT, marks INTEGER NOT NULL CHECK (marks BETWEEN 0 AND 100),
        UNIQUE(result_id, subject_id)
      );
    `);

    // Keep existing database records; do not clear tables.

    const teacherPassword = await bcrypt.hash('Teacher@123', 12);
    const studentPassword = await bcrypt.hash('Student@123', 12);
    const teacher = await client.query(
      `INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,'teacher') RETURNING id`,
      ['Demo Teacher','teacher@example.com',teacherPassword]
    );
    const studentUser = await client.query(
      `INSERT INTO users(name,email,password,role) VALUES($1,$2,$3,'student') RETURNING id`,
      ['Aarav Sharma','student@example.com',studentPassword]
    );
    const student = await client.query(
      `INSERT INTO students(user_id,student_id,name,email,roll_number,course,semester)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [studentUser.rows[0].id,'BCA001','Aarav Sharma','student@example.com','101','BCA','Semester 6']
    );

    const subjects = [
      ['DBMS',88], ['Network Communication',76], ['Python',91],
      ['Data Science',84], ['Web Development',94], ['Software Engineering',79]
    ];
    const total = subjects.reduce((sum, [,marks]) => sum + marks, 0);
    const max = subjects.length * 100;
    const percentage = Number(((total / max) * 100).toFixed(2));
    const result = await client.query(
      `INSERT INTO results(student_id,teacher_id,total_marks,max_marks,percentage,grade,status,published)
       VALUES($1,$2,$3,$4,$5,'A','Pass',true) RETURNING id`,
      [student.rows[0].id,teacher.rows[0].id,total,max,percentage]
    );
    for (const [name, marks] of subjects) {
      const subject = await client.query(`INSERT INTO subjects(name) VALUES($1) RETURNING id`, [name]);
      await client.query(`INSERT INTO result_subjects(result_id,subject_id,marks) VALUES($1,$2,$3)`, [result.rows[0].id,subject.rows[0].id,marks]);
    }
    await client.query('COMMIT');
    console.log('\nPostgreSQL seed complete.');
    console.log('Teacher: teacher@example.com / Teacher@123');
    console.log('Student: student@example.com / Student@123\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
seed();

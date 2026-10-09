# Student Result Manager — Full Stack PostgreSQL Edition

A complete Student Result Management System built around the existing UI prototype and upgraded into a working full-stack application.

## Stack

- HTML5, CSS3, JavaScript
- Node.js + Express
- PostgreSQL
- pgAdmin 4 for database administration
- JWT authentication
- bcrypt password hashing
- PDFKit for downloadable results

## Roles

### Teacher
- Login with teacher role
- Dashboard statistics
- Search students
- Add students and student accounts
- Edit/delete students
- Enter/update marks
- Calculate total, percentage, grade and pass/fail
- Publish results
- Download result PDFs

### Student
- Login with student role
- View own profile
- View published result
- View subject-wise progress
- View percentage, grade and pass/fail status
- Print result
- Download PDF result

Teacher-only endpoints are protected by backend role authorization. A student cannot access teacher CRUD operations by changing the frontend.

## Database design

Tables:

- `users` — authentication and roles
- `students` — student profile data
- `subjects` — reusable subject names
- `results` — one published/current result per student
- `result_subjects` — marks for each subject in a result

The result/subject relationship is represented with a relational junction table and foreign keys.

## Run on Windows

1. Install PostgreSQL. pgAdmin 4 is optional but recommended.
2. Create a database named `student_result_manager`.
3. Copy `.env.example` to `.env`.
4. Put your PostgreSQL password in `PGPASSWORD`.
5. Run:

```powershell
npm install
npm run seed
npm start
```

6. Open `http://localhost:5000`.

The application automatically creates its tables on startup.

## Demo accounts

Teacher:
- Email: `teacher@example.com`
- Password: `Teacher@123`

Student:
- Email: `student@example.com`
- Password: `Student@123`

## Important

`npm run seed` clears the project tables and inserts fresh demo data. Do not run it after you start entering real project data unless you intend to reset the database.

Do not open the HTML files directly. Run the Express server with `npm start` and use `http://localhost:5000`.

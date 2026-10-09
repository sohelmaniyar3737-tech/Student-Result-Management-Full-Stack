if(requireRole('teacher')){
 const user=sessionUser(); document.getElementById('teacherName').textContent=user.name;
 const subjectRows=document.getElementById('subjectRows');
 const defaults=['DBMS','Network Communication','Python','Data Science','Web Development','Software Engineering'];
 defaults.forEach((name,i)=>{subjectRows.insertAdjacentHTML('beforeend',`<div class="subject-row"><span class="subject-number">${String(i+1).padStart(2,'0')}</span><input class="subject-name" value="${name}" placeholder="Subject name" required><input class="subject-mark" type="number" min="0" max="100" placeholder="Marks" required></div>`)});
 let students=[];
 let editModal=null;

 function ensureEditModal(){
   if(editModal) return;
   editModal=document.createElement('div');
   editModal.id='studentEditModal';
   editModal.className='modal hidden';
   editModal.innerHTML=`<div class="modal-backdrop" data-close="true"></div><div class="modal-card"><div class="modal-header"><h3>Edit Student</h3><button type="button" class="icon-btn modal-close" aria-label="Close edit student form"><i class="fa-solid fa-xmark"></i></button></div><form id="editStudentForm" class="form-grid modal-form"><input type="hidden" id="editStudentId"><label>Student Name<input id="editStudentName" required placeholder="Enter full name"></label><label>Student ID<input id="editStudentIdField" required placeholder="e.g. BCA002"></label><label>Roll Number<input id="editRollNumber" required placeholder="e.g. 102"></label><label>Email<input id="editEmail" type="email" required placeholder="student@example.com"></label><label>Course<input id="editCourse" required placeholder="BCA"></label><label>Semester<input id="editSemester" required placeholder="Semester 6"></label><button class="calculate-btn full-btn" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button></form></div>`;
   document.body.appendChild(editModal);
   const form=document.getElementById('editStudentForm');
   const closeBtn=editModal.querySelector('.modal-close');
   editModal.addEventListener('click',e=>{ if(e.target.dataset.close==='true') closeEditModal(); });
   closeBtn.addEventListener('click',closeEditModal);
   form.addEventListener('submit',async e=>{
     e.preventDefault();
     const id=document.getElementById('editStudentId').value;
     const payload={
       studentId:document.getElementById('editStudentIdField').value.trim(),
       name:document.getElementById('editStudentName').value.trim(),
       email:document.getElementById('editEmail').value.trim(),
       rollNumber:document.getElementById('editRollNumber').value.trim(),
       course:document.getElementById('editCourse').value.trim(),
       semester:document.getElementById('editSemester').value.trim()
     };
     if(!payload.studentId||!payload.name||!payload.email||!payload.rollNumber||!payload.course||!payload.semester){ toast('Please fill in all student fields.','error'); return; }
     const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
     if(!emailPattern.test(payload.email)){ toast('Please enter a valid email address.','error'); return; }
     try{ await api('/students/'+encodeURIComponent(id),{method:'PUT',body:payload}); toast('Student updated successfully.'); closeEditModal(); await Promise.all([loadStats(),loadStudents(document.getElementById('studentSearch').value)]); }catch(err){ toast(err.message,'error'); }
   });
 }
 function closeEditModal(){ if(!editModal) return; editModal.classList.remove('show'); }
 function openEditModal(id){ const student=students.find(s=>String(s._id)===String(id)); if(!student){ toast('Student not found.','error'); return; } ensureEditModal(); document.getElementById('editStudentId').value=String(student._id); document.getElementById('editStudentName').value=student.name||''; document.getElementById('editStudentIdField').value=student.studentId||''; document.getElementById('editRollNumber').value=student.rollNumber||''; document.getElementById('editEmail').value=student.email||''; document.getElementById('editCourse').value=student.course||'BCA'; document.getElementById('editSemester').value=student.semester||'Semester 6'; editModal.classList.add('show'); }
 document.getElementById('logoutBtn').onclick=logout;
 async function loadStats(){const d=await api('/dashboard/stats'); document.getElementById('statStudents').textContent=d.students;document.getElementById('statResults').textContent=d.results;document.getElementById('statPassRate').textContent=d.passRate+'%';document.getElementById('statAverage').textContent=d.averagePercentage+'%';}
 async function loadStudents(search=''){const d=await api('/students?search='+encodeURIComponent(search)); students=d.students; const select=document.getElementById('resultStudent'); select.innerHTML='<option value="">Select a student</option>'+students.map(s=>`<option value="${s._id}">${s.name} — ${s.studentId}</option>`).join(''); renderTable();}
 function renderTable(){const body=document.getElementById('studentTableBody'); if(!students.length){body.innerHTML='<tr><td colspan="7">No students found.</td></tr>';return} body.innerHTML=students.map(s=>{const r=s.result; return `<tr><td><strong>${esc(s.name)}</strong><span>${esc(s.email||'')}</span></td><td>${esc(s.studentId)}</td><td>${esc(s.rollNumber)}</td><td>${r?r.percentage+'%':'—'}</td><td>${r?r.grade:'—'}</td><td>${r?`<span class="status ${r.status==='Pass'?'pass':'fail'}">${r.status}</span>`:'<span class="status">Pending</span>'}</td><td><div class="table-actions">${r?`<button class="icon-btn" title="Download PDF" onclick="downloadPdf('${r._id}')"><i class="fa-solid fa-download"></i></button>`:''}<button class="icon-btn" title="Edit student" onclick="editStudent('${s._id}')"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" title="Delete student" onclick="deleteStudent('${s._id}')"><i class="fa-solid fa-trash"></i></button></div></td></tr>`}).join('');}
 function esc(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
 window.downloadPdf=async id=>{try{const r=await fetch('/api/results/'+id+'/pdf',{headers:{Authorization:'Bearer '+token()}});if(!r.ok)throw new Error('Could not download PDF.');const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='student-result.pdf';a.click();URL.revokeObjectURL(a.href);}catch(e){toast(e.message,'error')}};

 window.editStudent=id=>openEditModal(id);

 window.deleteStudent=async id=>{const studentId=String(id); if(!confirm('Delete this student and their result?'))return;try{await api('/students/'+encodeURIComponent(studentId),{method:'DELETE'});toast('Student deleted.');await Promise.all([loadStats(),loadStudents(document.getElementById('studentSearch').value)]);}catch(e){toast(e.message,'error')}};
 document.getElementById('studentForm').addEventListener('submit',async e=>{e.preventDefault();const b={studentId:studentId.value.trim(),name:studentName.value.trim(),email:studentEmail.value.trim(),rollNumber:rollNumber.value.trim(),course:course.value.trim(),semester:semester.value.trim(),password:studentPassword.value};try{await api('/students',{method:'POST',body:b});e.target.reset();course.value='BCA';semester.value='Semester 6';toast('Student account created successfully.');await Promise.all([loadStats(),loadStudents()]);}catch(err){toast(err.message,'error')}});
 document.getElementById('resultForm').addEventListener('submit',async e=>{e.preventDefault();const subjects=[...document.querySelectorAll('.subject-row')].map(row=>({name:row.querySelector('.subject-name').value.trim(),marks:Number(row.querySelector('.subject-mark').value)}));try{await api('/results',{method:'POST',body:{studentId:document.getElementById('resultStudent').value,subjects}});toast('Result saved and published.');await Promise.all([loadStats(),loadStudents(document.getElementById('studentSearch').value)]);}catch(err){toast(err.message,'error')}});
 let searchTimer;document.getElementById('studentSearch').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadStudents(e.target.value),300)});
 loadStats().catch(e=>toast(e.message,'error'));loadStudents().catch(e=>toast(e.message,'error'));
}

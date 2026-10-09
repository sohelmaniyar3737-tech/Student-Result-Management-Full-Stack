const API = '/api';
function token(){ return localStorage.getItem('srm_token'); }
function saveSession(data){ localStorage.setItem('srm_token', data.token); localStorage.setItem('srm_user', JSON.stringify(data.user)); }
function sessionUser(){ try{return JSON.parse(localStorage.getItem('srm_user')||'null')}catch{return null} }
function logout(){ localStorage.removeItem('srm_token'); localStorage.removeItem('srm_user'); location.href='/'; }
async function api(path, options={}){
  const headers={...(options.headers||{})};
  if(options.body && typeof options.body !== 'string'){ headers['Content-Type']='application/json'; options.body=JSON.stringify(options.body); }
  if(token()) headers.Authorization=`Bearer ${token()}`;
  const res=await fetch(API+path,{...options,headers});
  const data=await res.json().catch(()=>({message:'Unexpected server response.'}));
  if(!res.ok){ if(res.status===401){ localStorage.removeItem('srm_token'); localStorage.removeItem('srm_user'); } throw new Error(data.message||'Request failed.'); }
  return data;
}
function toast(message,type='success'){
  const el=document.getElementById('toast'); if(!el)return;
  el.textContent=message; el.style.background=type==='error'?'#b42318':'#1e293b'; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800);
}
function requireRole(role){ const u=sessionUser(); if(!token()||!u||u.role!==role){ location.href=`/login.html?role=${role}`; return false;} return true; }

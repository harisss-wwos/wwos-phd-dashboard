// Home page: auth gate + dynamic user-added archive buttons

const AUTH_USER='harisss';
const AUTH_PASS='harisss@123';

// Render any user-added archives (stored in localStorage registry, data in IndexedDB)
function renderDynamicButtons(){
  const registry=JSON.parse(localStorage.getItem('phd_custom_archives')||'[]');
  const container=document.getElementById('dynamicBtns');
  container.innerHTML=registry.map(a=>`<a class="card" href="archive.html?ds=custom&key=${encodeURIComponent(a.key)}"><h2>${a.name}</h2><p>Custom archive dashboard added by an authorized user.</p><span class="tag">${a.total||''} tickets · Archived</span></a>`).join('');
}

document.getElementById('uploadCard').onclick=()=>{
  document.getElementById('authModal').style.display='flex';
  document.getElementById('authErr').style.display='none';
  document.getElementById('authUser').value='';
  document.getElementById('authPass').value='';
  setTimeout(()=>document.getElementById('authUser').focus(),50);
};

function closeAuth(){document.getElementById('authModal').style.display='none';}

function checkAuth(){
  const u=document.getElementById('authUser').value.trim();
  const p=document.getElementById('authPass').value;
  if(u===AUTH_USER&&p===AUTH_PASS){
    sessionStorage.setItem('phd_authed','1');
    window.location.href='add-archive.html';
  } else {
    document.getElementById('authErr').style.display='block';
  }
}

document.getElementById('authPass').addEventListener('keydown',(e)=>{if(e.key==='Enter')checkAuth();});

renderDynamicButtons();

(() => {
  'use strict';
  const cfg = window.ABITARE_CONFIG;
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const STATUS = {
    inviato: { label:'Inviato', pct:10, color:'#2a2a2a' },
    presa_in_carica: { label:'Presa in carica', pct:25, color:'#2a2a2a' },
    in_lavorazione: { label:'In lavorazione', pct:50, color:'#5c47cd' },
    stand_by: { label:'Stand-by', pct:50, color:'#c36522' },
    attesa_feedback: { label:'Attesa feedback', pct:75, color:'#ffc53d' },
    completato: { label:'Completato', pct:100, color:'#2c8c5e' },
  };
  const TYPES = ['Sito web','Landing page','Brochure','Flyer','Presentazione','DEM / Newsletter','Post social','Cartellonistica','Materiale stampa','Video / Reel','Altro'];
  const PRIORITY_LABELS = { bassa:'Bassa', media:'Media', alta:'Alta', urgente:'Urgente' };
  let session = null;
  let profile = null;
  let myOrdersCache = [];
  let adminOrdersCache = [];
  let dashboardMode = localStorage.getItem('abitare_lavorazioni_dashboard_mode') || 'charts';

  function toast(msg){ const t=$('#Toast'); if(!t) return alert(msg); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 3800); }
  function esc(s){ return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function fmtDate(v){ if(!v) return '—'; try{return new Intl.DateTimeFormat('it-IT').format(new Date(v));}catch{return v;} }
  function dateKey(v){ if(!v) return ''; try{return new Date(v).toISOString().slice(0,10);}catch{return String(v).slice(0,10);} }
  function statusBadge(st){ const x=STATUS[st]||STATUS.inviato; return `<span class="status-badge status-${st}">${x.label}</span>`; }
  function priorityBadge(p){ return `<span class="priority-badge priority-${p||'media'}">${esc(PRIORITY_LABELS[p] || 'Media')}</span>`; }
  function progress(st){ const x=STATUS[st]||STATUS.inviato; return `<div class="progressbar progress-${st}" title="${x.label}"><span style="width:${x.pct}%"></span></div>`; }
  function showAuth(show){ $('#AuthOverlay').classList.toggle('hidden', !show); $('#AppRoot').classList.toggle('hidden', show); }
  function setLoading(show){ $('#AuthPreloader').classList.toggle('hidden', !show); }

  function syncMenuIcons(){
    $$('#SideMenu li').forEach(li => {
      const img = li.querySelector('.mi img');
      const fb = li.querySelector('.mi-fallback');
      if(!img) return;
      const src = li.classList.contains('active') ? li.dataset.iconActive : li.dataset.icon;
      img.onerror = () => { img.style.display='none'; if(fb) fb.style.display='inline'; };
      img.onload = () => { img.style.display='block'; if(fb) fb.style.display='none'; };
      img.src = src || '';
    });
  }

  async function loadProfile(){
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if(error) throw error;
    profile = data;
    if(profile.active === false){ await supabase.auth.signOut(); throw new Error('Account disattivato. Contatta Billy o Mattia.'); }
    $('#UserLabel').textContent = profile.full_name || profile.email;
    $('#UserRole').textContent = (profile.role || 'user').toUpperCase();
    $('#UserAvatar').textContent = (profile.full_name || profile.email || 'A').trim().slice(0,1).toUpperCase();
    $('#AdminMenuItem').classList.toggle('hidden', profile.role !== 'admin');
  }

  async function init(){
    fillSelects(); bindUI(); addItemRow(); syncMenuIcons(); syncDashboardMode();
    const { data } = await supabase.auth.getSession();
    session = data.session;
    setTimeout(()=>setLoading(false), 450);
    if(session){
      try{ await loadProfile(); showAuth(false); await refreshAll(); }
      catch(e){ showAuth(true); $('#AuthError').textContent = e.message; }
    } else showAuth(true);
    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      if(session){ await loadProfile(); showAuth(false); await refreshAll(); }
      else { profile=null; showAuth(true); }
    });
  }

  function fillSelects(){
    const statusOptions = '<option value="">Tutti gli stati</option>' + Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
    $('#MineStatusFilter').innerHTML = statusOptions;
    $('#AdminStatusFilter').innerHTML = statusOptions;
  }

  function bindUI(){
    $('#AuthTogglePassword').addEventListener('click',()=>{ const p=$('#AuthPassword'); p.type = p.type === 'password' ? 'text' : 'password'; });
    $('#AuthConfirm').addEventListener('click', login);
    $('#AuthPassword').addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });
    $('#BtnLogout').addEventListener('click',()=>supabase.auth.signOut());
    $('#UserMenu').addEventListener('click',()=>$('#UserDropdown').classList.toggle('hidden'));
    $$('#SideMenu li').forEach(li=>li.addEventListener('click',()=>navigate(li.dataset.view)));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.go)));
    $('#RefreshAll').addEventListener('click', refreshAll);
    $('#ToggleDashboardView').addEventListener('click', toggleDashboardMode);
    $('#RefreshMine').addEventListener('click', renderMine);
    $('#RefreshAdmin').addEventListener('click', renderAdmin);
    ['MineSearch','MineStatusFilter','MinePriorityFilter','MineDateFilter'].forEach(id => $('#'+id).addEventListener('input', drawMineList));
    ['AdminSearch','AdminStatusFilter','AdminPriorityFilter','AdminDateFilter'].forEach(id => $('#'+id).addEventListener('input', drawAdminList));
    $('#AddItemRow').addEventListener('click', addItemRow);
    $('#ResetOrderForm').addEventListener('click', resetOrderForm);
    $('#OrderForm').addEventListener('submit', submitOrder);
  }

  async function login(){
    $('#AuthError').textContent='';
    const email=$('#AuthEmail').value.trim(); const password=$('#AuthPassword').value;
    if(!email || !password){ $('#AuthError').textContent='Inserisci email e password.'; return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) $('#AuthError').textContent = error.message || 'Credenziali non valide.';
  }

  function navigate(view){
    if(view === 'admin' && profile?.role !== 'admin') return;
    $$('.view').forEach(v=>v.classList.add('hidden'));
    const map={dashboard:'#DashboardView',create:'#CreateView',mine:'#MineView',admin:'#AdminView'};
    $(map[view]||map.dashboard).classList.remove('hidden');
    $$('#SideMenu li').forEach(li=>li.classList.toggle('active', li.dataset.view===view));
    syncMenuIcons();
    if(view==='mine') renderMine();
    if(view==='admin') renderAdmin();
    if(view==='dashboard') renderStats();
  }

  function addItemRow(data={}){
    const wrap=document.createElement('div'); wrap.className='order-row';
    wrap.innerHTML = `<select class="input item-type">${TYPES.map(t=>`<option ${data.item_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select><input class="input item-title" placeholder="Titolo" value="${esc(data.item_title||'')}" /><input class="input item-desc" placeholder="Descrizione opzionale" value="${esc(data.item_description||'')}" /><input class="input item-qty" type="number" min="1" value="${esc(data.quantity||1)}" /><button type="button" class="row-delete">×</button>`;
    wrap.querySelector('.row-delete').addEventListener('click',()=>{ wrap.remove(); if(!$('#OrderItemsRows').children.length) addItemRow(); });
    $('#OrderItemsRows').appendChild(wrap);
  }

  function getItems(){
    return $$('#OrderItemsRows .order-row').map(r=>({
      item_type:r.querySelector('.item-type').value,
      item_title:r.querySelector('.item-title').value.trim(),
      item_description:r.querySelector('.item-desc').value.trim(),
      quantity:Number(r.querySelector('.item-qty').value||1),
    })).filter(x=>x.item_title);
  }

  function resetOrderForm(){ $('#OrderForm').reset(); $('#Priority').value='media'; $('#OrderItemsRows').innerHTML=''; addItemRow(); }

  async function submitOrder(e){
    e.preventDefault();
    const items=getItems();
    const firstType = items[0]?.item_type || 'Altro';
    const payload={ user_id: session.user.id, request_type: firstType, project_name: $('#ProjectName').value.trim() || null, commessa: $('#Commessa').value.trim() || null, subject: $('#Subject').value.trim(), description: $('#Description').value.trim(), priority: $('#Priority').value, requested_delivery_date: $('#DeliveryDate').value || null, status: 'inviato' };
    if(!payload.subject || !payload.description){ toast('Compila oggetto e descrizione.'); return; }
    $('#SubmitOrder').disabled=true; $('#SubmitOrder').textContent='Invio...';
    try{
      const { data:order, error } = await supabase.from('orders').insert(payload).select('*').single();
      if(error) throw error;
      if(items.length){ const rows=items.map(it=>({...it, order_id:order.id})); const { error:itemErr } = await supabase.from('order_items').insert(rows); if(itemErr) throw itemErr; }
      resetOrderForm(); toast(`Ordine ${order.order_number} creato correttamente.`); navigate('mine');
    } catch(err){ console.error(err); toast('Errore creazione ordine: ' + (err.message||err)); }
    finally{ $('#SubmitOrder').disabled=false; $('#SubmitOrder').textContent='Invia ordine'; }
  }

  async function fetchItems(orderIds){
    if(!orderIds.length) return {};
    const { data } = await supabase.from('order_items').select('*').in('order_id', orderIds).order('created_at');
    return (data||[]).reduce((acc,it)=>{ (acc[it.order_id] ||= []).push(it); return acc; },{});
  }

  async function renderMine(){
    const box=$('#MyOrdersList'); box.innerHTML='<div class="empty">Caricamento ordini...</div>';
    const { data, error } = await supabase.from('orders').select('*').order('created_at',{ascending:false});
    if(error){ box.innerHTML=`<div class="empty">Errore: ${esc(error.message)}</div>`; return; }
    const itemsByOrder = await fetchItems((data||[]).map(o=>o.id));
    myOrdersCache = (data||[]).map(o=>({...o, items:itemsByOrder[o.id]||[]}));
    drawMineList();
  }

  function filterRows(rows, scope){
    const q = $('#'+scope+'Search').value.trim().toLowerCase();
    const st = $('#'+scope+'StatusFilter').value;
    const pr = $('#'+scope+'PriorityFilter').value;
    const dt = $('#'+scope+'DateFilter').value;
    return rows.filter(o => {
      const hay = [o.order_number,o.subject,o.project_name,o.commessa,o.request_type,o.profile?.email,o.profile?.full_name].join(' ').toLowerCase();
      return (!q || hay.includes(q)) && (!st || o.status===st) && (!pr || o.priority===pr) && (!dt || dateKey(o.created_at)===dt);
    });
  }

  function drawMineList(){
    const rows = filterRows(myOrdersCache, 'Mine');
    $('#MyOrdersList').innerHTML = rows.length ? rows.map(o=>orderCard(o, o.items||[], false)).join('') : '<div class="empty">Nessun ordine trovato.</div>';
    bindOrderAccordions('#MyOrdersList');
  }

  async function renderAdmin(){
    if(profile?.role !== 'admin') return;
    const box=$('#AdminOrdersList'); box.innerHTML='<div class="empty">Caricamento ordini admin...</div>';
    const { data:orders, error } = await supabase.from('orders').select('*').order('created_at',{ascending:false});
    if(error){ box.innerHTML=`<div class="empty">Errore: ${esc(error.message)}</div>`; return; }
    const userIds=[...new Set((orders||[]).map(o=>o.user_id))]; let profiles={};
    if(userIds.length){ const { data:p } = await supabase.from('profiles').select('*').in('id', userIds); profiles=(p||[]).reduce((a,x)=>{a[x.id]=x; return a;},{}); }
    const itemsByOrder = await fetchItems((orders||[]).map(o=>o.id));
    adminOrdersCache = (orders||[]).map(o=>({...o, profile:profiles[o.user_id]||{}, items:itemsByOrder[o.id]||[]}));
    drawAdminList();
  }

  function drawAdminList(){
    const rows = filterRows(adminOrdersCache, 'Admin');
    $('#AdminOrdersList').innerHTML = rows.length ? rows.map(o=>orderCard(o, o.items||[], true)).join('') : '<div class="empty">Nessun ordine trovato.</div>';
    bindOrderAccordions('#AdminOrdersList');
    bindAdminDirty();
  }

  function bindOrderAccordions(scope){
    $$(scope+' .order-summary').forEach(btn=>btn.addEventListener('click',()=>btn.closest('.order-card').classList.toggle('is-open')));
  }

  function pcType(o, items){ return items[0]?.item_type || o.request_type || 'Altro'; }
  function orderCard(o, items, isAdmin){
    const user = isAdmin ? `<div class="admin-user">${esc(o.profile?.full_name || 'Utente')} · ${esc(o.profile?.email || o.user_id)}</div>` : '';
    const itemHtml = items.length ? `<div class="items-mini"><strong>Righe:</strong><ul>${items.map(i=>`<li>${esc(i.quantity)}× ${esc(i.item_title)} <span class="muted">(${esc(i.item_type)})</span></li>`).join('')}</ul></div>` : '';
    const adminHtml = isAdmin ? `<div class="admin-edit-grid" data-id="${o.id}"><div class="admin-field"><label>Stato</label><select class="input admin-status" data-id="${o.id}" data-original="${esc(o.status)}">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v.label}</option>`).join('')}</select></div><div class="admin-field"><label>Nota visibile</label><textarea class="input admin-public" data-id="${o.id}" data-original="${esc(o.public_note||'')}" placeholder="Nota per utente">${esc(o.public_note||'')}</textarea></div><div class="admin-field"><label>Nota interna</label><textarea class="input admin-internal" data-id="${o.id}" data-original="${esc(o.internal_note||'')}" placeholder="Nota interna admin">${esc(o.internal_note||'')}</textarea></div><button type="button" class="btn-primary admin-save" data-id="${o.id}" disabled>Salva</button></div>` : '';
    const openClass = isAdmin ? ' admin-card' : '';
    const type = pcType(o,items);
    const summary = `<button type="button" class="order-summary"><div class="order-cell"><span class="order-number">${esc(o.order_number)}</span></div><div class="order-cell"><strong class="order-title">${esc(o.subject)}</strong>${user}</div><div class="order-cell"><small>Cantiere</small><strong>${esc(o.project_name||'—')}</strong></div><div class="order-cell"><small>Commessa</small><strong>${esc(o.commessa||'—')}</strong></div><div class="order-cell summary-tags">${priorityBadge(o.priority)}<span class="status-badge status-inviato">${esc(type)}</span></div><div class="order-cell">${statusBadge(o.status)}</div><div class="order-cell"><span class="order-chevron">⌄</span></div></button>`;
    const detail = `<div class="order-detail"><p class="order-desc">${esc(o.description)}</p><div class="detail-grid"><div><small>Progetto/Cantiere</small><strong>${esc(o.project_name||'—')}</strong></div><div><small>Commessa</small><strong>${esc(o.commessa||'—')}</strong></div><div><small>Consegna richiesta</small><strong>${esc(o.requested_delivery_date ? fmtDate(o.requested_delivery_date) : '—')}</strong></div><div><small>Creato il</small><strong>${esc(fmtDate(o.created_at))}</strong></div></div>${o.public_note?`<div class="items-mini"><strong>Nota admin:</strong><p class="muted">${esc(o.public_note)}</p></div>`:''}${itemHtml}<div class="order-footer">${progress(o.status)}<span class="muted">${STATUS[o.status]?.pct||10}%</span></div>${adminHtml}</div>`;
    return `<article class="order-card${openClass}" data-id="${o.id}">${summary}${detail}</article>`;
  }

  function bindAdminDirty(){
    $$('#AdminOrdersList .admin-edit-grid').forEach(grid => {
      const id = grid.dataset.id;
      const save = grid.querySelector('.admin-save');
      const fields = Array.from(grid.querySelectorAll('.admin-status,.admin-public,.admin-internal'));
      const check = () => {
        const dirty = fields.some(f => String(f.value || '') !== String(f.dataset.original || ''));
        save.disabled = !dirty;
      };
      fields.forEach(f => f.addEventListener('input', check));
      fields.forEach(f => f.addEventListener('change', check));
      save.addEventListener('click',()=>saveAdminOrder(id));
      check();
    });
  }

  async function saveAdminOrder(id){
    const status=$(`.admin-status[data-id="${id}"]`).value;
    const public_note=$(`.admin-public[data-id="${id}"]`).value.trim() || null;
    const internal_note=$(`.admin-internal[data-id="${id}"]`).value.trim() || null;
    const old = adminOrdersCache.find(o=>o.id===id);
    const { error } = await supabase.from('orders').update({status, public_note, internal_note}).eq('id', id);
    if(error){ toast('Errore aggiornamento: '+error.message); return; }
    if(old && old.status !== status){ await supabase.from('order_status_history').insert({ order_id:id, old_status:old.status, new_status:status, changed_by:session.user.id }); }
    toast('Ordine aggiornato.'); await renderAdmin(); await renderStats();
  }

  function syncDashboardMode(){
    const charts = $('#DashboardCharts'), stats = $('#DashboardStats'), btn = $('#ToggleDashboardView');
    if(!charts || !stats || !btn) return;
    charts.classList.toggle('hidden', dashboardMode !== 'charts');
    stats.classList.toggle('hidden', dashboardMode !== 'boxes');
    btn.textContent = dashboardMode === 'charts' ? 'Vista box' : 'Vista grafici';
  }
  function toggleDashboardMode(){ dashboardMode = dashboardMode === 'charts' ? 'boxes' : 'charts'; localStorage.setItem('abitare_lavorazioni_dashboard_mode', dashboardMode); syncDashboardMode(); renderStats(); }

  async function refreshAll(){ await renderStats(true); if(!$('#MineView').classList.contains('hidden')) await renderMine(); if(profile?.role==='admin' && !$('#AdminView').classList.contains('hidden')) await renderAdmin(); }
  async function renderStats(){
    const { data=[] } = await supabase.from('orders').select('status,priority');
    const counts = Object.keys(STATUS).reduce((a,k)=>(a[k]=0,a),{}); data.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);
    $('#DashboardStats').innerHTML = `<div class="stat-card"><small>Totale ordini visibili</small><strong>${data.length}</strong></div><div class="stat-card"><small>In lavorazione</small><strong>${counts.in_lavorazione||0}</strong></div><div class="stat-card"><small>Attesa feedback</small><strong>${counts.attesa_feedback||0}</strong></div><div class="stat-card"><small>Completati</small><strong>${counts.completato||0}</strong></div>`;
    $('#DashboardCharts').innerHTML = makeDonutCard('Stato ordini', counts, Object.fromEntries(Object.entries(STATUS).map(([k,v])=>[k,{label:v.label,color:v.color}])), data.length);
    syncDashboardMode();
  }

  function makeDonutCard(title, counts, meta, total){
    const entries = Object.entries(counts).filter(([,v])=>v>0);
    const safeTotal = Math.max(1,total||0); let offset = 25;
    const circles = entries.map(([k,v],idx)=>{ const pct=(v/safeTotal)*100; const c=meta[k]?.color || '#ddd'; const html=`<circle class="donut-segment" r="36" cx="50" cy="50" stroke="${c}" pathLength="100" stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="${offset}" style="animation-delay:${idx*60}ms"></circle>`; offset -= pct; return html; }).join('');
    const legend = Object.entries(meta).map(([k,m])=>`<div class="legend-row"><div class="legend-left"><span class="legend-dot" style="background:${m.color}"></span><span>${m.label}</span></div><span class="legend-count">${counts[k]||0}</span></div>`).join('');
    return `<div class="chart-card"><div class="chart-title">${esc(title)}</div><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 100 100"><circle class="donut-bg" r="36" cx="50" cy="50"></circle>${circles}</svg><div class="donut-center"><strong>${total||0}</strong><span>ordini</span></div></div><div class="chart-legend">${legend}</div></div>`;
  }

  document.addEventListener('DOMContentLoaded', init);
})();

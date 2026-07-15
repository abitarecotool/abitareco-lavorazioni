(() => {
  'use strict';

  const cfg = window.ABITARE_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const arr = (v) => Array.isArray(v) ? v : [];

  const STATUS = {
    inviato: { label:'Inviato', pct:10, color:'#2a2a2a' },
    presa_in_carica: { label:'Presa in carica', pct:25, color:'#2a2a2a' },
    in_lavorazione: { label:'In lavorazione', pct:50, color:'#5c47cd' },
    stand_by: { label:'Stand-by', pct:50, color:'#c36522' },
    attesa_feedback: { label:'Attesa feedback', pct:75, color:'#ffc53d' },
    completato: { label:'Completato', pct:100, color:'#2c8c5e' }
  };

  const WORK_TYPES = [
    ['sito-web','Sito web','Richiesta landing, sito o aggiornamenti web.','#eae3da'],
    ['landing-page','Landing page','Pagina dedicata a campagna, progetto o iniziativa.','#e8e8e8'],
    ['brochure','Brochure','Impaginato commerciale, istituzionale o progetto.','#e9a0a7'],
    ['flyer','Flyer','Volantini, cartoline, inviti e materiali brevi.','#f1f5f9'],
    ['presentazione','Presentazione','Slide, pitch, report o presentazioni commerciali.','#eae3da'],
    ['dem-newsletter','DEM / Newsletter','Comunicazioni email e materiali digitali.','#e8e8e8'],
    ['post-social','Post social','Creatività social, caroselli, reel cover e adattamenti.','#e9a0a7'],
    ['cartellonistica','Cartellonistica','Pannelli, vetrofanie, maxi-formati e segnaletica.','#f1f5f9'],
    ['materiale-stampa','Materiale stampa','File pronti per produzione e materiali offline.','#eae3da'],
    ['video-reel','Video / Reel','Video brevi, reel, slideshow e motion output.','#e8e8e8'],
    ['altro','Altro','Richiesta non presente in elenco o lavoro speciale.','#f1f5f9']
  ].map(([key,label,copy,fallback]) => ({ key, label, copy, fallback }));

  const PRIORITY_LABELS = { bassa:'Bassa', media:'Media', alta:'Alta', urgente:'Urgente' };
  const USER_COLORS = ['#c4162b','#4c1428','#e9a0a7','#787878','#e8e8e8','#eae3da','#1a1b1b'];

  let session = null;
  let profile = null;
  let profiles = [];
  let selectedWorks = new Set();
  let selectedCollabs = new Set();
  let myOrdersCache = [];
  let sharedOrdersCache = [];
  let adminOrdersCache = [];
  let dashboardOrdersCache = [];
  let dashboardMode = localStorage.getItem('abitare_lavorazioni_dashboard_mode') || 'charts';

  function esc(s){ return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function toast(msg){ const t=$('#Toast'); if(!t) return alert(msg); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),3500); }
  function showAuth(show){ $('#AuthOverlay')?.classList.toggle('hidden', !show); $('#AppRoot')?.classList.toggle('hidden', show); }
  function setLoading(show){ $('#AuthPreloader')?.classList.toggle('hidden', !show); }
  function fmtDate(v){ if(!v) return '—'; try{return new Intl.DateTimeFormat('it-IT').format(new Date(v));}catch{return v;} }
  function dateKey(v){ if(!v) return ''; try{return new Date(v).toISOString().slice(0,10);}catch{return String(v).slice(0,10);} }
  function priorityBadge(p){ return `<span class="priority-badge priority-${p || 'media'}">${esc(PRIORITY_LABELS[p] || 'Media')}</span>`; }
  function statusBadge(st){ const s=STATUS[st] || STATUS.inviato; return `<span class="status-badge status-${st || 'inviato'}">${s.label}</span>`; }
  function progress(st){ const s=STATUS[st] || STATUS.inviato; return `<div class="progressbar progress-${st || 'inviato'}"><span style="width:${s.pct}%"></span></div>`; }

  function syncMenuIcons(){
    $$('#SideMenu li').forEach(li => {
      const img = li.querySelector('.mi img');
      const fb = li.querySelector('.mi-fallback');
      if(!img) return;
      img.onerror = () => { img.style.display='none'; if(fb) fb.style.display='inline'; };
      img.onload = () => { img.style.display='block'; if(fb) fb.style.display='none'; };
      img.src = li.classList.contains('active') ? li.dataset.iconActive : li.dataset.icon;
    });
  }

  async function init(){
    fillStatusSelects();
    bindUI();
    renderWorkTypes();
    syncDashboardMode();
    syncMenuIcons();

    const { data } = await supabase.auth.getSession();
    session = data.session;
    setTimeout(() => setLoading(false), 400);

    if(!session){ showAuth(true); return; }
    try{
      await loadProfile();
      await loadProfiles();
      showAuth(false);
      await refreshAll();
    }catch(e){
      console.error(e);
      showAuth(true);
      $('#AuthError').textContent = e.message || 'Errore caricamento sessione.';
    }

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      if(!session){ profile=null; showAuth(true); return; }
      try{
        await loadProfile();
        await loadProfiles();
        showAuth(false);
        await refreshAll();
      }catch(e){ console.error(e); $('#AuthError').textContent = e.message || 'Errore caricamento dati.'; }
    });
  }

  async function loadProfile(){
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if(error) throw error;
    profile = data;
    if(profile.active === false){ await supabase.auth.signOut(); throw new Error('Account disattivato.'); }
    $('#UserLabel').textContent = profile.full_name || profile.email;
    $('#UserRole').textContent = (profile.role || 'user').toUpperCase();
    $('#UserAvatar').textContent = (profile.full_name || profile.email || 'A').slice(0,1).toUpperCase();
    const isAdmin = profile.role === 'admin';
    $('#AdminMenuItem')?.classList.toggle('hidden', !isAdmin);
    $('#MineMenuItem')?.classList.toggle('hidden', isAdmin);
    $('#DashboardFilters')?.classList.toggle('hidden', !isAdmin);
  }

  async function loadProfiles(){
    const { data, error } = await supabase.from('profiles').select('*').eq('active', true).order('full_name');
    if(error){ console.warn(error); profiles=[]; }
    else profiles = arr(data);
    renderCollabPicker();
  }

  function bindUI(){
    $('#AuthTogglePassword')?.addEventListener('click', () => { const p=$('#AuthPassword'); p.type = p.type === 'password' ? 'text' : 'password'; });
    $('#AuthConfirm')?.addEventListener('click', login);
    $('#AuthPassword')?.addEventListener('keydown', e => { if(e.key === 'Enter') login(); });
    $('#BtnLogout')?.addEventListener('click', () => supabase.auth.signOut());
    $('#UserMenu')?.addEventListener('click', () => $('#UserDropdown')?.classList.toggle('hidden'));
    $$('#SideMenu li').forEach(li => li.addEventListener('click', () => navigate(li.dataset.view)));
    $('#RefreshAll')?.addEventListener('click', refreshAll);
    $('#ToggleDashboardView')?.addEventListener('click', toggleDashboardMode);
    $('#RefreshMine')?.addEventListener('click', renderMine);
    $('#RefreshAdmin')?.addEventListener('click', renderAdmin);
    ['MineSearch','MineStatusFilter','MinePriorityFilter','MineDateFilter'].forEach(id => $('#'+id)?.addEventListener('input', drawMineList));
    ['AdminSearch','AdminStatusFilter','AdminPriorityFilter','AdminDateFilter'].forEach(id => $('#'+id)?.addEventListener('input', drawAdminList));
    ['DashUserFilter','DashStatusFilter','DashPriorityFilter','DashDateFilter'].forEach(id => $('#'+id)?.addEventListener('input', drawDashboard));
    $('#ResetOrderForm')?.addEventListener('click', resetOrderForm);
    $('#OrderForm')?.addEventListener('submit', submitOrder);
    $('#CollabToggle')?.addEventListener('click', () => $('#CollabPanel')?.classList.toggle('hidden'));
    document.addEventListener('click', e => { if(!e.target.closest('#CollabPicker')) $('#CollabPanel')?.classList.add('hidden'); });
  }

  async function login(){
    $('#AuthError').textContent = '';
    const email=$('#AuthEmail').value.trim();
    const password=$('#AuthPassword').value;
    if(!email || !password){ $('#AuthError').textContent='Inserisci email e password.'; return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) $('#AuthError').textContent = error.message || 'Credenziali non valide.';
  }

  function fillStatusSelects(){
    const html = '<option value="">Tutti gli stati</option>' + Object.entries(STATUS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
    ['MineStatusFilter','AdminStatusFilter','DashStatusFilter'].forEach(id => { const el=$('#'+id); if(el) el.innerHTML=html; });
  }

  function navigate(view){
    if(view === 'admin' && profile?.role !== 'admin') return;
    if(view === 'mine' && profile?.role === 'admin') view = 'admin';
    $$('.view').forEach(v => v.classList.add('hidden'));
    const map = { dashboard:'#DashboardView', create:'#CreateView', mine:'#MineView', admin:'#AdminView' };
    $(map[view] || map.dashboard).classList.remove('hidden');
    $$('#SideMenu li').forEach(li => li.classList.toggle('active', li.dataset.view === view));
    syncMenuIcons();
    if(view === 'dashboard') renderStats();
    if(view === 'mine') renderMine();
    if(view === 'admin') renderAdmin();
  }

  function renderQuickCards(){
    const isAdmin = profile?.role === 'admin';
    const cards = isAdmin ? [
      ['create','icon-create-order-selected.png','Crea nuovo ordine','Inserisci una lavorazione interna.'],
      ['admin','icon-admin-orders-selected.png','Admin ordini','Gestisci richieste, stati e priorità.']
    ] : [
      ['create','icon-create-order-selected.png','Crea nuovo ordine','Invia una nuova richiesta di lavorazione.'],
      ['mine','icon-my-orders-selected.png','I miei ordini','Controlla lo stato dei tuoi ordini.']
    ];
    $('#DashboardQuickCards').innerHTML = cards.map(([go,icon,t,s]) => `<button class="welcome-card" data-go="${go}"><span class="card-icon"><img src="./assets/icons/${icon}" alt="" /></span><span><strong>${t}</strong><small>${s}</small></span></button>`).join('');
    $$('[data-go]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));
  }

  function renderWorkTypes(){
    const grid = $('#WorkTypeGrid');
    if(!grid) return;
    grid.innerHTML = WORK_TYPES.map(w => `<article class="worktype-card" data-key="${w.key}"><button type="button" class="worktype-add">+</button><div class="worktype-preview" style="background:${w.fallback}">${[1,2,3].map((n,i)=>`<img class="${i===0?'active':''}" src="./assets/work-types/${w.key}/0${n}.jpg" alt="${esc(w.label)} preview" onerror="this.remove()" />`).join('')}</div><div class="worktype-body"><div class="worktype-title">${esc(w.label)}</div><div class="worktype-copy">${esc(w.copy)}</div></div></article>`).join('');
    $$('.worktype-card').forEach(card => card.addEventListener('click', () => toggleWork(card.dataset.key)));
  }

  function toggleWork(key){ selectedWorks.has(key) ? selectedWorks.delete(key) : selectedWorks.add(key); syncWorkSelection(); }
  function syncWorkSelection(){
    $$('.worktype-card').forEach(c => { const on=selectedWorks.has(c.dataset.key); c.classList.toggle('is-selected', on); c.querySelector('.worktype-add').textContent = on ? '−' : '+'; });
    const items = WORK_TYPES.filter(w => selectedWorks.has(w.key));
    $('#SelectedWorkWrap')?.classList.toggle('hidden', !items.length);
    const list = $('#SelectedWorkList'); if(!list) return;
    list.innerHTML = items.map(w => `<div class="selected-work-row"><div><strong>${esc(w.label)}</strong><span class="muted">${esc(w.copy)}</span></div><button type="button" class="selected-work-remove" data-key="${w.key}">×</button></div>`).join('');
    $$('.selected-work-remove').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); selectedWorks.delete(b.dataset.key); syncWorkSelection(); }));
  }

  function renderCollabPicker(){
    const panel = $('#CollabPanel'); if(!panel) return;
    const users = profiles.filter(p => p.role !== 'admin' && p.id !== session?.user?.id);
    panel.innerHTML = users.length ? users.map(p => `<label class="collab-option"><input type="checkbox" value="${p.id}" ${selectedCollabs.has(p.id)?'checked':''}/><span>${esc(p.full_name || p.email)}</span></label>`).join('') : '<div class="muted">Nessun utente disponibile.</div>';
    $$('#CollabPanel input').forEach(ch => ch.addEventListener('change', () => { ch.checked ? selectedCollabs.add(ch.value) : selectedCollabs.delete(ch.value); updateCollabToggle(); }));
    updateCollabToggle();
  }

  function updateCollabToggle(){
    const names = profiles.filter(p => selectedCollabs.has(p.id));
    $('#CollabToggle').textContent = names.length ? `${names.length} collaborator${names.length>1?'i':'e'} selezionat${names.length>1?'i':'o'}` : 'Seleziona collaboratori';
  }

  function resetOrderForm(){ $('#OrderForm').reset(); $('#Priority').value='media'; selectedWorks.clear(); selectedCollabs.clear(); syncWorkSelection(); renderCollabPicker(); }
  function selectedWorkItems(){ return WORK_TYPES.filter(w => selectedWorks.has(w.key)).map(w => ({ item_type:w.label, item_title:w.label, item_description:w.copy, quantity:1 })); }

  async function notifyZapier(order, items, payload){
    const url = cfg.ZAPIER_NEW_ORDER_WEBHOOK_URL; if(!url) return;
    try{
      const first = items[0] || {};
      const body = new URLSearchParams({ event_type:'order_created', order_id:order.id||'', order_number:order.order_number||'', subject:order.subject||payload.subject||'', description:order.description||payload.description||'', status:order.status||'inviato', status_label:STATUS[order.status||'inviato']?.label||'Inviato', priority:order.priority||payload.priority||'media', priority_label:PRIORITY_LABELS[order.priority||payload.priority||'media']||'Media', request_type:first.item_type||order.request_type||'', project_name:order.project_name||payload.project_name||'', commessa:order.commessa||payload.commessa||'', requested_delivery_date:order.requested_delivery_date||payload.requested_delivery_date||'', created_at:order.created_at||new Date().toISOString(), user_name:profile?.full_name||profile?.email||session?.user?.email||'', user_email:profile?.email||session?.user?.email||'', item_count:String(items.length||0), items_summary:items.map(it=>`${it.quantity||1} x ${it.item_title||''} (${it.item_type||''})`).join(' | '), portal_url:location.origin+location.pathname });
      await fetch(url, { method:'POST', mode:'no-cors', body });
    }catch(e){ console.warn('Zapier skipped', e); }
  }

  async function submitOrder(e){
    e.preventDefault();
    const items = selectedWorkItems();
    if(!items.length){ toast('Seleziona almeno un tipo di lavorazione.'); return; }
    const project=$('#ProjectName').value.trim();
    const commessa=$('#Commessa').value.trim();
    const notes=$('#OrderNotes').value.trim();
    const typeList=items.map(i=>i.item_title).join(', ');
    const payload = { user_id:session.user.id, request_type:items[0].item_type, project_name:project||null, commessa:commessa||null, subject:`${typeList}${project?' · '+project:''}`, description:notes || `Richiesta lavorazioni: ${typeList}${project?' per '+project:''}${commessa?' / '+commessa:''}.`, priority:$('#Priority').value, requested_delivery_date:$('#DeliveryDate').value||null, status:'inviato' };
    $('#SubmitOrder').disabled = true; $('#SubmitOrder').textContent = 'Invio...';
    try{
      const { data:order, error } = await supabase.from('orders').insert(payload).select('*').single();
      if(error) throw error;
      const { error:itemErr } = await supabase.from('order_items').insert(items.map(it => ({...it, order_id:order.id})));
      if(itemErr) throw itemErr;
      if(selectedCollabs.size){
        try{ await supabase.from('order_collaborators').insert([...selectedCollabs].map(user_id => ({ order_id:order.id, user_id }))); }
        catch(collabErr){ console.warn('Collab non salvato (migrazione non eseguita?)', collabErr); }
      }
      await notifyZapier(order, items, payload);
      resetOrderForm(); toast(`Ordine ${order.order_number} creato correttamente.`); navigate(profile?.role === 'admin' ? 'admin' : 'mine');
    }catch(err){ toast('Errore creazione ordine: ' + (err.message || err)); }
    finally{ $('#SubmitOrder').disabled=false; $('#SubmitOrder').textContent='Invia ordine'; }
  }

  async function fetchItems(ids){ if(!ids.length) return {}; const {data,error}=await supabase.from('order_items').select('*').in('order_id',ids).order('created_at'); if(error){console.warn(error); return{};} return arr(data).reduce((a,it)=>{(a[it.order_id] ||= []).push(it); return a;},{}); }
  async function fetchProfiles(ids){ if(!ids.length) return {}; const {data,error}=await supabase.from('profiles').select('*').in('id',ids); if(error){console.warn(error); return{};} return arr(data).reduce((a,p)=>{a[p.id]=p; return a;},{}); }
  async function fetchSharedOrders(){
    try{ const {data:links,error}=await supabase.from('order_collaborators').select('order_id').eq('user_id',session.user.id); if(error) throw error; const ids=arr(links).map(x=>x.order_id); if(!ids.length) return []; const {data,error:e2}=await supabase.from('orders').select('*').in('id',ids).order('created_at',{ascending:false}); if(e2) throw e2; return arr(data); }catch(e){ return []; }
  }

  async function renderMine(){
    const box=$('#MyOrdersList'); box.innerHTML='<div class="empty">Caricamento ordini...</div>';
    const {data,error}=await supabase.from('orders').select('*').order('created_at',{ascending:false});
    if(error){box.innerHTML=`<div class="empty">Errore: ${esc(error.message)}</div>`; return;}
    const own=arr(data); const shared=await fetchSharedOrders();
    const all=[...own,...shared.filter(s=>!own.some(o=>o.id===s.id))];
    const items=await fetchItems(all.map(o=>o.id));
    myOrdersCache=all.map(o=>({...o, items:items[o.id]||[], is_shared:shared.some(s=>s.id===o.id)}));
    sharedOrdersCache=myOrdersCache.filter(o=>o.is_shared);
    drawMineList();
  }

  async function renderAdmin(){
    if(profile?.role !== 'admin') return;
    const box=$('#AdminOrdersList'); box.innerHTML='<div class="empty">Caricamento ordini admin...</div>';
    const {data,error}=await supabase.from('orders').select('*').order('created_at',{ascending:false});
    if(error){box.innerHTML=`<div class="empty">Errore: ${esc(error.message)}</div>`; return;}
    const rows=arr(data);
    const prof=await fetchProfiles([...new Set(rows.map(o=>o.user_id))]);
    const items=await fetchItems(rows.map(o=>o.id));
    adminOrdersCache=rows.map(o=>({...o, profile:prof[o.user_id]||{}, items:items[o.id]||[]}));
    drawAdminList();
  }

  function filterRows(rows, scope){
    const q=$('#'+scope+'Search')?.value.trim().toLowerCase()||'';
    const st=$('#'+scope+'StatusFilter')?.value||'';
    const pr=$('#'+scope+'PriorityFilter')?.value||'';
    const dt=$('#'+scope+'DateFilter')?.value||'';
    const user=$('#'+scope+'UserFilter')?.value||'';
    return arr(rows).filter(o=>{const hay=[o.order_number,o.subject,o.project_name,o.commessa,o.request_type,o.profile?.email,o.profile?.full_name].join(' ').toLowerCase(); return(!q||hay.includes(q))&&(!st||o.status===st)&&(!pr||o.priority===pr)&&(!dt||dateKey(o.created_at)===dt)&&(!user||o.user_id===user);});
  }

  function drawMineList(){ const rows=filterRows(myOrdersCache,'Mine'); $('#MyOrdersList').innerHTML=rows.length?rows.map(o=>orderCard(o,o.items||[],false)).join(''):'<div class="empty">Nessun ordine trovato.</div>'; bindOrderAccordions('#MyOrdersList'); }
  function drawAdminList(){ const rows=filterRows(adminOrdersCache,'Admin'); $('#AdminOrdersList').innerHTML=rows.length?rows.map(o=>orderCard(o,o.items||[],true)).join(''):'<div class="empty">Nessun ordine trovato.</div>'; bindOrderAccordions('#AdminOrdersList'); bindAdminDirty(); }
  function bindOrderAccordions(scope){ $$(scope+' .order-summary').forEach(btn=>btn.addEventListener('click',()=>btn.closest('.order-card').classList.toggle('is-open'))); }

  function orderCard(o, items, isAdmin){
    const type=items[0]?.item_type || o.request_type || 'Altro';
    const user=isAdmin?`<div class="admin-user">${esc(o.profile?.full_name||'Utente')} · ${esc(o.profile?.email||o.user_id)}</div>`:'';
    const shared=o.is_shared?'<span class="status-badge status-inviato">Condiviso</span>':'';
    const itemHtml=items.length?`<div class="items-mini"><strong>Righe:</strong><ul>${items.map(i=>`<li>${esc(i.quantity)}× ${esc(i.item_title)} <span class="muted">(${esc(i.item_type)})</span></li>`).join('')}</ul></div>`:'';
    const adminData=isAdmin?`<div class="admin-data-grid"><div class="admin-field"><label>Progetto/Cantiere</label><input class="input admin-project" data-original="${esc(o.project_name||'')}" value="${esc(o.project_name||'')}" /></div><div class="admin-field"><label>Commessa</label><input class="input admin-commessa" data-original="${esc(o.commessa||'')}" value="${esc(o.commessa||'')}" /></div><div class="admin-field"><label>Consegna richiesta</label><input type="date" class="input admin-delivery" data-original="${esc(o.requested_delivery_date||'')}" value="${esc(o.requested_delivery_date||'')}" /></div><div class="admin-field"><label>Oggetto</label><input class="input admin-subject" data-original="${esc(o.subject||'')}" value="${esc(o.subject||'')}" /></div></div>`:'';
    const adminHtml=isAdmin?`<div class="admin-edit-grid"><div class="admin-field"><label>Stato</label><select class="input admin-status" data-original="${esc(o.status)}">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v.label}</option>`).join('')}</select></div><div class="admin-field"><label>Nota visibile</label><textarea class="input admin-public" data-original="${esc(o.public_note||'')}">${esc(o.public_note||'')}</textarea></div><div class="admin-field"><label>Nota interna</label><textarea class="input admin-internal" data-original="${esc(o.internal_note||'')}">${esc(o.internal_note||'')}</textarea></div><div class="admin-actions-row"><button type="button" class="btn-primary admin-save" disabled>Salva</button><button type="button" class="btn-danger admin-delete">Elimina</button></div></div>`:'';
    return `<article class="order-card${isAdmin?' admin-card':''}" data-id="${o.id}"><button type="button" class="order-summary"><div class="order-cell"><span class="order-number">${esc(o.order_number)}</span></div><div class="order-cell"><strong class="order-title">${esc(o.subject)}</strong>${user}</div><div class="order-cell"><small>Cantiere</small><strong>${esc(o.project_name||'—')}</strong></div><div class="order-cell"><small>Commessa</small><strong>${esc(o.commessa||'—')}</strong></div><div class="order-cell summary-tags">${priorityBadge(o.priority)}<span class="status-badge status-inviato">${esc(type)}</span>${statusBadge(o.status)}${shared}</div><div class="order-cell"><strong>${esc(o.requested_delivery_date?fmtDate(o.requested_delivery_date):'—')}</strong><small>Consegna</small></div><div class="order-cell"><span class="order-chevron">⌄</span></div></button><div class="order-detail"><p class="order-desc">${esc(o.description)}</p><div class="detail-grid"><div><small>Progetto/Cantiere</small><strong>${esc(o.project_name||'—')}</strong></div><div><small>Commessa</small><strong>${esc(o.commessa||'—')}</strong></div><div><small>Consegna richiesta</small><strong>${esc(o.requested_delivery_date?fmtDate(o.requested_delivery_date):'—')}</strong></div><div><small>Creato il</small><strong>${esc(fmtDate(o.created_at))}</strong></div></div>${adminData}${o.public_note?`<div class="items-mini"><strong>Nota admin:</strong><p class="muted">${esc(o.public_note)}</p></div>`:''}${itemHtml}<div class="order-footer">${progress(o.status)}<span class="muted">${STATUS[o.status]?.pct||10}%</span></div>${adminHtml}</div></article>`;
  }

  function bindAdminDirty(){
    $$('#AdminOrdersList .order-card').forEach(card=>{
      const id=card.dataset.id, save=card.querySelector('.admin-save');
      const fields=Array.from(card.querySelectorAll('.admin-status,.admin-public,.admin-internal,.admin-project,.admin-commessa,.admin-delivery,.admin-subject'));
      const check=()=>save.disabled=!fields.some(f=>String(f.value||'')!==String(f.dataset.original||''));
      fields.forEach(f=>{f.addEventListener('input',check);f.addEventListener('change',check);});
      save.addEventListener('click',()=>saveAdminOrder(card,id));
      card.querySelector('.admin-delete')?.addEventListener('click',()=>deleteAdminOrder(id));
      check();
    });
  }

  async function saveAdminOrder(card,id){
    const payload={ status:card.querySelector('.admin-status').value, public_note:card.querySelector('.admin-public').value.trim()||null, internal_note:card.querySelector('.admin-internal').value.trim()||null, project_name:card.querySelector('.admin-project').value.trim()||null, commessa:card.querySelector('.admin-commessa').value.trim()||null, requested_delivery_date:card.querySelector('.admin-delivery').value||null, subject:card.querySelector('.admin-subject').value.trim()||'Senza oggetto' };
    const old=adminOrdersCache.find(o=>o.id===id);
    const {error}=await supabase.from('orders').update(payload).eq('id',id);
    if(error){toast('Errore aggiornamento: '+error.message); return;}
    if(old&&old.status!==payload.status) await supabase.from('order_status_history').insert({order_id:id,old_status:old.status,new_status:payload.status,changed_by:session.user.id});
    toast('Ordine aggiornato.'); await renderAdmin(); await renderStats();
  }
  async function deleteAdminOrder(id){ if(!confirm('Vuoi eliminare definitivamente questo ordine?')) return; const {error}=await supabase.from('orders').delete().eq('id',id); if(error){toast('Errore eliminazione: '+error.message);return;} toast('Ordine eliminato.'); await renderAdmin(); await renderStats(); }

  async function refreshAll(){ renderQuickCards(); await renderStats(); if(!$('#MineView')?.classList.contains('hidden')) await renderMine(); if(profile?.role==='admin' && !$('#AdminView')?.classList.contains('hidden')) await renderAdmin(); }
  async function renderStats(){
    let rows=[];
    try{ const {data,error}=await supabase.from('orders').select('*').order('created_at',{ascending:false}); if(error) throw error; rows=arr(data); } catch(e){ console.warn('orders stats failed', e); rows=[]; }
    let prof={}; if(profile?.role==='admin') prof=await fetchProfiles([...new Set(rows.map(o=>o.user_id))]);
    dashboardOrdersCache=rows.map(o=>({...o,profile:prof[o.user_id]||{}}));
    populateDashUsers(); drawDashboard();
  }
  function populateDashUsers(){ const sel=$('#DashUserFilter'); if(!sel||profile?.role!=='admin') return; const current=sel.value; const users=[...new Map(dashboardOrdersCache.map(o=>[o.user_id,o.profile])).entries()]; sel.innerHTML='<option value="">Tutti gli utenti</option>'+users.map(([id,p])=>`<option value="${id}">${esc(p.full_name||p.email||id)}</option>`).join(''); sel.value=current; }
  function syncDashboardMode(){ $('#DashboardCharts')?.classList.toggle('hidden',dashboardMode!=='charts'); $('#DashboardStats')?.classList.toggle('hidden',dashboardMode!=='boxes'); const b=$('#ToggleDashboardView'); if(b)b.textContent=dashboardMode==='charts'?'Vista box':'Vista grafici'; }
  function toggleDashboardMode(){ dashboardMode=dashboardMode==='charts'?'boxes':'charts'; localStorage.setItem('abitare_lavorazioni_dashboard_mode',dashboardMode); syncDashboardMode(); drawDashboard(); }
  function countByStatus(rows){ const c=Object.keys(STATUS).reduce((a,k)=>(a[k]=0,a),{}); arr(rows).forEach(o=>c[o.status]=(c[o.status]||0)+1); return c; }
  function drawDashboard(){
    const isAdmin=profile?.role==='admin';
    const data=filterRows(dashboardOrdersCache,'Dash');
    const counts=countByStatus(data);
    $('#DashboardStats').innerHTML=`<div class="stat-card"><small>${isAdmin?'Ordini totali':'I miei ordini'}</small><strong data-count="${data.length}">0</strong></div><div class="stat-card"><small>In lavorazione</small><strong data-count="${counts.in_lavorazione||0}">0</strong></div><div class="stat-card"><small>Stand-by</small><strong data-count="${counts.stand_by||0}">0</strong></div><div class="stat-card"><small>Completati</small><strong data-count="${counts.completato||0}">0</strong></div>`;
    animateNumbers();
    if(isAdmin){
      $('#DashboardTitle').textContent='Dashboard lavorazioni'; $('#DashboardSubtitle').textContent='Panoramica ordini, utenti e avanzamento lavori.';
      const byUser={}; data.forEach(o=>{ const id=o.user_id; (byUser[id] ||= {profile:o.profile,orders:[]}).orders.push(o); });
      $('#DashboardCharts').innerHTML = makeDonutCard('Totale stato ordini',counts,data.length,'wide') + Object.values(byUser).map(u=>makeDonutCard(`${esc(u.profile.full_name||u.profile.email||'Utente')} · ${u.orders.length} ordini`,countByStatus(u.orders),u.orders.length,'user-chart')).join('');
    } else {
      const owned=dashboardOrdersCache.filter(o=>o.user_id===session.user.id);
      $('#DashboardTitle').textContent='Dashboard personale'; $('#DashboardSubtitle').textContent='Stati dei miei ordini, totale ordini e ordini condivisi.';
      $('#DashboardCharts').innerHTML = makeDonutCard('Stati dei miei ordini',countByStatus(owned),owned.length,'') + makeDonutCard('Ordini condivisi',countByStatus(sharedOrdersCache),sharedOrdersCache.length,'');
    }
    syncDashboardMode();
  }
  function animateNumbers(){ setTimeout(()=>$$('[data-count]').forEach(el=>{const to=Number(el.dataset.count||0), start=performance.now(); const tick=t=>{const p=Math.min(1,(t-start)/650); el.textContent=String(Math.round(to*p)); if(p<1)requestAnimationFrame(tick);}; requestAnimationFrame(tick);}),20); }
  function makeDonutCard(title,counts,total,extra=''){
    const entries=Object.entries(counts).filter(([,v])=>v>0); const safe=Math.max(1,total||0); let offset=25;
    const circles=entries.map(([k,v],idx)=>{const pct=v/safe*100, color=STATUS[k]?.color||USER_COLORS[idx%USER_COLORS.length]; const out=`<circle class="donut-segment" r="36" cx="50" cy="50" stroke="${color}" pathLength="100" stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="${offset}" style="animation-delay:${idx*60}ms"></circle>`; offset-=pct; return out;}).join('');
    const legend=Object.entries(STATUS).map(([k,s])=>`<div class="legend-row"><div class="legend-left"><span class="legend-dot" style="background:${s.color}"></span><span>${s.label}</span></div><span class="legend-count">${counts[k]||0}</span></div>`).join('');
    return `<div class="chart-card ${extra}"><div class="chart-title">${title}</div><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 100 100"><circle class="donut-bg" r="36" cx="50" cy="50"></circle>${circles}</svg><div class="donut-center"><strong>${total||0}</strong><span>ordini</span></div></div><div class="chart-legend">${legend}</div></div>`;
  }

  document.addEventListener('DOMContentLoaded', init);
})();

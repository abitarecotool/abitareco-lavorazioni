(() => {
  'use strict';
  const cfg = window.ABITARE_CONFIG;
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const STATUS = {
    inviato: { label:'Inviato', pct:10 },
    presa_in_carica: { label:'Presa in carica', pct:25 },
    in_lavorazione: { label:'In lavorazione', pct:50 },
    stand_by: { label:'Stand-by', pct:50 },
    attesa_feedback: { label:'Attesa feedback', pct:75 },
    completato: { label:'Completato', pct:100 },
  };
  const TYPES = ['Sito web','Landing page','Brochure','Flyer','Presentazione','DEM / Newsletter','Post social','Cartellonistica','Materiale stampa','Video / Reel','Altro'];
  let session = null;
  let profile = null;
  let adminOrdersCache = [];

  function toast(msg){ const t=$('#Toast'); if(!t) return alert(msg); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 3800); }
  function esc(s){ return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function fmtDate(v){ if(!v) return '—'; try{return new Intl.DateTimeFormat('it-IT').format(new Date(v));}catch{return v;} }
  function statusBadge(st){ const x=STATUS[st]||STATUS.inviato; return `<span class="status-badge status-${st}">${x.label}</span>`; }
  function priorityBadge(p){ return `<span class="priority-badge priority-${p||'media'}">${esc((p||'media').toUpperCase())}</span>`; }
  function progress(st){ const x=STATUS[st]||STATUS.inviato; return `<div class="progressbar" title="${x.label}"><span style="width:${x.pct}%"></span></div>`; }
  function showAuth(show){ $('#AuthOverlay').classList.toggle('hidden', !show); $('#AppRoot').classList.toggle('hidden', show); }
  function setLoading(show){ $('#AuthPreloader').classList.toggle('hidden', !show); }

  async function loadProfile(){
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if(error) throw error;
    profile = data;
    if(profile.active === false){ await supabase.auth.signOut(); throw new Error('Account disattivato. Contatta Billy o Mattia.'); }
    $('#UserLabel').textContent = profile.full_name || profile.email;
    $('#UserRole').textContent = profile.role;
    $('#UserAvatar').textContent = (profile.full_name || profile.email || 'A').trim().slice(0,1).toUpperCase();
    $('#AdminMenuItem').classList.toggle('hidden', profile.role !== 'admin');
  }

  async function init(){
    fillSelects(); bindUI(); addItemRow();
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
    const req=$('#RequestType'); req.innerHTML = TYPES.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const sf=$('#AdminStatusFilter'); sf.innerHTML = '<option value="">Tutti gli stati</option>' + Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
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
    $('#RefreshMine').addEventListener('click', renderMine);
    $('#RefreshAdmin').addEventListener('click', renderAdmin);
    $('#AdminStatusFilter').addEventListener('change', drawAdminList);
    $('#AdminSearch').addEventListener('input', drawAdminList);
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
    if(view==='mine') renderMine();
    if(view==='admin') renderAdmin();
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
    const payload={
      user_id: session.user.id,
      request_type: $('#RequestType').value,
      project_name: $('#ProjectName').value.trim() || null,
      commessa: $('#Commessa').value.trim() || null,
      subject: $('#Subject').value.trim(),
      description: $('#Description').value.trim(),
      priority: $('#Priority').value,
      requested_delivery_date: $('#DeliveryDate').value || null,
      status: 'inviato'
    };
    if(!payload.subject || !payload.description){ toast('Compila oggetto e descrizione.'); return; }
    $('#SubmitOrder').disabled=true; $('#SubmitOrder').textContent='Invio...';
    try{
      const { data:order, error } = await supabase.from('orders').insert(payload).select('*').single();
      if(error) throw error;
      if(items.length){
        const rows=items.map(it=>({...it, order_id:order.id}));
        const { error:itemErr } = await supabase.from('order_items').insert(rows);
        if(itemErr) throw itemErr;
      }
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
    box.innerHTML = data?.length ? data.map(o=>orderCard(o, itemsByOrder[o.id]||[], false)).join('') : '<div class="empty">Non hai ancora creato ordini.</div>';
  }

  async function renderAdmin(){
    if(profile?.role !== 'admin') return;
    const box=$('#AdminOrdersList'); box.innerHTML='<div class="empty">Caricamento ordini admin...</div>';
    const { data:orders, error } = await supabase.from('orders').select('*').order('created_at',{ascending:false});
    if(error){ box.innerHTML=`<div class="empty">Errore: ${esc(error.message)}</div>`; return; }
    const userIds=[...new Set((orders||[]).map(o=>o.user_id))];
    let profiles={};
    if(userIds.length){
      const { data:p } = await supabase.from('profiles').select('*').in('id', userIds);
      profiles=(p||[]).reduce((a,x)=>{a[x.id]=x; return a;},{});
    }
    const itemsByOrder = await fetchItems((orders||[]).map(o=>o.id));
    adminOrdersCache = (orders||[]).map(o=>({...o, profile:profiles[o.user_id]||{}, items:itemsByOrder[o.id]||[]}));
    drawAdminList();
  }

  function drawAdminList(){
    const st=$('#AdminStatusFilter').value; const q=$('#AdminSearch').value.trim().toLowerCase();
    let rows=adminOrdersCache;
    if(st) rows=rows.filter(o=>o.status===st);
    if(q) rows=rows.filter(o=>[o.order_number,o.subject,o.project_name,o.commessa,o.profile?.email,o.profile?.full_name,o.request_type].join(' ').toLowerCase().includes(q));
    $('#AdminOrdersList').innerHTML = rows.length ? rows.map(o=>orderCard(o, o.items||[], true)).join('') : '<div class="empty">Nessun ordine trovato.</div>';
    $$('#AdminOrdersList .admin-save').forEach(btn=>btn.addEventListener('click',()=>saveAdminOrder(btn.dataset.id)));
  }

  function orderCard(o, items, isAdmin){
    const user = isAdmin ? `<div class="admin-user">${esc(o.profile?.full_name || 'Utente')} · ${esc(o.profile?.email || o.user_id)}</div>` : '';
    const itemHtml = items.length ? `<div class="items-mini"><strong>Righe:</strong><ul>${items.map(i=>`<li>${esc(i.quantity)}× ${esc(i.item_title)} <span class="muted">(${esc(i.item_type)})</span></li>`).join('')}</ul></div>` : '';
    const adminHtml = isAdmin ? `<div class="admin-actions"><div><label>Stato</label><select class="input admin-status" data-id="${o.id}">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${o.status===k?'selected':''}>${v.label}</option>`).join('')}</select></div><div><label>Nota visibile</label><textarea class="input admin-public" data-id="${o.id}" placeholder="Nota per utente">${esc(o.public_note||'')}</textarea></div><div><label>Nota interna</label><textarea class="input admin-internal" data-id="${o.id}" placeholder="Nota interna admin">${esc(o.internal_note||'')}</textarea></div><button type="button" class="btn-primary admin-save" data-id="${o.id}">Salva</button></div>` : '';
    return `<article class="order-card"><div class="order-card-top"><div><div class="order-number">${esc(o.order_number)}</div><div class="order-title">${esc(o.subject)}</div>${user}</div><div>${statusBadge(o.status)}</div></div><div class="order-meta">${priorityBadge(o.priority)}<span class="status-badge status-inviato">${esc(o.request_type)}</span></div><p class="order-desc">${esc(o.description)}</p><div class="detail-grid"><div><small>Progetto/Cantiere</small><strong>${esc(o.project_name||'—')}</strong></div><div><small>Commessa</small><strong>${esc(o.commessa||'—')}</strong></div><div><small>Consegna richiesta</small><strong>${esc(o.requested_delivery_date ? fmtDate(o.requested_delivery_date) : '—')}</strong></div><div><small>Creato il</small><strong>${esc(fmtDate(o.created_at))}</strong></div></div>${o.public_note?`<div class="items-mini"><strong>Nota admin:</strong><p class="muted">${esc(o.public_note)}</p></div>`:''}${itemHtml}<div class="order-footer">${progress(o.status)}<span class="muted">${STATUS[o.status]?.pct||10}%</span></div>${adminHtml}</article>`;
  }

  async function saveAdminOrder(id){
    const status=$(`.admin-status[data-id="${id}"]`).value;
    const public_note=$(`.admin-public[data-id="${id}"]`).value.trim() || null;
    const internal_note=$(`.admin-internal[data-id="${id}"]`).value.trim() || null;
    const old = adminOrdersCache.find(o=>o.id===id);
    const { error } = await supabase.from('orders').update({status, public_note, internal_note}).eq('id', id);
    if(error){ toast('Errore aggiornamento: '+error.message); return; }
    if(old && old.status !== status){ await supabase.from('order_status_history').insert({ order_id:id, old_status:old.status, new_status:status, changed_by:session.user.id }); }
    toast('Ordine aggiornato.'); await renderAdmin();
  }

  async function refreshAll(){ await renderStats(); if(!$('#MineView').classList.contains('hidden')) await renderMine(); if(profile?.role==='admin' && !$('#AdminView').classList.contains('hidden')) await renderAdmin(); }
  async function renderStats(){
    const { data=[] } = await supabase.from('orders').select('status');
    const counts = Object.keys(STATUS).reduce((a,k)=>(a[k]=0,a),{}); data.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);
    $('#DashboardStats').innerHTML = `<div class="stat-card"><small>Totale ordini visibili</small><strong>${data.length}</strong></div><div class="stat-card"><small>In lavorazione</small><strong>${counts.in_lavorazione||0}</strong></div><div class="stat-card"><small>Attesa feedback</small><strong>${counts.attesa_feedback||0}</strong></div><div class="stat-card"><small>Completati</small><strong>${counts.completato||0}</strong></div>`;
  }

  document.addEventListener('DOMContentLoaded', init);
})();

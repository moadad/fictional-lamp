const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbz7keF7gxmTrmA7CupQCVVMpWGTuRv-F5HiiPKKYBbpYw8raoDRL9_5nTVyRun8rzBEhw/exec';
const STORAGE_KEYS = {
  apiUrl: 'orders_api_url',
  installDismissed: 'orders_install_dismissed',
  apiHealthy: 'orders_api_healthy'
};

const state = {
  readyOnly: false,
  clients: [],
  currentClient: null,
  currentClientModels: [],
  deferredPrompt: null,
  role: '',
  apiUrl: localStorage.getItem(STORAGE_KEYS.apiUrl) || DEFAULT_API_URL
};

const el = {};
window.addEventListener('DOMContentLoaded', init);

function init(){
  bindEls();
  wireEvents();
  el.apiUrlInput.value = state.apiUrl;
  checkInstallBanner();
  registerSW();
}

function bindEls(){
  [
    'installBanner','installBtn','dismissInstallBtn','drawerBackdrop','drawer','closeDrawerBtn','openDrawerBtn','adminPanel','apiUrlInput','saveApiUrlBtn','resetApiUrlBtn',
    'loginView','appView','usernameInput','passwordInput','loginBtn','loginError','statusLine','refreshBtn','tabAllBtn','tabReadyBtn','goSearchBtn','goModelsBtn','printCurrentBtn',
    'dashboardView','clientDetailView','searchView','modelsView','summaryBar','clientsTableWrap','listTitle','detailClientName','detailMeta','detailTableWrap','backToListBtn','deliverBtn','detailPrintBtn',
    'searchInput','searchResults','modelsContainer','printModelsBtn'
  ].forEach(id => el[id] = document.getElementById(id));
}

function wireEvents(){
  el.loginBtn.addEventListener('click', doLogin);
  [el.usernameInput, el.passwordInput].forEach(i => i.addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); }));
  el.openDrawerBtn.addEventListener('click', openDrawer);
  el.closeDrawerBtn.addEventListener('click', closeDrawer);
  el.drawerBackdrop.addEventListener('click', closeDrawer);
  document.querySelectorAll('.drawer-link').forEach(btn => btn.addEventListener('click', () => handleDrawerNav(btn.dataset.nav)));
  el.refreshBtn.addEventListener('click', () => loadDashboard(false));
  el.tabAllBtn.addEventListener('click', () => setReadyOnly(false));
  el.tabReadyBtn.addEventListener('click', () => setReadyOnly(true));
  el.goSearchBtn.addEventListener('click', () => showView('searchView'));
  el.goModelsBtn.addEventListener('click', () => { showView('modelsView'); loadModels(); });
  el.printCurrentBtn.addEventListener('click', printCurrent);
  el.backToListBtn.addEventListener('click', () => showView('dashboardView'));
  el.detailPrintBtn.addEventListener('click', () => window.print());
  el.printModelsBtn.addEventListener('click', () => window.print());
  el.deliverBtn.addEventListener('click', deliverCurrentClient);
  el.searchInput.addEventListener('input', debounce(doSearch, 250));
  el.installBtn.addEventListener('click', promptInstall);
  el.dismissInstallBtn.addEventListener('click', dismissInstallBanner);
  el.saveApiUrlBtn.addEventListener('click', saveApiUrl);
  el.resetApiUrlBtn.addEventListener('click', resetApiUrl);
}

function handleDrawerNav(nav){
  closeDrawer();
  if(nav === 'dashboard') showView('dashboardView');
  if(nav === 'search') showView('searchView');
  if(nav === 'models') { showView('modelsView'); loadModels(); }
  if(nav === 'print') printCurrent();
  if(nav === 'admin') el.adminPanel.classList.toggle('hidden');
}

function openDrawer(){
  el.drawer.classList.add('open');
  el.drawerBackdrop.classList.remove('hidden');
}
function closeDrawer(){
  el.drawer.classList.remove('open');
  el.drawerBackdrop.classList.add('hidden');
}

function showView(id){
  [el.dashboardView, el.clientDetailView, el.searchView, el.modelsView].forEach(v => v.classList.remove('active'));
  el[id].classList.add('active');
}

function setStatus(text, isError=false){
  el.statusLine.textContent = text || '';
  el.statusLine.style.color = isError ? '#b62727' : '';
}

function setReadyOnly(flag){
  state.readyOnly = !!flag;
  el.tabAllBtn.classList.toggle('active', !state.readyOnly);
  el.tabReadyBtn.classList.toggle('active', state.readyOnly);
  loadDashboard(false);
}

async function doLogin(){
  hideError();
  const user = el.usernameInput.value.trim();
  const pass = el.passwordInput.value.trim();
  if(!user || !pass){
    showError('أدخل اسم المستخدم وكلمة المرور');
    return;
  }
  el.loginBtn.disabled = true;
  setStatus('جاري تسجيل الدخول...');
  try{
    const res = await apiCall('login', { user, pass });
    if(!res || !res.ok) throw new Error('بيانات الدخول غير صحيحة');
    state.role = res.role || '';
    el.loginView.classList.add('hidden');
    el.appView.classList.remove('hidden');
    showView('dashboardView');
    await loadDashboard(false);
  }catch(err){
    showError(err.message || 'فشل تسجيل الدخول');
    setStatus('تعذر الاتصال بالنظام', true);
  }finally{
    el.loginBtn.disabled = false;
  }
}

async function loadDashboard(silent=true){
  try{
    if(!silent) setStatus('جاري تحميل العملاء...');
    const data = await apiCall('getDashboardClients', { readyOnly: state.readyOnly ? '1' : '0' });
    state.clients = Array.isArray(data) ? data : [];
    renderSummary();
    renderClientsTable();
    setStatus(state.readyOnly ? 'عرض العملاء الجاهزين' : 'عرض كل العملاء');
  }catch(err){
    setStatus(err.message || 'تعذر تحميل العملاء', true);
  }
}

function renderSummary(){
  const totalClients = state.clients.length;
  const totalRequired = state.clients.reduce((a,b)=>a + Number(b.required||0),0);
  const totalDelivered = state.clients.reduce((a,b)=>a + Number(b.delivered||0),0);
  const totalRemaining = state.clients.reduce((a,b)=>a + Number(b.remaining||0),0);
  el.summaryBar.innerHTML = [
    ['العملاء', totalClients],
    ['المطلوب', totalRequired],
    ['المسلم', totalDelivered],
    ['المتبقي', totalRemaining]
  ].map(([label, value]) => `
    <div class="summary-card glass-card">
      <div class="summary-label">${esc(label)}</div>
      <div class="summary-value">${esc(value)}</div>
    </div>`).join('');
}

function renderClientsTable(){
  el.listTitle.textContent = state.readyOnly ? 'العملاء الجاهزون' : 'كل العملاء';
  if(!state.clients.length){
    el.clientsTableWrap.innerHTML = '<div class="empty-box">لا توجد بيانات</div>';
    return;
  }
  const rows = state.clients.map(c => `
    <tr>
      <td><button class="client-link" data-client="${escAttr(c.client)}">${esc(c.client)}</button></td>
      <td>${esc(c.invoices || '-')}</td>
      <td>${esc(c.required || 0)}</td>
      <td>${esc(c.delivered || 0)}</td>
      <td>${esc(c.remaining || 0)}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>`).join('');

  el.clientsTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>العميل</th>
          <th>الفواتير</th>
          <th>المطلوب</th>
          <th>المسلم</th>
          <th>المتبقي</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  el.clientsTableWrap.querySelectorAll('.client-link').forEach(btn => {
    btn.addEventListener('click', () => openClient(btn.dataset.client));
  });
}

async function openClient(client){
  const selected = state.clients.find(c => c.client === client) || { client };
  state.currentClient = selected;
  setStatus('جاري تحميل تفاصيل العميل...');
  try{
    const models = await apiCall('getClientModels', { client, readyOnly: state.readyOnly ? '1' : '0' });
    state.currentClientModels = Array.isArray(models) ? models : [];
    renderClientDetail();
    showView('clientDetailView');
    setStatus(`تفاصيل طلبية ${client}`);
  }catch(err){
    setStatus(err.message || 'تعذر تحميل العميل', true);
  }
}

function renderClientDetail(){
  const c = state.currentClient || {};
  el.detailClientName.textContent = c.client || '';
  el.detailMeta.textContent = `الفواتير: ${c.invoices || '-'} | المطلوب: ${c.required || 0} | المسلم: ${c.delivered || 0} | المتبقي: ${c.remaining || 0}`;

  const rows = state.currentClientModels.map((m, idx) => {
    const stockBadge = Number(m.stockQty || 0) > 0 ? '<span class="badge available">متاح</span>' : '<span class="badge unavailable">غير متوفر</span>';
    const deliveredNote = Number(m.delivered || 0) > 0 ? '<span class="note-text">تم التسليم</span>' : '-';
    const max = Math.max(0, Number(m.remaining || 0));
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(m.model)}</td>
        <td>${esc(m.required || 0)}</td>
        <td>${esc(m.delivered || 0)}</td>
        <td>${esc(m.remaining || 0)}</td>
        <td>${stockBadge}</td>
        <td>${deliveredNote}</td>
        <td><input class="qty-input" type="number" min="1" max="${max}" data-model="${escAttr(m.model)}" ${max < 1 ? 'disabled' : ''}></td>
      </tr>`;
  }).join('');

  el.detailTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>الموديل</th>
          <th>المطلوب</th>
          <th>المسلم</th>
          <th>المتبقي</th>
          <th>التوفر</th>
          <th>ملاحظة</th>
          <th>تسليم</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8">لا توجد عناصر</td></tr>'}</tbody>
    </table>`;
}

async function deliverCurrentClient(){
  if(!state.currentClient) return;
  const items = [...el.detailTableWrap.querySelectorAll('input[data-model]')]
    .map(inp => ({ model: inp.dataset.model, qty: Number(inp.value || 0) }))
    .filter(x => x.model && x.qty > 0);
  if(!items.length){
    alert('حدد كمية لموديل واحد أو أكثر');
    return;
  }
  el.deliverBtn.disabled = true;
  setStatus('جاري تنفيذ التسليم...');
  try{
    const res = await apiCall('deliverModels', {
      client: state.currentClient.client,
      items: JSON.stringify(items)
    }, 'POST');
    if(!res || res.ok === false) throw new Error(res?.message || 'فشل التسليم');
    await openClient(state.currentClient.client);
    await loadDashboard(true);
    alert('تم التسليم بنجاح');
  }catch(err){
    alert(err.message || 'تعذر تنفيذ التسليم');
    setStatus(err.message || 'تعذر تنفيذ التسليم', true);
  }finally{
    el.deliverBtn.disabled = false;
  }
}

async function doSearch(){
  const keyword = el.searchInput.value.trim();
  if(!keyword){
    el.searchResults.innerHTML = '';
    return;
  }
  try{
    const data = await apiCall('searchClients', { keyword });
    const list = Array.isArray(data) ? data : [];
    el.searchResults.innerHTML = list.length ? list.map(c => `<div class="search-item" data-client="${escAttr(c)}">${esc(c)}</div>`).join('') : '<div class="search-item">لا توجد نتائج</div>';
    el.searchResults.querySelectorAll('[data-client]').forEach(item => item.addEventListener('click', () => openClient(item.dataset.client)));
  }catch(err){
    el.searchResults.innerHTML = `<div class="search-item">${esc(err.message || 'تعذر البحث')}</div>`;
  }
}

async function loadModels(){
  el.modelsContainer.innerHTML = '<div class="search-item">جاري تحميل الموديلات...</div>';
  try{
    const data = await apiCall('getModelsByPrefix', {});
    const keys = Object.keys(data || {});
    if(!keys.length){
      el.modelsContainer.innerHTML = '<div class="search-item">لا توجد بيانات</div>';
      return;
    }
    el.modelsContainer.innerHTML = keys.map(prefix => {
      const arr = data[prefix] || [];
      const total = arr.reduce((a,b)=>a + Number(b.total || 0),0);
      const rows = arr.map(m => `
        <tr>
          <td>${esc(m.model)}</td>
          <td>${esc(m.total)}</td>
          <td>${(m.clients || []).map(c => `${esc(c.client)} (${esc(c.qty)})`).join('<br>')}</td>
        </tr>`).join('');
      return `
        <div class="model-group">
          <div class="model-group-head">بادئة ${esc(prefix)} | مجموع المطلوب: ${esc(total)}</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>الموديل</th><th>المطلوب</th><th>تفصيل العملاء</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
  }catch(err){
    el.modelsContainer.innerHTML = `<div class="search-item">${esc(err.message || 'تعذر تحميل الموديلات')}</div>`;
  }
}

function printCurrent(){
  window.print();
}

async function apiCall(action, params={}, method='GET'){
  const base = (state.apiUrl || '').trim();
  if(!base) throw new Error('رابط الربط غير مضبوط');

  const requestTimeout = 20000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

  try{
    let url = base;
    const payload = { action, ...params };
    const options = { method, signal: controller.signal, headers: {} };

    if(method === 'GET'){
      const qs = new URLSearchParams(payload).toString();
      url += (base.includes('?') ? '&' : '?') + qs;
    }else{
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }

    const res = await fetch(url, options);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error('الربط الحالي لا يعيد JSON صحيح');
    }
    if(json && json.error) throw new Error(json.error);
    return json.data !== undefined ? json.data : json;
  }catch(err){
    if(err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    throw err;
  }finally{
    clearTimeout(timeoutId);
  }
}

function saveApiUrl(){
  const val = el.apiUrlInput.value.trim();
  if(!val) return;
  state.apiUrl = val;
  localStorage.setItem(STORAGE_KEYS.apiUrl, val);
  alert('تم حفظ الرابط');
}

function resetApiUrl(){
  state.apiUrl = DEFAULT_API_URL;
  localStorage.setItem(STORAGE_KEYS.apiUrl, DEFAULT_API_URL);
  el.apiUrlInput.value = DEFAULT_API_URL;
  alert('تم إرجاع الرابط الافتراضي');
}

function showError(msg){
  el.loginError.textContent = msg;
  el.loginError.classList.remove('hidden');
}
function hideError(){
  el.loginError.classList.add('hidden');
  el.loginError.textContent = '';
}
function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escAttr(v){ return esc(v); }
function statusBadge(status){
  const s = String(status || '');
  if(s === 'مكتمل') return '<span class="badge ready">مكتمل</span>';
  if(s === 'جزئي') return '<span class="badge partial">جزئي</span>';
  return '<span class="badge pending">لم يبدأ</span>';
}
function debounce(fn, wait){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}
function checkInstallBanner(){
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredPrompt = e;
    if(localStorage.getItem(STORAGE_KEYS.installDismissed) !== '1'){
      el.installBanner.classList.remove('hidden');
    }
  });
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
    el.installBanner.classList.add('hidden');
  });
}
async function promptInstall(){
  if(!state.deferredPrompt) return dismissInstallBanner();
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  dismissInstallBanner();
}
function dismissInstallBanner(){
  localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
  el.installBanner.classList.add('hidden');
}

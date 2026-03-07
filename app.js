const STORAGE = {
  apiUrl: 'jood_api_url',
  installHidden: 'jood_install_hidden',
  auth: 'jood_auth',
};

const state = {
  apiUrl: '',
  auth: null,
  readyOnly: false,
  currentClient: null,
  installPrompt: null,
  autoRefreshTimer: null,
  summary: null,
  clients: [],
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.style.background = isError ? '#b71c1c' : '#10243e';
  el.classList.add('show');
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

function setApiStatus(text, sub = '', ok = false) {
  $('apiStatus').textContent = text;
  $('apiStatusSub').textContent = sub;
  $('apiStatus').style.color = ok ? '#7CFFAA' : '#fff';
}

function saveAuth() {
  localStorage.setItem(STORAGE.apiUrl, state.apiUrl || '');
  localStorage.setItem(STORAGE.auth, JSON.stringify(state.auth || null));
}

function loadSaved() {
  state.apiUrl = localStorage.getItem(STORAGE.apiUrl) || 'https://script.google.com/macros/s/AKfycbwQh7CkbQuvYojMNPFpRBNXttqX5qnaaPp_HItXCJxipifIan2mGfAvEY23Ewm5gg7oTA/exec';
  try { state.auth = JSON.parse(localStorage.getItem(STORAGE.auth) || 'null'); } catch { state.auth = null; }
  $('apiUrlInput').value = state.apiUrl;
  $('settingsApiUrl').value = state.apiUrl;
}

function apiUrl(action, params = {}) {
  const base = (state.apiUrl || '').trim();
  const url = new URL(base);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!state.apiUrl) return reject(new Error('ضع رابط الـ Web App أولًا'));
    const cb = '__jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('انتهت مهلة الاتصال بالـ API'));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cb];
      script.remove();
    }

    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('فشل تحميل البيانات من Apps Script')); };
    params.callback = cb;
    script.src = apiUrl(action, params);
    document.body.appendChild(script);
  });
}

async function testConnection() {
  const data = await jsonp('ping');
  if (!data?.ok) throw new Error(data?.error || 'فشل الاتصال');
  setApiStatus('متصل', 'Apps Script جاهز', true);
  $('settingsMsg').textContent = 'تم الاتصال بنجاح';
  return data;
}

function showSection(sectionId) {
  document.querySelectorAll('.screen-block').forEach((el) => el.classList.remove('active'));
  $(sectionId).classList.add('active');
  document.querySelectorAll('.side-link').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === sectionId));
  if (window.innerWidth <= 780) $('sidebar').classList.remove('open');
}

function switchToApp() {
  $('loginSection').classList.remove('active');
  $('appSection').classList.add('active');
}

function switchToLogin() {
  $('appSection').classList.remove('active');
  $('loginSection').classList.add('active');
}

async function doLogin() {
  try {
    state.apiUrl = $('apiUrlInput').value.trim();
    $('loginMsg').textContent = 'جارٍ التحقق...';
    const user = $('usernameInput').value.trim();
    const pass = $('passwordInput').value.trim();
    const res = await jsonp('login', { user, pass });
    if (!res?.ok) throw new Error('بيانات الدخول غير صحيحة');
    state.auth = { user, role: res.role || '' };
    saveAuth();
    $('loginMsg').textContent = '';
    switchToApp();
    await refreshAll();
    startAutoRefresh();
    toast('تم تسجيل الدخول بنجاح');
  } catch (err) {
    $('loginMsg').textContent = err.message || 'فشل تسجيل الدخول';
    toast(err.message || 'فشل تسجيل الدخول', true);
  }
}

async function refreshSummary() {
  const res = await jsonp('summary');
  if (!res?.ok) throw new Error(res?.error || 'تعذر تحميل الملخص');
  state.summary = res.data;
  const cards = [
    ['إجمالي العملاء', res.data.allClients],
    ['العملاء الجاهزون', res.data.readyClients],
    ['إجمالي المطلوب', res.data.totalRequired],
    ['إجمالي المسلم', res.data.totalDelivered],
    ['إجمالي المتبقي', res.data.totalRemaining],
    ['إجمالي المخزون', res.data.stockQtyTotal],
  ];
  $('statsGrid').innerHTML = cards.map(([label, value]) => `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${fmt(value)}</div>
    </div>`).join('');
  $('lastSyncLabel').textContent = 'آخر تحديث: ' + new Date().toLocaleString('ar-EG');
}

async function loadClients(readyOnly = state.readyOnly, target = 'clientsTableBody', preview = false) {
  state.readyOnly = !!readyOnly;
  const res = await jsonp('dashboard', { readyOnly: String(!!readyOnly) });
  if (!res?.ok) throw new Error(res?.error || 'تعذر تحميل العملاء');
  state.clients = res.data || [];
  $('clientsModeLabel').textContent = readyOnly ? 'عرض: العملاء الجاهزين' : 'عرض: كل العملاء';
  $('filterAllBtn').classList.toggle('active', !readyOnly);
  $('filterReadyBtn').classList.toggle('active', readyOnly);
  $('clientsAllBtn').classList.toggle('active', !readyOnly);
  $('clientsReadyBtn').classList.toggle('active', readyOnly);

  if (preview) {
    const list = state.clients.slice(0, 8).map(renderPreviewCard).join('') || '<div class="preview-card">لا توجد بيانات</div>';
    $(target).innerHTML = list;
    bindOpenClientButtons();
    return;
  }

  $(target).innerHTML = state.clients.map((c) => `
    <tr>
      <td><b>${esc(c.client)}</b></td>
      <td>${fmt(c.required)}</td>
      <td>${fmt(c.delivered)}</td>
      <td>${fmt(c.remaining)}</td>
      <td>${renderStatus(c.status)}</td>
      <td>${fmt((c.readyModels || []).length)}</td>
      <td><button class="table-btn open-client" data-client="${esc(c.client)}">فتح</button></td>
    </tr>`).join('') || '<tr><td colspan="7">لا توجد بيانات</td></tr>';
  bindOpenClientButtons();
}

function renderStatus(status) {
  const cls = status === 'مكتمل' ? 'green' : status === 'جزئي' ? 'orange' : 'red';
  return `<span class="pill ${cls}">${status}</span>`;
}

function renderPreviewCard(c) {
  return `
    <div class="preview-card">
      <div class="preview-top">
        <div>
          <div class="preview-title">${esc(c.client)}</div>
          <div class="muted">${renderStatus(c.status)}</div>
        </div>
        <button class="table-btn open-client" data-client="${esc(c.client)}">فتح الطلبية</button>
      </div>
      <div class="preview-stats">
        <span class="mini-chip">المطلوب: ${fmt(c.required)}</span>
        <span class="mini-chip">المسلم: ${fmt(c.delivered)}</span>
        <span class="mini-chip">المتبقي: ${fmt(c.remaining)}</span>
      </div>
    </div>`;
}

function bindOpenClientButtons() {
  document.querySelectorAll('.open-client').forEach((btn) => {
    btn.onclick = () => openClient(btn.dataset.client);
  });
}

async function openClient(client) {
  state.currentClient = client;
  const res = await jsonp('clientModels', { client, readyOnly: String(!!state.readyOnly) });
  if (!res?.ok) throw new Error(res?.error || 'تعذر تحميل تفاصيل العميل');
  const models = res.data || [];
  $('clientDetailsCard').classList.remove('hidden');
  $('clientDetailsTitle').textContent = client;
  $('clientDetailsSub').textContent = 'يمكنك التسليم من نهاية الطلبية لموديل واحد أو أكثر.';
  $('clientSummaryRow').innerHTML = [
    ['عدد الموديلات', models.length],
    ['إجمالي المتبقي', models.reduce((a, b) => a + Number(b.remaining || 0), 0)],
    ['إجمالي المتوفر', models.reduce((a, b) => a + Number(b.stockQty || 0), 0)],
    ['قابل للتسليم الآن', models.reduce((a, b) => a + Number(b.availableToDeliver || 0), 0)],
  ].map(([l, v]) => `<div class="summary-box">${l}<b>${fmt(v)}</b></div>`).join('');

  $('clientModelsBody').innerHTML = models.map((m) => {
    const max = Number(m.availableToDeliver || 0);
    const can = max > 0;
    return `
      <tr>
        <td><b>${esc(m.model)}</b></td>
        <td>${fmt(m.required)}</td>
        <td>${fmt(m.delivered)}</td>
        <td>${fmt(m.remaining)}</td>
        <td>${fmt(m.stockQty)}</td>
        <td><span class="${can ? 'status-ok' : 'status-no'}">${esc(m.availabilityText)}</span></td>
        <td>${can ? `<input class="qty-input" type="number" min="1" max="${max}" value="" data-model="${esc(m.model)}" data-max="${max}">` : '—'}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="7">لا توجد موديلات متاحة</td></tr>';

  showSection('clientsSection');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitDelivery() {
  try {
    if (!state.currentClient) throw new Error('اختر عميلًا أولًا');
    const items = [...document.querySelectorAll('#clientModelsBody .qty-input')]
      .map((input) => ({
        model: input.dataset.model,
        qty: Number(input.value || 0),
        max: Number(input.dataset.max || 0),
      }))
      .filter((x) => x.qty > 0);
    if (!items.length) throw new Error('حدد كمية للتسليم');
    for (const item of items) {
      if (item.qty > item.max) throw new Error(`الكمية أكبر من المتاح للموديل ${item.model}`);
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(items.map(({ model, qty }) => ({ model, qty })))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const res = await jsonp('deliver', { client: state.currentClient, items: encoded });
    if (!res?.ok) throw new Error(res?.error || 'فشل التسليم');
    toast('تم التسليم وخصم المخزون بنجاح');
    await refreshAll();
    await openClient(state.currentClient);
  } catch (err) {
    toast(err.message || 'فشل التسليم', true);
  }
}

async function doSearch() {
  const keyword = $('searchInput').value.trim();
  if (!keyword) { $('searchResults').innerHTML = ''; return; }
  try {
    const res = await jsonp('searchClients', { keyword });
    if (!res?.ok) throw new Error(res?.error || 'تعذر البحث');
    $('searchResults').innerHTML = (res.data || []).map((name) => `
      <div class="search-card">
        <div class="preview-top">
          <div class="preview-title">${esc(name)}</div>
          <button class="table-btn open-search-client" data-client="${esc(name)}">فتح</button>
        </div>
      </div>`).join('') || '<div class="search-card">لا توجد نتائج</div>';
    document.querySelectorAll('.open-search-client').forEach((btn) => btn.onclick = () => openClient(btn.dataset.client));
  } catch (err) {
    toast(err.message || 'فشل البحث', true);
  }
}

async function loadModels() {
  const res = await jsonp('modelsByPrefix');
  if (!res?.ok) throw new Error(res?.error || 'تعذر تحميل الموديلات');
  const data = res.data || {};
  $('modelsWrap').innerHTML = Object.keys(data).sort().map((prefix) => {
    const rows = data[prefix] || [];
    const total = rows.reduce((a, b) => a + Number(b.total || 0), 0);
    return `
      <div class="model-card">
        <div class="panel-head wrap">
          <h3>بادئة ${esc(prefix)}</h3>
          <div class="pill green">الإجمالي ${fmt(total)}</div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>الموديل</th><th>المطلوب</th><th>العملاء</th></tr></thead>
            <tbody>
              ${rows.map((r) => `<tr><td><b>${esc(r.model)}</b></td><td>${fmt(r.total)}</td><td>${(r.clients || []).map((c) => `${esc(c.client)} (${fmt(c.qty)})`).join('<br>')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('') || '<div class="model-card">لا توجد بيانات</div>';
}

async function refreshAll() {
  try {
    setApiStatus('جارٍ التحديث...', 'يتم تحميل البيانات');
    await testConnection();
    await refreshSummary();
    await loadClients(state.readyOnly, 'clientsPreview', true);
    await loadClients(state.readyOnly, 'clientsTableBody', false);
    setApiStatus('متصل', 'آخر مزامنة ناجحة', true);
  } catch (err) {
    setApiStatus('خطأ', err.message || 'فشل التحديث');
    toast(err.message || 'فشل تحميل البيانات', true);
    throw err;
  }
}

function startAutoRefresh() {
  clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    if ($('appSection').classList.contains('active')) refreshAll().catch(() => {});
  }, 30000);
}

function handleInstall() {
  if (localStorage.getItem(STORAGE.installHidden) === '1') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    $('installBanner').classList.remove('hidden');
  });
  $('dismissInstallBtn').onclick = () => {
    localStorage.setItem(STORAGE.installHidden, '1');
    $('installBanner').classList.add('hidden');
  };
  $('installBtn').onclick = async () => {
    try {
      if (!state.installPrompt) return toast('خيار التثبيت غير متاح الآن');
      await state.installPrompt.prompt();
      localStorage.setItem(STORAGE.installHidden, '1');
      $('installBanner').classList.add('hidden');
    } catch {
      toast('تعذر فتح نافذة التثبيت', true);
    }
  };
}

function bindEvents() {
  $('loginBtn').onclick = doLogin;
  $('passwordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('openSettingsBtn').onclick = () => $('settingsDrawer').classList.remove('hidden');
  $('closeSettingsBtn').onclick = () => $('settingsDrawer').classList.add('hidden');
  $('saveSettingsBtn').onclick = () => {
    state.apiUrl = $('settingsApiUrl').value.trim();
    $('apiUrlInput').value = state.apiUrl;
    saveAuth();
    $('settingsMsg').textContent = 'تم الحفظ';
    toast('تم حفظ الرابط');
  };
  $('testApiBtn').onclick = async () => {
    try {
      state.apiUrl = $('settingsApiUrl').value.trim();
      await testConnection();
      saveAuth();
      toast('الاتصال ناجح');
    } catch (err) {
      $('settingsMsg').textContent = err.message || 'فشل الاتصال';
      toast(err.message || 'فشل الاتصال', true);
    }
  };
  $('refreshAllBtn').onclick = () => refreshAll().catch(() => {});
  $('logoutBtn').onclick = () => {
    state.auth = null;
    localStorage.removeItem(STORAGE.auth);
    clearInterval(state.autoRefreshTimer);
    switchToLogin();
  };
  $('filterAllBtn').onclick = () => refreshClientsMode(false);
  $('filterReadyBtn').onclick = () => refreshClientsMode(true);
  $('clientsAllBtn').onclick = () => refreshClientsMode(false);
  $('clientsReadyBtn').onclick = () => refreshClientsMode(true);
  $('deliverNowBtn').onclick = submitDelivery;
  $('backToClientsBtn').onclick = () => $('clientDetailsCard').classList.add('hidden');
  $('searchInput').addEventListener('input', debounce(doSearch, 250));
  $('reloadModelsBtn').onclick = () => loadModels().catch((err) => toast(err.message, true));
  $('goClientsBtn').onclick = () => showSection('clientsSection');
  $('goSearchBtn').onclick = () => showSection('searchSection');
  $('goModelsBtn').onclick = async () => { showSection('modelsSection'); await loadModels(); };
  document.querySelectorAll('.side-link').forEach((btn) => btn.onclick = async () => {
    showSection(btn.dataset.section);
    if (btn.dataset.section === 'modelsSection') await loadModels();
  });
  $('mobileMenuBtn').onclick = () => $('sidebar').classList.toggle('open');
  $('toggleSidebarBtn').onclick = () => $('sidebar').classList.toggle('open');
}

async function refreshClientsMode(ready) {
  state.readyOnly = !!ready;
  await loadClients(state.readyOnly, 'clientsPreview', true);
  await loadClients(state.readyOnly, 'clientsTableBody', false);
  $('clientDetailsCard').classList.add('hidden');
}

function debounce(fn, wait) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

async function boot() {
  loadSaved();
  bindEvents();
  handleInstall();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (state.auth?.user) {
    switchToApp();
    try {
      await refreshAll();
      startAutoRefresh();
    } catch {}
  } else {
    switchToLogin();
  }
}

document.addEventListener('DOMContentLoaded', boot);

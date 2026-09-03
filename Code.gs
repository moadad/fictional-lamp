/*********** CONFIG ***********/
const SHEETS = {
  USERS: 'المستخدمين',
  ORDERS: 'الطلبيات',
  OUT: 'الصادر',
  STOCK: 'المخزون',
  PRICES: 'الاسعار',
};

const APP_INFO = {
  title: 'Jood Orders Pro',
  version: '2026.09.03-shared-google-prices-desc-c'
};

const CACHE_SECONDS = 15;

/*********** WEB APP / API ***********/
function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = _norm_(p.action);

  if (!action) {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('نظام متابعة الطلبات')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  try {
    let payload;

    switch (action) {
      case 'ping':
        payload = { ok: true, app: APP_INFO, serverTime: new Date() };
        break;

      case 'login':
        payload = login(p.user, p.pass);
        break;

      case 'dashboard':
      case 'getDashboardClients':
        payload = {
          ok: true,
          data: getDashboardClients(_bool_(p.readyOnly || p.ready))
        };
        break;

      case 'clientModels':
      case 'getClientModels':
        payload = {
          ok: true,
          data: getClientModels(p.client, _bool_(p.readyOnly || p.ready))
        };
        break;

      case 'searchClients':
        payload = {
          ok: true,
          data: searchClients(p.keyword || p.q)
        };
        break;

      case 'modelsByPrefix':
      case 'getModelsByPrefix':
      case 'models':
        payload = {
          ok: true,
          data: getModelsByPrefix()
        };
        break;

      case 'getModelPrices':
      case 'prices':
        payload = {
          ok: true,
          data: getModelPrices()
        };
        break;

      case 'summary':
        payload = {
          ok: true,
          data: getSummaryStats()
        };
        break;

      case 'deliver': {
        const items = _parseItems_(p.items);
        const delivered = deliverModels(p.client, items);
        payload = {
          ok: true,
          delivered: delivered,
          data: getSummaryStats(true)
        };
        break;
      }

      default:
        throw new Error('إجراء غير معروف: ' + action);
    }

    return _json_(payload, p.callback);
  } catch (err) {
    return _json_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    }, p.callback);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = _norm_(body.action);

    switch (action) {
      case 'deliver':
      case 'deliverModels':
        return _json_({
          ok: true,
          delivered: deliverModels(body.client, body.items || []),
          data: getSummaryStats(true)
        });

      case 'login':
        return _json_(login(body.user, body.pass));

      case 'dashboard':
      case 'getDashboardClients':
        return _json_({
          ok: true,
          data: getDashboardClients(!!body.readyOnly || !!body.ready)
        });

      case 'clientModels':
      case 'getClientModels':
        return _json_({
          ok: true,
          data: getClientModels(body.client, !!body.readyOnly || !!body.ready)
        });

      case 'searchClients':
        return _json_({
          ok: true,
          data: searchClients(body.keyword || body.q)
        });

      case 'modelsByPrefix':
      case 'getModelsByPrefix':
      case 'models':
        return _json_({
          ok: true,
          data: getModelsByPrefix()
        });

      case 'getModelPrices':
      case 'prices':
        return _json_({
          ok: true,
          data: getModelPrices()
        });

      case 'summary':
        return _json_({
          ok: true,
          data: getSummaryStats()
        });

      default:
        return _json_({ ok: false, error: 'إجراء غير معروف: ' + action });
    }
  } catch (err) {
    return _json_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

/*********** JSON / UTILS ***********/
function _json_(obj, callback) {
  const text = JSON.stringify(obj);
  if (_norm_(callback)) {
    return ContentService
      .createTextOutput(String(callback) + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function _parseItems_(raw) {
  if (Array.isArray(raw)) return raw;

  const s = _norm_(raw);
  if (!s) return [];

  try {
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString());
  } catch (_) {
    try {
      return JSON.parse(decodeURIComponent(s));
    } catch (_) {
      return JSON.parse(s);
    }
  }
}

function _bool_(v) {
  const s = _norm_(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function _ss_() { return SpreadsheetApp.getActive(); }

function _mustSheet_(name) {
  const sh = _ss_().getSheetByName(name);
  if (!sh) throw new Error('لم يتم العثور على الشيت: ' + name);
  return sh;
}

function _norm_(v) { return String(v == null ? '' : v).trim(); }

function _num_(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function _getAll_(sh) {
  const lr = sh.getLastRow();
  const lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  return sh.getRange(1, 1, lr, lc).getValues();
}

function _headerIndexMap_(headersRow) {
  const map = {};
  headersRow.forEach(function(h, i) {
    const key = _norm_(h);
    if (key) map[key] = i;
  });
  return map;
}

function _findCol_(hdrMap, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    if (Object.prototype.hasOwnProperty.call(hdrMap, candidates[i])) return hdrMap[candidates[i]];
  }
  return -1;
}

function _colOrFallback_(idx, key, fallbackIndex) {
  const v = idx[key];
  return (typeof v === 'number' && v >= 0) ? v : fallbackIndex;
}

function _readSheetSmart_(sheetName, headerCandidates) {
  const sh = _mustSheet_(sheetName);
  const values = _getAll_(sh);
  if (values.length === 0) return { sh: sh, values: [], hdr: [], idx: {}, data: [] };

  const hdr = values[0].map(_norm_);
  const hdrMap = _headerIndexMap_(hdr);
  const idx = {};

  Object.keys(headerCandidates).forEach(function(key) {
    idx[key] = _findCol_(hdrMap, headerCandidates[key]);
  });

  return {
    sh: sh,
    values: values,
    hdr: hdr,
    idx: idx,
    data: values.length > 1 ? values.slice(1) : []
  };
}

function _cache_() {
  return CacheService.getScriptCache();
}

function _cacheGetJson_(key) {
  try {
    const raw = _cache_().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function _cachePutJson_(key, value, seconds) {
  try {
    _cache_().put(key, JSON.stringify(value), seconds || CACHE_SECONDS);
  } catch (_) {}
}

function _clearCache_() {
  const keys = [
    'stock',
    'orders',
    'out',
    'dashboard_all',
    'dashboard_ready',
    'modelsByPrefix',
    'prices',
    'summary'
  ];
  try {
    _cache_().removeAll(keys);
  } catch (_) {}
}

/*********** HEADER CANDIDATES ***********/
const ORDER_COLS = {
  invoice: ['رقم الفاتورة', 'الفاتورة', 'رقم'],
  date: ['التاريخ', 'تاريخ'],
  client: ['اسم العميل', 'العميل', 'اسم الزبون', 'الزبون'],
  model: ['الموديل', 'رقم الموديل', 'رمز الصنف', 'كود الصنف', 'الصنف'],
  qty: ['الكمية المطلوبة', 'الكمية', 'كمية', 'المطلوب'],
};

const OUT_COLS = {
  invoice: ['رقم الفاتورة', 'الفاتورة', 'رقم'],
  date: ['التاريخ', 'تاريخ'],
  client: ['اسم العميل', 'العميل', 'اسم الزبون', 'الزبون'],
  model: ['الموديل', 'رقم الموديل', 'رمز الصنف', 'كود الصنف', 'الصنف'],
  qty: ['الكميه المسلمه', 'الكمية المسلمة', 'الكمية', 'كمية', 'المسلم'],
};

const STOCK_COLS = {
  model: ['الموديل', 'رقم الموديل', 'رمز الصنف', 'كود الصنف', 'الصنف'],
  qty: ['الكميه', 'الكمية', 'كمية', 'المخزون', 'متاح'],
};

const USER_COLS = {
  user: ['اسم المستخدم', 'يوزر', 'User', 'Username'],
  pass: ['كلمة المرور', 'باسورد', 'Pass', 'Password'],
  role: ['الصلاحية', 'دور', 'Role', 'الوظيفة'],
};

/*********** PRICES ***********/
function _ensurePricesSheet_() {
  const ss = _ss_();
  let sh = ss.getSheetByName(SHEETS.PRICES);

  if (!sh) {
    sh = ss.insertSheet(SHEETS.PRICES);
  }

  // الورقة المطلوبة: A = رقم الموديل ، B = السعر ، C = وصف الموديل.
  const a1 = _norm_(sh.getRange('A1').getDisplayValue());
  const b1 = _norm_(sh.getRange('B1').getDisplayValue());
  const c1 = _norm_(sh.getRange('C1').getDisplayValue());
  if (!a1 && !b1 && !c1) {
    sh.getRange('A1:C1').setValues([['رقم الموديل', 'السعر', 'وصف الموديل']]);
  } else {
    if (!a1) sh.getRange('A1').setValue('رقم الموديل');
    if (!b1) sh.getRange('B1').setValue('السعر');
    if (!c1) sh.getRange('C1').setValue('وصف الموديل');
  }

  sh.setFrozenRows(1);
  return sh;
}

function setupPricesSheet() {
  const sh = _ensurePricesSheet_();
  sh.autoResizeColumns(1, 3);
  return 'تم تجهيز شيت الاسعار: A رقم الموديل / B السعر / C وصف الموديل';
}

function getModelPrices() {
  const sh = _ensurePricesSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  // getDisplayValues يحافظ على رقم الموديل كنص كما يظهر في Google Sheet.
  const values = sh.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
  const byModel = new Map();

  values.forEach(function(row) {
    const model = _norm_(row[0]);
    if (!model) return;

    const rawPrice = _norm_(row[1]).replace(/,/g, '');
    const price = rawPrice === '' ? 0 : Number(rawPrice);
    const description = _norm_(row[2]);

    byModel.set(model, {
      model: model,
      price: isFinite(price) ? Math.max(0, price) : 0,
      description: description
    });
  });

  return Array.from(byModel.values());
}

/*********** DATA LOADERS ***********/
function _loadStock_(force) {
  if (!force) {
    const cached = _cacheGetJson_('stock');
    if (cached) {
      return {
        stockSet: new Set(cached.models || []),
        stockQty: new Map(cached.stockQty || [])
      };
    }
  }

  const stock = _readSheetSmart_(SHEETS.STOCK, STOCK_COLS);
  const cModel = 0;
  const cQty = 2;

  const stockSet = new Set();
  const stockQty = new Map();

  stock.data.forEach(function(r) {
    const model = _norm_(r[cModel]);
    if (!model) return;
    stockSet.add(model);
    stockQty.set(model, (stockQty.get(model) || 0) + _num_(r[cQty]));
  });

  _cachePutJson_('stock', {
    models: Array.from(stockSet),
    stockQty: Array.from(stockQty.entries())
  }, CACHE_SECONDS);

  return { stockSet: stockSet, stockQty: stockQty };
}

function _loadOrders_(force) {
  if (!force) {
    const cached = _cacheGetJson_('orders');
    if (cached) {
      return {
        ordersByClientModel: _objToClientMap_(cached.ordersByClientModel || {}),
        invoicesByClient: _objToSetMap_(cached.invoicesByClient || {}),
        totalRequiredByClient: new Map(cached.totalRequiredByClient || [])
      };
    }
  }

  const orders = _readSheetSmart_(SHEETS.ORDERS, ORDER_COLS);
  const cInv = _colOrFallback_(orders.idx, 'invoice', 0);
  const cClient = _colOrFallback_(orders.idx, 'client', 2);
  const cModel = _colOrFallback_(orders.idx, 'model', 3);
  const cQty = _colOrFallback_(orders.idx, 'qty', 4);

  const ordersByClientModel = new Map();
  const invoicesByClient = new Map();
  const totalRequiredByClient = new Map();

  orders.data.forEach(function(r) {
    const client = _norm_(r[cClient]);
    const model = _norm_(r[cModel]);
    const qty = _num_(r[cQty]);
    const invoice = _norm_(r[cInv]);

    if (!client || !model || qty <= 0) return;

    if (!ordersByClientModel.has(client)) ordersByClientModel.set(client, new Map());
    const mm = ordersByClientModel.get(client);
    mm.set(model, (mm.get(model) || 0) + qty);

    totalRequiredByClient.set(client, (totalRequiredByClient.get(client) || 0) + qty);

    if (invoice) {
      if (!invoicesByClient.has(client)) invoicesByClient.set(client, new Set());
      invoicesByClient.get(client).add(invoice);
    }
  });

  _cachePutJson_('orders', {
    ordersByClientModel: _clientMapToObj_(ordersByClientModel),
    invoicesByClient: _setMapToObj_(invoicesByClient),
    totalRequiredByClient: Array.from(totalRequiredByClient.entries())
  }, CACHE_SECONDS);

  return {
    ordersByClientModel: ordersByClientModel,
    invoicesByClient: invoicesByClient,
    totalRequiredByClient: totalRequiredByClient
  };
}

function _loadOut_(force) {
  if (!force) {
    const cached = _cacheGetJson_('out');
    if (cached) {
      return {
        deliveredByClientModel: _objToClientMap_(cached.deliveredByClientModel || {}),
        totalDeliveredByClient: new Map(cached.totalDeliveredByClient || [])
      };
    }
  }

  const out = _readSheetSmart_(SHEETS.OUT, OUT_COLS);
  const cClient = _colOrFallback_(out.idx, 'client', 2);
  const cModel = _colOrFallback_(out.idx, 'model', 3);
  const cQty = _colOrFallback_(out.idx, 'qty', 4);

  const deliveredByClientModel = new Map();
  const totalDeliveredByClient = new Map();

  out.data.forEach(function(r) {
    const client = _norm_(r[cClient]);
    const model = _norm_(r[cModel]);
    const qty = _num_(r[cQty]);

    if (!client || !model || qty <= 0) return;

    if (!deliveredByClientModel.has(client)) deliveredByClientModel.set(client, new Map());
    const mm = deliveredByClientModel.get(client);
    mm.set(model, (mm.get(model) || 0) + qty);
    totalDeliveredByClient.set(client, (totalDeliveredByClient.get(client) || 0) + qty);
  });

  _cachePutJson_('out', {
    deliveredByClientModel: _clientMapToObj_(deliveredByClientModel),
    totalDeliveredByClient: Array.from(totalDeliveredByClient.entries())
  }, CACHE_SECONDS);

  return {
    deliveredByClientModel: deliveredByClientModel,
    totalDeliveredByClient: totalDeliveredByClient
  };
}

function _clientMapToObj_(map) {
  const obj = {};
  map.forEach(function(innerMap, client) {
    obj[client] = {};
    innerMap.forEach(function(qty, model) {
      obj[client][model] = qty;
    });
  });
  return obj;
}

function _objToClientMap_(obj) {
  const map = new Map();
  Object.keys(obj).forEach(function(client) {
    const inner = new Map();
    Object.keys(obj[client] || {}).forEach(function(model) {
      inner.set(model, _num_(obj[client][model]));
    });
    map.set(client, inner);
  });
  return map;
}

function _setMapToObj_(map) {
  const obj = {};
  map.forEach(function(setValue, key) {
    obj[key] = Array.from(setValue || []);
  });
  return obj;
}

function _objToSetMap_(obj) {
  const map = new Map();
  Object.keys(obj).forEach(function(key) {
    map.set(key, new Set(obj[key] || []));
  });
  return map;
}

/*********** BUSINESS ***********/
function login(user, pass) {
  const users = _readSheetSmart_(SHEETS.USERS, USER_COLS);
  const cUser = _colOrFallback_(users.idx, 'user', 0);
  const cPass = _colOrFallback_(users.idx, 'pass', 1);
  const cRole = _colOrFallback_(users.idx, 'role', 2);

  const u = _norm_(user);
  const p = _norm_(pass);

  if (!u || !p) return { ok: false };

  for (var i = 0; i < users.data.length; i++) {
    const row = users.data[i];
    if (_norm_(row[cUser]) === u && _norm_(row[cPass]) === p) {
      return {
        ok: true,
        role: _norm_(row[cRole]),
        user: u,
        app: APP_INFO
      };
    }
  }

  return { ok: false };
}

function getDashboardClients(readyOnly, force) {
  const cacheKey = readyOnly ? 'dashboard_ready' : 'dashboard_all';

  if (!force) {
    const cached = _cacheGetJson_(cacheKey);
    if (cached) return cached;
  }

  const stock = _loadStock_(force);
  const orders = _loadOrders_(force);
  const out = _loadOut_(force);
  const result = [];

  orders.ordersByClientModel.forEach(function(modelsMap, client) {
    const requiredAll = orders.totalRequiredByClient.get(client) || 0;
    const deliveredAll = out.totalDeliveredByClient.get(client) || 0;
    const remainingAll = Math.max(0, requiredAll - deliveredAll);

    let readyRequired = 0;
    let readyDelivered = 0;
    let readyRemaining = 0;
    const readyModels = [];

    modelsMap.forEach(function(req, model) {
      const del = (out.deliveredByClientModel.get(client) && out.deliveredByClientModel.get(client).get(model)) || 0;
      const rem = Math.max(0, req - del);
      if (rem <= 0) return;

      const qtyInStock = stock.stockQty.get(model) || 0;
      const ok = stock.stockSet.has(model) && qtyInStock > 0;
      if (!ok) return;

      readyRequired += req;
      readyDelivered += del;
      readyRemaining += rem;
      readyModels.push(model);
    });

    if (readyOnly) {
      if (readyModels.length === 0) return;
      result.push({
        client: client,
        required: readyRequired,
        delivered: readyDelivered,
        remaining: readyRemaining,
        status: readyDelivered === 0 ? 'لم يبدأ' : (readyRemaining > 0 ? 'جزئي' : 'مكتمل'),
        invoices: Array.from(orders.invoicesByClient.get(client) || []).join(', '),
        readyModels: readyModels
      });
    } else {
      result.push({
        client: client,
        required: requiredAll,
        delivered: deliveredAll,
        remaining: remainingAll,
        status: deliveredAll === 0 ? 'لم يبدأ' : (remainingAll > 0 ? 'جزئي' : 'مكتمل'),
        invoices: Array.from(orders.invoicesByClient.get(client) || []).join(', '),
        readyModels: readyModels
      });
    }
  });

  result.sort(function(a, b) { return (b.remaining || 0) - (a.remaining || 0); });
  _cachePutJson_(cacheKey, result, CACHE_SECONDS);
  return result;
}

function getClientModels(client, readyOnly) {
  const c = _norm_(client);
  if (!c) return [];

  const stock = _loadStock_();
  const orders = _loadOrders_();
  const out = _loadOut_();
  const modelsMap = orders.ordersByClientModel.get(c);
  if (!modelsMap) return [];

  const res = [];
  modelsMap.forEach(function(req, model) {
    const del = (out.deliveredByClientModel.get(c) && out.deliveredByClientModel.get(c).get(model)) || 0;
    const rem = Math.max(0, req - del);
    const stockNow = stock.stockQty.get(model) || 0;
    const availableQty = Math.max(0, Math.min(rem, stockNow));
    const inStock = stock.stockSet.has(model) && stockNow > 0;

    if (readyOnly) {
      if (rem <= 0) return;
      if (!inStock) return;
      if (availableQty <= 0) return;
    }

    let deliveryNote = '';
    if (rem <= 0) {
      deliveryNote = 'تم التسليم';
    } else if (del > 0) {
      deliveryNote = 'تم التسليم جزئيًا';
    }

    res.push({
      model: model,
      required: req,
      delivered: del,
      remaining: rem,
      stockQty: stockNow,
      availableToDeliver: availableQty,
      available: inStock,
      availabilityText: inStock ? 'متوفر' : 'غير متوفر',
      deliveryNote: deliveryNote
    });
  });

  return res.sort(function(a, b) {
    if ((b.remaining || 0) !== (a.remaining || 0)) return (b.remaining || 0) - (a.remaining || 0);
    return String(a.model).localeCompare(String(b.model), 'ar');
  });
}

function deliverModels(client, items) {
  const c = _norm_(client);
  if (!c) throw new Error('اسم العميل فارغ');

  const normalizedItems = (items || []).map(function(it) {
    return { model: _norm_(it.model), qty: _num_(it.qty) };
  }).filter(function(it) {
    return it.model && it.qty > 0;
  });

  if (normalizedItems.length === 0) throw new Error('لا توجد موديلات صحيحة للتسليم');

  const out = _readSheetSmart_(SHEETS.OUT, OUT_COLS);
  const outSh = out.sh;
  const stockSh = _mustSheet_(SHEETS.STOCK);
  const stockValues = _getAll_(stockSh);

  if (stockValues.length < 2) throw new Error('شيت المخزون فارغ');

  const orders = _loadOrders_(true);
  const outState = _loadOut_(true);

  const cInv = _colOrFallback_(out.idx, 'invoice', 0);
  const cDate = _colOrFallback_(out.idx, 'date', 1);
  const cClient = _colOrFallback_(out.idx, 'client', 2);
  const cModel = _colOrFallback_(out.idx, 'model', 3);
  const cQty = _colOrFallback_(out.idx, 'qty', 4);

  const STOCK_MODEL_COL = 0;
  const STOCK_QTY_COL = 2;
  const now = new Date();

  const clientModels = orders.ordersByClientModel.get(c);
  if (!clientModels) throw new Error('العميل غير موجود في الطلبيات');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const stockRows = stockValues.slice(1);
    const stockMap = new Map();

    stockRows.forEach(function(row, i) {
      const model = _norm_(row[STOCK_MODEL_COL]);
      if (!model) return;
      stockMap.set(model, {
        rowNumber: i + 2,
        qty: _num_(row[STOCK_QTY_COL])
      });
    });

    normalizedItems.forEach(function(it) {
      const orderedQty = clientModels.get(it.model) || 0;
      const deliveredQty = (outState.deliveredByClientModel.get(c) && outState.deliveredByClientModel.get(c).get(it.model)) || 0;
      const remainingQty = Math.max(0, orderedQty - deliveredQty);

      if (remainingQty <= 0) {
        throw new Error('هذا الموديل تم تسليمه بالكامل بالفعل: ' + it.model);
      }

      if (it.qty > remainingQty) {
        throw new Error('الكمية المطلوبة للتسليم أكبر من المتبقي للموديل ' + it.model + ' | المتبقي: ' + remainingQty);
      }

      const stockItem = stockMap.get(it.model);
      if (!stockItem) throw new Error('الموديل غير موجود في المخزون: ' + it.model);

      if (stockItem.qty < it.qty) {
        throw new Error('الكمية غير كافية للموديل ' + it.model + ' | المتاح: ' + stockItem.qty + ' | المطلوب: ' + it.qty);
      }
    });

    normalizedItems.forEach(function(it) {
      const stockItem = stockMap.get(it.model);
      const newQty = stockItem.qty - it.qty;
      stockSh.getRange(stockItem.rowNumber, STOCK_QTY_COL + 1).setValue(newQty);
      stockItem.qty = newQty;
    });

    const rowsToAppend = normalizedItems.map(function(it) {
      const row = new Array(Math.max(5, out.hdr.length)).fill('');
      row[cInv] = 'تسليم';
      row[cDate] = now;
      row[cClient] = c;
      row[cModel] = it.model;
      row[cQty] = it.qty;
      return row;
    });

    if (rowsToAppend.length) {
      outSh.getRange(outSh.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    _clearCache_();
    return normalizedItems;
  } finally {
    lock.releaseLock();
  }
}

function searchClients(keyword) {
  const k = _norm_(keyword).toLowerCase();
  if (!k) return [];

  return getDashboardClients(true)
    .map(function(x) { return x.client; })
    .filter(function(name) { return _norm_(name).toLowerCase().indexOf(k) !== -1; })
    .slice(0, 50);
}

function getModelsByPrefix(force) {
  if (!force) {
    const cached = _cacheGetJson_('modelsByPrefix');
    if (cached) return cached;
  }

  const orders = _loadOrders_(force);
  const data = {};

  orders.ordersByClientModel.forEach(function(modelsMap, client) {
    modelsMap.forEach(function(qty, model) {
      if (!model) return;

      const num = Number(model);
      const prefix = (!isNaN(num) && num < 1000) ? model.substring(0, 1) : model.substring(0, 2);

      if (!data[prefix]) data[prefix] = {};
      if (!data[prefix][model]) data[prefix][model] = { total: 0, clients: [] };

      data[prefix][model].total += qty;
      data[prefix][model].clients.push({ client: client, qty: qty });
    });
  });

  const result = {};
  Object.keys(data).forEach(function(prefix) {
    result[prefix] = Object.keys(data[prefix]).map(function(model) {
      return {
        model: model,
        total: data[prefix][model].total,
        clients: data[prefix][model].clients
      };
    }).sort(function(a, b) { return (b.total || 0) - (a.total || 0); });
  });

  _cachePutJson_('modelsByPrefix', result, CACHE_SECONDS);
  return result;
}

function getSummaryStats(force) {
  if (!force) {
    const cached = _cacheGetJson_('summary');
    if (cached) return cached;
  }

  const allClients = getDashboardClients(false, force);
  const readyClients = getDashboardClients(true, force);
  const stock = _loadStock_(force);

  let stockQtyTotal = 0;
  stock.stockQty.forEach(function(v) { stockQtyTotal += _num_(v); });

  let totalRequired = 0;
  let totalDelivered = 0;
  let totalRemaining = 0;

  allClients.forEach(function(c) {
    totalRequired += _num_(c.required);
    totalDelivered += _num_(c.delivered);
    totalRemaining += _num_(c.remaining);
  });

  const result = {
    allClients: allClients.length,
    readyClients: readyClients.length,
    totalRequired: totalRequired,
    totalDelivered: totalDelivered,
    totalRemaining: totalRemaining,
    stockQtyTotal: stockQtyTotal,
    app: APP_INFO,
    generatedAt: new Date()
  };

  _cachePutJson_('summary', result, CACHE_SECONDS);
  return result;
}

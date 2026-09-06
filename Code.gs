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
  version: '2026.09.07-live-warehouse-v6.1-stock-fix'
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
          data: getModelsByPrefix(_bool_(p.force))
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
    let body = {};
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (_) {
        // api.js may send application/x-www-form-urlencoded. Apps Script exposes it through e.parameter.
        body = (e && e.parameter) || {};
      }
    } else {
      body = (e && e.parameter) || {};
    }

    const action = _norm_(body.action);

    switch (action) {
      case 'deliver':
      case 'deliverModels': {
        const items = Array.isArray(body.items) ? body.items : _parseItems_(body.items);
        return _json_({
          ok: true,
          delivered: deliverModels(body.client, items),
          data: getSummaryStats(true)
        });
      }

      case 'login':
        return _json_(login(body.user, body.pass));

      case 'dashboard':
      case 'getDashboardClients':
        return _json_({
          ok: true,
          data: getDashboardClients(_bool_(body.readyOnly || body.ready))
        });

      case 'clientModels':
      case 'getClientModels':
        return _json_({
          ok: true,
          data: getClientModels(body.client, _bool_(body.readyOnly || body.ready))
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
          data: getModelsByPrefix(_bool_(body.force))
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

function _normHeader_(v) {
  return _norm_(v)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s\-_/\\.,،;:()]+/g, '');
}

function _headerIndexMap_(headersRow) {
  const map = {};
  headersRow.forEach(function(h, i) {
    const key = _normHeader_(h);
    if (key) map[key] = i;
  });
  return map;
}

function _findCol_(hdrMap, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    const key = _normHeader_(candidates[i]);
    if (Object.prototype.hasOwnProperty.call(hdrMap, key)) return hdrMap[key];
  }
  return -1;
}

function _colOrFallback_(idx, key, fallbackIndex) {
  const v = idx[key];
  return (typeof v === 'number' && v >= 0) ? v : fallbackIndex;
}

function _detectNumericColumn_(smart, excludeIndex, preferredIndex) {
  if (!smart || !Array.isArray(smart.data) || !smart.data.length) return preferredIndex;
  const width = smart.hdr ? smart.hdr.length : (smart.data[0] || []).length;
  let best = -1, bestScore = -1;
  for (let c = 0; c < width; c++) {
    if (c === excludeIndex) continue;
    let numeric = 0, nonEmpty = 0;
    smart.data.slice(0, 80).forEach(function(row) {
      const raw = row[c];
      if (_norm_(raw) === '') return;
      nonEmpty++;
      const cleaned = String(raw).replace(/,/g, '').trim();
      if (cleaned !== '' && isFinite(Number(cleaned))) numeric++;
    });
    if (!nonEmpty) continue;
    let score = (numeric / nonEmpty) * 100 + numeric;
    if (c === preferredIndex) score += 3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best >= 0 ? best : preferredIndex;
}

function _stockColumns_(stock) {
  const cModel = _colOrFallback_(stock.idx, 'model', 0);
  const cQty = (typeof stock.idx.qty === 'number' && stock.idx.qty >= 0)
    ? stock.idx.qty
    : _detectNumericColumn_(stock, cModel, 2);
  return { model: cModel, qty: cQty };
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
    'out',
    'dashboard_all',
    'dashboard_ready',
    'modelsByPrefix',
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
  model: ['الموديل', 'موديل', 'رقم الموديل', 'رقم الموديل المطلوب', 'رمز الصنف', 'كود الصنف', 'الصنف', 'رقم الصنف'],
  qty: ['الكميه', 'الكمية', 'كمية', 'المخزون', 'كمية المخزون', 'كميه المخزون', 'رصيد المخزون', 'الرصيد', 'رصيد', 'متاح', 'المتاح', 'الكمية المتاحة', 'الكميه المتاحه', 'الكمية الحالية', 'الرصيد الحالي'],
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
  const stockCols = _stockColumns_(stock);
  const cModel = stockCols.model;
  const cQty = stockCols.qty;

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
    let pendingRequired = 0;
    let deliveredQtyTotal = 0;
    let originalRequired = 0;
    let readyRequired = 0;
    const readyModels = [];
    const pendingModels = [];
    const deliveredModels = [];

    modelsMap.forEach(function(req, model) {
      const del = (out.deliveredByClientModel.get(client) && out.deliveredByClientModel.get(client).get(model)) || 0;
      originalRequired += req;
      deliveredQtyTotal += del;

      // قاعدة العمل: أول كمية تسليم (> 0) تجعل الموديل مكتملًا مهما كانت أقل/تساوي/أكثر من المطلوب.
      if (del > 0) {
        deliveredModels.push(model);
        return;
      }

      pendingModels.push(model);
      pendingRequired += req;

      const qtyInStock = stock.stockQty.get(model) || 0;
      if (stock.stockSet.has(model) && qtyInStock > 0) {
        readyRequired += req;
        readyModels.push(model);
      }
    });

    if (readyOnly) {
      if (readyModels.length === 0) return;
      result.push({
        client: client,
        required: readyRequired,
        delivered: deliveredQtyTotal,
        remaining: readyRequired,
        status: 'جاهز',
        invoices: Array.from(orders.invoicesByClient.get(client) || []).join(', '),
        readyModels: readyModels,
        pendingModels: pendingModels,
        deliveredModels: deliveredModels,
        totalModels: pendingModels.length,
        originalTotalModels: modelsMap.size,
        originalRequired: originalRequired
      });
    } else {
      result.push({
        client: client,
        required: pendingRequired,
        delivered: deliveredQtyTotal,
        remaining: pendingRequired,
        status: pendingModels.length ? (deliveredModels.length ? 'جزئي' : 'لم يبدأ') : (deliveredModels.length ? 'مكتمل' : 'لم يبدأ'),
        invoices: Array.from(orders.invoicesByClient.get(client) || []).join(', '),
        readyModels: readyModels,
        pendingModels: pendingModels,
        deliveredModels: deliveredModels,
        totalModels: pendingModels.length,
        originalTotalModels: modelsMap.size,
        originalRequired: originalRequired
      });
    }
  });

  result.sort(function(a, b) {
    if ((b.remaining || 0) !== (a.remaining || 0)) return (b.remaining || 0) - (a.remaining || 0);
    return String(a.client).localeCompare(String(b.client), 'ar');
  });
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
    const delivered = del > 0;
    const rem = delivered ? 0 : req;
    const stockNow = stock.stockQty.get(model) || 0;
    const availableQty = delivered ? 0 : Math.max(0, Math.min(req, stockNow));
    const inStock = stock.stockSet.has(model) && stockNow > 0;

    if (readyOnly) {
      if (delivered) return;
      if (!inStock || availableQty <= 0) return;
    }

    let deliveryNote = '';
    if (delivered) {
      if (del < req) deliveryNote = 'تم التسليم - أقل من المطلوب';
      else if (del > req) deliveryNote = 'تم التسليم - أكثر من المطلوب';
      else deliveryNote = 'تم التسليم';
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
      deliveryNote: deliveryNote,
      completed: delivered
    });
  });

  return res.sort(function(a, b) {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    return String(a.model).localeCompare(String(b.model), 'ar', { numeric: true });
  });
}

function deliverModels(client, items) {
  const c = _norm_(client);
  if (!c) throw new Error('اسم العميل فارغ');

  // دمج أي تكرار لنفس الموديل في الطلب المرسل لتجنب خصم المخزون مرتين بطريقة غير محسوبة.
  const itemMap = new Map();
  (items || []).forEach(function(it) {
    const model = _norm_(it && it.model);
    const qty = _num_(it && it.qty);
    if (!model || qty <= 0) return;
    itemMap.set(model, (itemMap.get(model) || 0) + qty);
  });
  const normalizedItems = Array.from(itemMap.entries()).map(function(pair) {
    return { model: pair[0], qty: pair[1] };
  });

  if (normalizedItems.length === 0) throw new Error('لا توجد موديلات صحيحة للتسليم');

  const out = _readSheetSmart_(SHEETS.OUT, OUT_COLS);
  const outSh = out.sh;
  const stockSmart = _readSheetSmart_(SHEETS.STOCK, STOCK_COLS);
  const stockSh = stockSmart.sh;
  const stockValues = _getAll_(stockSh);
  if (stockValues.length < 2) throw new Error('شيت المخزون فارغ');

  const orders = _loadOrders_(true);
  const outState = _loadOut_(true);
  const cInv = _colOrFallback_(out.idx, 'invoice', 0);
  const cDate = _colOrFallback_(out.idx, 'date', 1);
  const cClient = _colOrFallback_(out.idx, 'client', 2);
  const cModel = _colOrFallback_(out.idx, 'model', 3);
  const cQty = _colOrFallback_(out.idx, 'qty', 4);
  const stockCols = _stockColumns_(stockSmart);
  const STOCK_MODEL_COL = stockCols.model;
  const STOCK_QTY_COL = stockCols.qty;
  const now = new Date();

  const clientModels = orders.ordersByClientModel.get(c);
  if (!clientModels) throw new Error('العميل غير موجود في الطلبيات');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    // نعيد قراءة المخزون بعد أخذ القفل حتى لا نعتمد على قيمة قديمة من طلب متزامن.
    const lockedStockValues = _getAll_(stockSh);
    const stockMap = new Map();
    lockedStockValues.slice(1).forEach(function(row, i) {
      const model = _norm_(row[STOCK_MODEL_COL]);
      if (!model) return;
      const qty = _num_(row[STOCK_QTY_COL]);
      if (!stockMap.has(model)) stockMap.set(model, { qty: 0, rows: [] });
      const item = stockMap.get(model);
      item.qty += qty;
      item.rows.push({ rowNumber: i + 2, qty: qty });
    });

    normalizedItems.forEach(function(it) {
      const orderedQty = clientModels.get(it.model) || 0;
      if (orderedQty <= 0) throw new Error('الموديل غير موجود في طلبية العميل: ' + it.model);

      const deliveredQty = (outState.deliveredByClientModel.get(c) && outState.deliveredByClientModel.get(c).get(it.model)) || 0;
      if (deliveredQty > 0) throw new Error('هذا الموديل موجود بالفعل في المكتمل: ' + it.model);

      // مسموح أن تكون كمية التسليم أقل أو تساوي أو أكثر من الكمية المطلوبة.
      const stockItem = stockMap.get(it.model);
      if (!stockItem) throw new Error('الموديل غير موجود في المخزون: ' + it.model);
      if (stockItem.qty < it.qty) {
        throw new Error('الكمية غير كافية بالمخزون للموديل ' + it.model + ' | المخزون: ' + stockItem.qty + ' | التسليم: ' + it.qty);
      }
    });

    normalizedItems.forEach(function(it) {
      const stockItem = stockMap.get(it.model);
      let toDeduct = it.qty;
      stockItem.rows.forEach(function(part) {
        if (toDeduct <= 0) return;
        const take = Math.min(part.qty, toDeduct);
        if (take <= 0) return;
        part.qty -= take;
        toDeduct -= take;
        stockSh.getRange(part.rowNumber, STOCK_QTY_COL + 1).setValue(part.qty);
      });
      stockItem.qty -= it.qty;
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

function _loadSearchIndex_(force) {
  if (!force) {
    const cached = _cacheGetJson_('search_index');
    if (cached) return cached;
  }

  // البحث لا يحتاج المخزون أو الصادر؛ يكفي شيت الطلبيات، وهذا يجعله أخف بكثير.
  const orders = _loadOrders_(force);
  const index = [];
  orders.ordersByClientModel.forEach(function(_, client) {
    const invoices = Array.from(orders.invoicesByClient.get(client) || []);
    index.push({
      client: client,
      invoices: invoices.join(', '),
      search: _norm_([client].concat(invoices).join(' ')).toLowerCase()
    });
  });
  _cachePutJson_('search_index', index, 60);
  return index;
}

function searchClients(keyword) {
  const k = _norm_(keyword).toLowerCase();
  if (!k) return [];
  const tokens = k.split(/\s+/).filter(Boolean);

  return _loadSearchIndex_(false)
    .map(function(x) {
      const s = x.search || '';
      let score = 0;
      if (s === k) score = 100;
      else if (s.indexOf(k) === 0) score = 80;
      else if (tokens.every(function(t) { return s.indexOf(t) !== -1; })) score = 60;
      else if (s.indexOf(k) !== -1) score = 40;
      return { x: x, score: score };
    })
    .filter(function(v) { return v.score > 0; })
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, 50)
    .map(function(v) {
      return { client: v.x.client, invoices: v.x.invoices };
    });
}

function getModelsByPrefix(force) {
  if (!force) {
    const cached = _cacheGetJson_('modelsByPrefix');
    if (cached) return cached;
  }

  const orders = _loadOrders_(force);
  const out = _loadOut_(force);
  const stock = _loadStock_(force);
  const data = {};

  orders.ordersByClientModel.forEach(function(modelsMap, client) {
    modelsMap.forEach(function(qty, model) {
      if (!model) return;
      const deliveredQty = (out.deliveredByClientModel.get(client) && out.deliveredByClientModel.get(client).get(model)) || 0;

      // الموديل الذي تم تسليم أي كمية منه ينتقل إلى المكتمل، فلا يبقى ضمن المطلوب في المخزن.
      if (deliveredQty > 0) return;

      const modelNum = Number(model);
      const prefix = (!isNaN(modelNum) && modelNum < 1000) ? model.substring(0, 1) : model.substring(0, 2);
      if (!data[prefix]) data[prefix] = {};
      if (!data[prefix][model]) data[prefix][model] = { total: 0, clients: [] };

      data[prefix][model].total += qty;
      data[prefix][model].clients.push({ client: client, qty: qty });
    });
  });

  const result = {};
  Object.keys(data).forEach(function(prefix) {
    result[prefix] = Object.keys(data[prefix]).map(function(model) {
      const stockQty = stock.stockQty.get(model) || 0;
      const total = data[prefix][model].total;
      return {
        model: model,
        total: total,
        stockQty: stockQty,
        balance: stockQty - total,
        clients: data[prefix][model].clients
      };
    }).sort(function(a, b) {
      return String(a.model).localeCompare(String(b.model), 'ar', { numeric: true });
    });
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

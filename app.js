'use strict';

const CONFIG = {
  defaultCountryCode: '92',
  companyFallback: 'VALS Tracking (Private) Limited',
  apiTimeoutMs: 20000,
  phoneFieldNames: [
    'whatsapp number', 'whatsapp', 'wa number',
    'mobile number', 'mobile', 'cell number', 'cell',
    'phone number', 'phone', 'telephone', 'contact number', 'primary contact'
  ]
};

const state = {
  context: null,
  invoiceKey: null,
  rawInvoice: null,
  viewInvoice: null,
  customer: null,
  customFieldDefinitions: new Map()
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindUi();
  installManagerMessageListener();
  installAutoResize();
  requestPageContext();
});

function cacheElements() {
  [
    'statusCard', 'statusDot', 'statusTitle', 'statusText', 'controls',
    'phoneInput', 'phoneHint', 'messageInput', 'whatsappButton', 'copyButton',
    'printButton', 'reloadButton', 'invoicePreview', 'businessName',
    'businessAddress', 'invoiceReference', 'customerName', 'customerAddress',
    'customerEmail', 'invoiceFields', 'invoiceDescription', 'invoiceTableHead',
    'invoiceTableBody', 'invoiceTableFoot', 'errorCard', 'errorText',
    'errorRetryButton'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function bindUi() {
  els.whatsappButton.addEventListener('click', openWhatsApp);
  els.copyButton.addEventListener('click', copyMessage);
  els.printButton.addEventListener('click', () => window.print());
  els.reloadButton.addEventListener('click', loadCurrentInvoice);
  els.errorRetryButton.addEventListener('click', () => {
    hideError();
    requestPageContext();
  });
  els.phoneInput.addEventListener('input', () => {
    const normalized = normalizePhone(els.phoneInput.value);
    els.phoneHint.textContent = normalized
      ? `WhatsApp format: ${normalized}`
      : 'Format: 92XXXXXXXXXX';
  });
}

function installManagerMessageListener() {
  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'page-response') {
      const body = data.body || {};
      const key = body.query?.key || body.query?.Key || body.key || null;
      const path = body.path || body.query?.path || '';

      state.context = body;
      if (!key) {
        showError('Current invoice key Manager.io se receive nahi hui. Pehle Sales Invoice open karein, phir WhatsApp Invoice button click karein.');
        return;
      }

      if (path && !String(path).includes('sales-invoice-view')) {
        showError(`Ye button Sales Invoice view ke liye hai. Current page: ${path}`);
        return;
      }

      state.invoiceKey = key;
      loadCurrentInvoice();
    }
  });
}

function requestPageContext() {
  setStatus('loading', 'Invoice load ho rahi hai…', 'Manager.io se current invoice context hasil kiya ja raha hai.');
  window.parent.postMessage({ type: 'page-request' }, '*');

  window.setTimeout(() => {
    if (!state.invoiceKey && !els.errorCard.hidden) return;
    if (!state.invoiceKey) {
      showError('Manager.io ne page context return nahi kiya. Custom Button ki Placement “sales-invoice-view” confirm karein aur invoice ke andar se button open karein.');
    }
  }, 10000);
}

async function loadCurrentInvoice() {
  if (!state.invoiceKey) return;

  showLoadingUi();

  try {
    const key = encodeURIComponent(state.invoiceKey);

    const [rawResult, viewResult, fieldResult] = await Promise.allSettled([
      managerApi(`/api4/sales-invoice?Key=${key}`),
      managerApi(`/api4/sales-invoice-view?Key=${key}`),
      managerApi('/api4/text-custom-field-batch?PageSize=500')
    ]);

    state.rawInvoice = rawResult.status === 'fulfilled'
      ? normalizeApiObject(rawResult.value)
      : null;

    state.viewInvoice = viewResult.status === 'fulfilled'
      ? normalizeApiObject(viewResult.value)
      : null;

    if (!state.rawInvoice && !state.viewInvoice) {
      const rawError = rawResult.status === 'rejected' ? rawResult.reason?.message : '';
      const viewError = viewResult.status === 'rejected' ? viewResult.reason?.message : '';
      throw new Error(`Invoice API se data nahi mila. ${rawError || viewError || ''}`.trim());
    }

    state.customFieldDefinitions = fieldResult.status === 'fulfilled'
      ? buildCustomFieldDefinitionMap(fieldResult.value)
      : new Map();

    const customerKey = findCustomerKey(state.rawInvoice, state.viewInvoice);
    state.customer = customerKey
      ? normalizeApiObject(await managerApi(`/api4/customer?Key=${encodeURIComponent(customerKey)}`))
      : null;

    renderInvoice();
    prepareWhatsAppControls();
    setStatus('success', 'Invoice tayyar hai', 'Customer number verify karein, phir Open WhatsApp par click karein.');
    els.controls.hidden = false;
    els.invoicePreview.hidden = false;
    hideError();
    notifyResize();
  } catch (error) {
    console.error(error);
    showError(error?.message || 'Unknown error while loading invoice.');
  }
}

function managerApi(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const requestId = (crypto.randomUUID && crypto.randomUUID()) ||
      `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Manager API timeout: ${path}`));
    }, CONFIG.apiTimeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('message', onResponse);
    }

    function onResponse(event) {
      const data = event.data;
      if (!data || data.requestId !== requestId) return;

      cleanup();

      const status = Number(data.status || data.statusCode || 200);
      if (data.error || status >= 400 || data.ok === false) {
        reject(new Error(data.error?.message || data.error || data.body?.message || `API request failed (${status})`));
        return;
      }

      resolve(parseMaybeJson(data.body ?? data.response ?? data));
    }

    window.addEventListener('message', onResponse);
    window.parent.postMessage({
      type: 'api-request',
      requestId,
      path,
      method,
      body
    }, '*');
  });
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeApiObject(payload) {
  let value = parseMaybeJson(payload);

  for (let i = 0; i < 5; i += 1) {
    if (!value || typeof value !== 'object') break;
    if (value.item && typeof value.item === 'object') { value = value.item; continue; }
    if (value.value && typeof value.value === 'object') { value = value.value; continue; }
    if (value.body && typeof value.body === 'object') { value = value.body; continue; }
    break;
  }

  return value;
}

function buildCustomFieldDefinitionMap(payload) {
  const map = new Map();
  const root = normalizeApiObject(payload) || payload || {};
  const items = Array.isArray(root)
    ? root
    : (root.items || root.values || root.data || []);

  for (const row of items) {
    const item = row?.item || row?.value || row || {};
    const key = row?.key || item?.key || item?.id;
    const name = item?.name || item?.label || item?.text;
    if (key && name) map.set(String(key), String(name));
  }

  return map;
}

function findCustomerKey(raw, view) {
  const candidates = [
    raw?.customer,
    raw?.customerKey,
    raw?.recipient,
    view?.customer,
    view?.recipient?.key,
    view?.recipient?.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && looksLikeGuid(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const key = candidate.key || candidate.id || candidate.value;
      if (typeof key === 'string' && looksLikeGuid(key)) return key;
    }
  }
  return null;
}

function looksLikeGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(value));
}

function renderInvoice() {
  const view = state.viewInvoice || {};
  const raw = state.rawInvoice || {};
  const customer = state.customer || {};

  const business = view.business || {};
  const recipient = view.recipient || {};

  els.businessName.textContent = firstNonEmpty(
    business.name,
    view.businessName,
    CONFIG.companyFallback
  );
  els.businessAddress.textContent = firstNonEmpty(business.address, business.billingAddress, '');

  els.customerName.textContent = firstNonEmpty(
    recipient.name,
    customer.name,
    customer.customerName,
    'Customer'
  );
  els.customerAddress.textContent = firstNonEmpty(
    recipient.address,
    customer.billingAddress,
    customer.address,
    raw.billingAddress,
    ''
  );
  els.customerEmail.textContent = firstNonEmpty(recipient.email, customer.email, '');

  const invoiceRef = getInvoiceReference(view, raw);
  els.invoiceReference.textContent = invoiceRef || '—';

  renderInvoiceFields(view, raw);
  renderInvoiceDescription(view, raw);

  const tableRendered = renderViewTable(view);
  if (!tableRendered) renderRawTable(raw);
}

function renderInvoiceFields(view, raw) {
  els.invoiceFields.innerHTML = '';

  const fields = [];
  if (Array.isArray(view.fields)) {
    for (const field of view.fields) {
      const label = firstNonEmpty(field?.label, field?.key, field?.name, '');
      const value = displayValue(firstDefined(field?.text, field?.value, field?.number, field?.date));
      if (label || value) fields.push([label, value]);
    }
  }

  if (!fields.length) {
    fields.push(['Invoice Date', formatDate(raw.issueDate || raw.date)]);
    const due = raw.dueDateDate || raw.dueDate;
    if (due && typeof due !== 'number') fields.push(['Due Date', formatDate(due)]);
    if (raw.orderNumber) fields.push(['Order Number', String(raw.orderNumber)]);
  }

  for (const [label, value] of fields.filter(row => row[0] || row[1])) {
    const line = document.createElement('div');
    line.className = 'field-row';
    const left = document.createElement('span');
    const right = document.createElement('span');
    left.textContent = label || '';
    right.textContent = value || '';
    line.append(left, right);
    els.invoiceFields.appendChild(line);
  }
}

function renderInvoiceDescription(view, raw) {
  const description = firstNonEmpty(view.description, view.table?.description, raw.description, '');
  els.invoiceDescription.textContent = description;
  els.invoiceDescription.hidden = !description;
}

function renderViewTable(view) {
  const table = view?.table;
  if (!table || typeof table !== 'object') return false;

  const headers = table.headers || table.columns || [];
  const rows = table.rows || table.lines || [];
  const totals = table.totals || view.totals || [];

  if (!Array.isArray(rows) || !rows.length) return false;

  clearTable();
  const normalizedHeaders = Array.isArray(headers) && headers.length
    ? headers.map(header => displayValue(header))
    : inferHeadersFromRows(rows);

  addHeaderRow(normalizedHeaders);

  for (const row of flattenRows(rows)) {
    const cells = getRowCells(row);
    if (!cells.length) continue;
    addBodyRow(cells.map(displayValue), cells);
  }

  renderTotals(totals, normalizedHeaders.length || 2);
  return true;
}

function flattenRows(rows) {
  const output = [];
  const visit = row => {
    if (!row) return;
    output.push(row);
    const children = row.rows || row.children || row.subRows || [];
    if (Array.isArray(children)) children.forEach(visit);
  };
  rows.forEach(visit);
  return output;
}

function getRowCells(row) {
  if (Array.isArray(row)) return row;
  if (!row || typeof row !== 'object') return [row];
  if (Array.isArray(row.cells)) return row.cells;
  if (Array.isArray(row.columns)) return row.columns;
  if (Array.isArray(row.values)) return row.values;

  return Object.entries(row)
    .filter(([key, value]) => !['rows', 'children', 'subRows', 'isTotalRow', 'emphasis'].includes(key) && typeof value !== 'object')
    .map(([, value]) => value);
}

function inferHeadersFromRows(rows) {
  const first = rows.find(row => row && typeof row === 'object' && !Array.isArray(row));
  if (!first) return ['Description', 'Amount'];
  if (Array.isArray(first.cells)) return first.cells.map((_, i) => i === 0 ? 'Description' : `Column ${i + 1}`);
  return Object.keys(first).filter(key => !['rows', 'children', 'subRows', 'isTotalRow', 'emphasis'].includes(key));
}

function renderRawTable(raw) {
  clearTable();
  const headers = ['Description', 'Qty', 'Rate', 'Tax', 'Total'];
  addHeaderRow(headers);

  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  for (const line of lines) {
    const qty = numberOrNull(line.qty);
    const rate = numberOrNull(firstDefined(line.salesUnitPrice, line.currencyAmount));
    const tax = numberOrNull(line.taxAmount);
    const total = calculateLineTotal(line);
    addBodyRow([
      firstNonEmpty(line.lineDescription, line.description, line.itemName, 'Item'),
      formatNumber(qty),
      formatMoney(rate),
      formatMoney(tax),
      formatMoney(total)
    ], [null, qty, rate, tax, total]);
  }

  const grandTotal = calculateInvoiceTotal(raw);
  if (grandTotal !== null) {
    renderTotals([{ label: 'Total', number: grandTotal, emphasis: true }], headers.length);
  }
}

function clearTable() {
  els.invoiceTableHead.innerHTML = '';
  els.invoiceTableBody.innerHTML = '';
  els.invoiceTableFoot.innerHTML = '';
}

function addHeaderRow(headers) {
  const tr = document.createElement('tr');
  headers.forEach((header, index) => {
    const th = document.createElement('th');
    th.textContent = header || '';
    if (index > 0 && isLikelyNumericHeader(header)) th.className = 'numeric';
    tr.appendChild(th);
  });
  els.invoiceTableHead.appendChild(tr);
}

function addBodyRow(values, rawCells = []) {
  const tr = document.createElement('tr');
  values.forEach((value, index) => {
    const td = document.createElement('td');
    td.textContent = value ?? '';
    const raw = rawCells[index];
    if (index > 0 && (typeof raw === 'number' || raw?.number !== undefined || isNumericText(value))) {
      td.className = 'numeric';
    }
    tr.appendChild(td);
  });
  els.invoiceTableBody.appendChild(tr);
}

function renderTotals(totals, columnCount) {
  if (!Array.isArray(totals)) return;

  for (const total of totals) {
    const label = firstNonEmpty(total?.label, total?.key, total?.name, '');
    const value = displayValue(firstDefined(total?.text, total?.value, total?.number, total?.amount));
    if (!label && !value) continue;

    const tr = document.createElement('tr');
    if (total?.emphasis || /grand total|balance due|^total$/i.test(label)) tr.className = 'total-emphasis';

    const labelTd = document.createElement('td');
    labelTd.colSpan = Math.max(1, columnCount - 1);
    labelTd.textContent = label;
    labelTd.style.textAlign = 'right';

    const valueTd = document.createElement('td');
    valueTd.textContent = value;
    valueTd.className = 'numeric';

    tr.append(labelTd, valueTd);
    els.invoiceTableFoot.appendChild(tr);
  }
}

function prepareWhatsAppControls() {
  const phoneInfo = findBestPhone(state.customer || {}, state.viewInvoice || {});
  els.phoneInput.value = phoneInfo.value || '';
  els.phoneHint.textContent = phoneInfo.value
    ? `Detected from: ${phoneInfo.source}`
    : 'Number nahi mila. Customer ka WhatsApp number 92XXXXXXXXXX format mein enter karein.';

  const customerName = firstNonEmpty(
    state.viewInvoice?.recipient?.name,
    state.customer?.name,
    'Customer'
  );
  const reference = getInvoiceReference(state.viewInvoice || {}, state.rawInvoice || {}) || '—';
  const date = getInvoiceDate(state.viewInvoice || {}, state.rawInvoice || {});
  const total = getDisplayTotal(state.viewInvoice || {}, state.rawInvoice || {});
  const businessName = firstNonEmpty(state.viewInvoice?.business?.name, CONFIG.companyFallback);

  els.messageInput.value = [
    `Assalam-o-Alaikum ${customerName},`,
    '',
    `Please find Invoice #${reference}${date ? ` dated ${date}` : ''}${total ? `, amounting to ${total}` : ''}.`,
    '',
    'Kindly review the invoice and confirm receipt.',
    '',
    'Regards,',
    businessName
  ].join('\n');
}

function findBestPhone(customer, view) {
  const directCandidates = [
    ['Customer WhatsApp', customer.whatsapp],
    ['Customer Mobile', customer.mobile],
    ['Customer Phone', customer.phone],
    ['Customer Telephone', customer.telephone],
    ['Recipient Phone', view?.recipient?.phone],
    ['Recipient Mobile', view?.recipient?.mobile]
  ];

  for (const [source, value] of directCandidates) {
    const phone = normalizePhone(value);
    if (phone) return { value: phone, source };
  }

  const customValues = extractCustomerCustomStringValues(customer);
  const ranked = customValues
    .map(entry => {
      const normalizedName = normalizeLabel(entry.name);
      const rank = CONFIG.phoneFieldNames.findIndex(name => normalizedName.includes(name));
      return { ...entry, rank, phone: normalizePhone(entry.value) };
    })
    .filter(entry => entry.phone)
    .sort((a, b) => {
      const ar = a.rank < 0 ? 999 : a.rank;
      const br = b.rank < 0 ? 999 : b.rank;
      return ar - br;
    });

  if (ranked.length) {
    return { value: ranked[0].phone, source: ranked[0].name || 'Customer custom field' };
  }

  const deepMatches = [];
  deepSearchPhones(customer, [], deepMatches);
  if (deepMatches.length) return deepMatches[0];

  return { value: '', source: '' };
}

function extractCustomerCustomStringValues(customer) {
  const values = [];
  const containers = [
    customer?.customFields2?.strings,
    customer?.customFields,
    customer?.customFieldValues
  ];

  for (const container of containers) {
    if (!container) continue;

    if (Array.isArray(container)) {
      for (const item of container) {
        const key = item?.key || item?.id || item?.customField || item?.customFieldKey;
        const value = firstDefined(item?.value, item?.text, item?.string);
        const name = item?.name || item?.label || state.customFieldDefinitions.get(String(key)) || String(key || 'Custom field');
        if (typeof value === 'string') values.push({ key, name, value });
      }
    } else if (typeof container === 'object') {
      for (const [key, rawValue] of Object.entries(container)) {
        const value = rawValue?.value ?? rawValue?.text ?? rawValue;
        const name = state.customFieldDefinitions.get(String(key)) || key;
        if (typeof value === 'string') values.push({ key, name, value });
      }
    }
  }

  return values;
}

function deepSearchPhones(value, path, matches, depth = 0) {
  if (depth > 5 || matches.length > 10 || value == null) return;

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      const label = normalizeLabel(key);
      if (typeof child === 'string' && /(whatsapp|mobile|phone|telephone|contact|cell)/.test(label)) {
        const phone = normalizePhone(child);
        if (phone) matches.push({ value: phone, source: nextPath.join('.') });
      } else {
        deepSearchPhones(child, nextPath, matches, depth + 1);
      }
    }
  }
}

function openWhatsApp() {
  const phone = normalizePhone(els.phoneInput.value);
  const message = els.messageInput.value.trim();

  if (!phone) {
    alert('Valid WhatsApp number enter karein. Pakistan format: 92XXXXXXXXXX');
    els.phoneInput.focus();
    return;
  }

  if (!message) {
    alert('WhatsApp message empty hai.');
    els.messageInput.focus();
    return;
  }

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) window.top.location.href = url;
}

async function copyMessage() {
  const text = els.messageInput.value;
  try {
    await navigator.clipboard.writeText(text);
    const old = els.copyButton.textContent;
    els.copyButton.textContent = 'Copied';
    window.setTimeout(() => { els.copyButton.textContent = old; }, 1400);
  } catch {
    els.messageInput.select();
    document.execCommand('copy');
  }
}

function normalizePhone(input) {
  if (input == null) return '';
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = CONFIG.defaultCountryCode + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith('3')) digits = CONFIG.defaultCountryCode + digits;

  return /^\d{8,15}$/.test(digits) ? digits : '';
}

function getInvoiceReference(view, raw) {
  const fromFields = findFieldValue(view?.fields, /(invoice|reference|ref\.?|number|no\.?)/i);
  return firstNonEmpty(raw?.reference, raw?.invoiceNumber, fromFields, raw?.key?.slice?.(0, 8), '');
}

function getInvoiceDate(view, raw) {
  const fromFields = findFieldValue(view?.fields, /date/i);
  return formatDate(firstNonEmpty(raw?.issueDate, raw?.date, fromFields, ''));
}

function getDisplayTotal(view, raw) {
  const totals = view?.table?.totals || view?.totals || [];
  if (Array.isArray(totals)) {
    const preferred = totals.find(t => /^total$/i.test(String(t?.label || t?.key || '')))
      || totals.find(t => /grand total|balance due/i.test(String(t?.label || t?.key || '')))
      || [...totals].reverse().find(t => t?.emphasis)
      || totals[totals.length - 1];
    if (preferred) {
      const displayed = displayValue(firstDefined(preferred.text, preferred.value, preferred.number, preferred.amount));
      if (displayed) return displayed;
    }
  }

  const total = calculateInvoiceTotal(raw);
  return total === null ? '' : formatMoney(total);
}

function findFieldValue(fields, regex) {
  if (!Array.isArray(fields)) return '';
  const found = fields.find(field => regex.test(String(field?.label || field?.key || field?.name || '')));
  return found ? displayValue(firstDefined(found.text, found.value, found.number, found.date)) : '';
}

function calculateInvoiceTotal(raw) {
  if (!raw || !Array.isArray(raw.lines)) return null;
  let hasValue = false;
  let sum = 0;
  for (const line of raw.lines) {
    const value = calculateLineTotal(line);
    if (value !== null) { hasValue = true; sum += value; }
  }
  return hasValue ? sum : null;
}

function calculateLineTotal(line) {
  const provided = numberOrNull(firstDefined(line?.total, line?.amount));
  if (provided !== null) return provided;

  const qty = numberOrNull(line?.qty) ?? 1;
  const rate = numberOrNull(firstDefined(line?.salesUnitPrice, line?.currencyAmount));
  if (rate === null) return null;

  let total = qty * rate;
  const discountAmount = numberOrNull(line?.discountAmount);
  const discountPercentage = numberOrNull(line?.discountPercentage);
  if (discountAmount !== null) total -= discountAmount;
  else if (discountPercentage !== null) total -= total * (discountPercentage / 100);

  const tax = numberOrNull(line?.taxAmount);
  if (tax !== null) total += tax;
  return total;
}

function displayValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return displayValue(firstDefined(
      value.text, value.formatted, value.label, value.name,
      value.value, value.number, value.amount, value.date
    ));
  }
  return String(value);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date);
}

function formatNumber(value) {
  const number = numberOrNull(value);
  if (number === null) return value == null ? '' : String(value);
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(number);
}

function formatMoney(value) {
  const number = numberOrNull(value);
  if (number === null) return value == null ? '' : String(value);
  return `PKR ${new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number)}`;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '';
}

function normalizeLabel(value) {
  return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isLikelyNumericHeader(value) {
  return /(qty|quantity|rate|price|tax|amount|total|balance|debit|credit)/i.test(String(value || ''));
}

function isNumericText(value) {
  return /^\s*(PKR|Rs\.?|[$€£])?\s*-?[\d,.]+\s*$/i.test(String(value || ''));
}

function setStatus(type, title, text) {
  els.statusDot.className = `status-dot ${type}`;
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
  els.statusCard.hidden = false;
}

function showLoadingUi() {
  hideError();
  els.controls.hidden = true;
  els.invoicePreview.hidden = true;
  setStatus('loading', 'Invoice load ho rahi hai…', `Invoice key: ${state.invoiceKey}`);
}

function showError(message) {
  setStatus('error', 'Invoice load nahi hui', 'Neeche error detail check karein.');
  els.errorText.textContent = message;
  els.errorCard.hidden = false;
  els.controls.hidden = true;
  els.invoicePreview.hidden = true;
  notifyResize();
}

function hideError() {
  els.errorCard.hidden = true;
  els.errorText.textContent = '';
}

function installAutoResize() {
  if (!('ResizeObserver' in window)) return;
  const observer = new ResizeObserver(() => notifyResize());
  observer.observe(document.documentElement);
}

function notifyResize() {
  window.requestAnimationFrame(() => {
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      420
    );
    window.parent.postMessage({ type: 'resize', height }, '*');
  });
}

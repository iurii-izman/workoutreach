const root = document.querySelector('#app');
const state = { csrf: null, cursor: null, loading: false, selected: null, poll: null };

const STATUS_LABELS = {
  NOT_CONTACTED: 'Не отправлено', SENT_WAITING: 'Отправлено · ждём ответа', REPLIED: 'Ответили',
  INTERESTED: 'Есть интерес', FOLLOW_UP_LATER: 'Вернуться позже', NOT_INTERESTED: 'Не актуально',
  DO_NOT_CONTACT: 'Не связываться',
};
const DELIVERY_LABELS = {
  SMTP_ACCEPTED: 'Отправлено — принято Gmail SMTP', MOCK: 'Тест — email не отправлен',
  SMTP_PENDING: 'Ожидает SMTP', SMTP_CLAIMED: 'Передаётся SMTP', ERROR: 'Техническая ошибка', NOT_SENT: 'Не отправлено',
};
const TABS = [
  ['SENT_WAITING', 'Отправлено / ждём ответа'], ['', 'Все'], ['REPLIED', 'Ответили'], ['INTERESTED', 'Есть интерес'],
  ['FOLLOW_UP_LATER', 'Вернуться позже'], ['NOT_INTERESTED', 'Не актуально'], ['ERROR', 'Ошибки'],
];

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function maskedJob(value) { return value || '—'; }

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({ error: 'RESPONSE_INVALID' }));
  if (response.status === 401) {
    renderLogin('Сессия истекла. Войдите снова.');
    throw new Error('SESSION_EXPIRED');
  }
  if (!response.ok) {
    const error = new Error(body.error || 'REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  return body;
}

function renderLogin(message = '') {
  document.title = 'Вход — Workoutreach';
  if (state.poll) clearInterval(state.poll);
  root.replaceChildren();
  const password = element('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: '', minlength: '12' });
  const notice = element('p', { className: 'form-notice', text: message, role: 'status' });
  const button = element('button', { type: 'submit', text: 'Войти' });
  const form = element('form', { className: 'login-card', onsubmit: async (event) => {
    event.preventDefault();
    button.disabled = true;
    notice.textContent = '';
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: password.value }) });
      state.csrf = result.csrfToken;
      password.value = '';
      await renderDashboard();
    } catch (error) {
      notice.textContent = error.message === 'LOGIN_RATE_LIMITED' ? 'Слишком много попыток. Попробуйте позже.' : 'Пароль не принят.';
      password.focus();
    } finally { button.disabled = false; }
  } }, [
    element('div', { className: 'brand-mark', text: 'W' }),
    element('p', { className: 'eyebrow', text: 'WORKOUTREACH' }),
    element('h1', { text: 'Панель владельца' }),
    element('p', { className: 'muted', text: 'Локальная витрина компаний и истории outreach. Отправка писем здесь невозможна.' }),
    element('label', { for: 'password', text: 'Локальный пароль' }), password, button, notice,
  ]);
  root.append(element('main', { id: 'main', className: 'login-shell' }, form));
  password.focus();
}

function statCard(label, value, tone = '') {
  return element('article', { className: `stat-card ${tone}` }, [element('span', { text: label }), element('strong', { text: String(value ?? 0) })]);
}

function filtersFromDom() {
  return {
    q: document.querySelector('#search').value.trim(),
    engagementStatus: document.querySelector('[role=tab][aria-selected=true]')?.dataset.status || document.querySelector('#engagement-filter').value,
    deliveryStatus: document.querySelector('#delivery-filter').value,
    sentFrom: document.querySelector('#sent-from').value,
    sentTo: document.querySelector('#sent-to').value,
    sort: document.querySelector('#sort').value,
  };
}

function queryString(cursor = null) {
  const params = new URLSearchParams({ limit: '25', ...filtersFromDom() });
  for (const [key, value] of [...params]) if (!value || (key === 'engagementStatus' && value === 'ERROR')) params.delete(key);
  if (filtersFromDom().engagementStatus === 'ERROR') params.set('deliveryStatus', 'ERROR');
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

function badge(text, kind) {
  return element('span', { className: `badge badge-${kind.toLowerCase()}`, text, title: kind === 'SMTP_ACCEPTED' ? 'Не подтверждает доставку во входящие или прочтение' : null });
}

function rowFor(company) {
  const button = element('button', { className: 'company-link', type: 'button', text: company.companyName, onclick: () => openDetail(company.companyId) });
  const tr = element('tr', { tabindex: '0', onkeydown: (event) => { if (event.key === 'Enter') openDetail(company.companyId); } }, [
    element('td', {}, [button, element('small', { text: company.fact || company.canonicalHostname })]),
    element('td', {}, [element('a', { href: company.canonicalUrl, target: '_blank', rel: 'noreferrer', text: company.canonicalHostname })]),
    element('td', { text: company.maskedRecipientEmail || '—' }),
    element('td', { text: formatDate(company.lastSmtpAcceptedAt) }),
    element('td', {}, badge(DELIVERY_LABELS[company.deliveryStatus], company.deliveryStatus)),
    element('td', {}, badge(STATUS_LABELS[company.engagementStatus], company.engagementStatus)),
    element('td', { text: formatDate(company.nextActionAt) }),
    element('td', { text: maskedJob(company.lastJobId) }),
  ]);
  return tr;
}

async function loadCompanies({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const body = document.querySelector('#company-body');
  const notice = document.querySelector('#list-notice');
  const more = document.querySelector('#load-more');
  notice.textContent = append ? 'Загружаем следующую страницу…' : 'Загружаем компании…';
  try {
    const result = await api(`/api/companies?${queryString(append ? state.cursor : null)}`);
    if (!append) body.replaceChildren();
    for (const company of result.items) body.append(rowFor(company));
    state.cursor = result.nextCursor;
    more.hidden = !state.cursor;
    const noSent = filtersFromDom().engagementStatus === 'SENT_WAITING' && result.items.length === 0;
    notice.textContent = result.items.length === 0
      ? (noSent ? 'Пока нет писем, принятых Gmail SMTP.' : 'По выбранным фильтрам компаний нет.')
      : `Показано записей: ${body.children.length}`;
  } catch (error) {
    if (error.message !== 'SESSION_EXPIRED') notice.textContent = 'Не удалось обновить список. Повторите попытку.';
  } finally { state.loading = false; }
}

function detailPair(label, value, link = false) {
  const content = link && value ? element('a', { href: value, target: '_blank', rel: 'noreferrer', text: value }) : element('span', { text: value || '—' });
  return element('div', { className: 'detail-pair' }, [element('dt', { text: label }), element('dd', {}, content)]);
}

function statusForm(company, dialog) {
  const select = element('select', { id: 'status-select', name: 'status' });
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    if ((value === 'SENT_WAITING' && company.engagementStatus !== value) || (value === 'NOT_CONTACTED' && company.sentAt)) continue;
    select.append(element('option', { value, text: label, selected: value === company.engagementStatus ? '' : null }));
  }
  select.value = company.engagementStatus;
  select.disabled = company.engagementStatus === 'DO_NOT_CONTACT';
  const note = element('textarea', { id: 'safe-note', maxlength: '500', rows: '3', placeholder: 'Без email, ссылок и секретов' });
  note.value = company.safeNote || '';
  note.disabled = select.disabled;
  const next = element('input', { id: 'next-action', type: 'datetime-local' });
  if (company.nextActionAt) next.value = new Date(company.nextActionAt).toISOString().slice(0, 16);
  next.disabled = select.value !== 'FOLLOW_UP_LATER' || select.disabled;
  const dnc = element('div', { className: 'dnc-confirm', hidden: '' });
  const confirm = element('input', { id: 'dnc-confirm', type: 'checkbox' });
  const reason = element('select', { id: 'dnc-reason' }, [
    element('option', { value: 'OWNER_BLOCK', text: 'Решение владельца' }),
    element('option', { value: 'RECIPIENT_REQUEST', text: 'Просьба адресата' }),
  ]);
  dnc.append(element('label', { for: 'dnc-confirm' }, [confirm, document.createTextNode(' Подтверждаю необратимую блокировку в панели')]), reason);
  const updateVisibility = () => {
    next.disabled = select.value !== 'FOLLOW_UP_LATER';
    dnc.hidden = select.value !== 'DO_NOT_CONTACT';
  };
  select.addEventListener('change', updateVisibility);
  updateVisibility();
  const message = element('p', { className: 'form-notice', role: 'status' });
  const submit = element('button', { type: 'submit', text: 'Сохранить статус', disabled: select.disabled ? '' : null });
  return element('form', { className: 'status-form', onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = 'Сохраняем…';
    const actionKey = `dashboard:${Date.now()}:${crypto.randomUUID()}`;
    try {
      await api(`/api/companies/${company.companyId}/status`, { method: 'PATCH', body: JSON.stringify({
        engagementStatus: select.value,
        expectedVersion: company.version,
        safeNote: note.value || null,
        nextActionAt: select.value === 'FOLLOW_UP_LATER' && next.value ? new Date(next.value).toISOString() : null,
        actionKey,
        confirmDoNotContact: confirm.checked,
        doNotContactReason: select.value === 'DO_NOT_CONTACT' ? reason.value : null,
      }) });
      message.textContent = 'Статус обновлён.';
      await openDetail(company.companyId, dialog);
      await refreshAll();
    } catch (error) {
      message.textContent = error.status === 409
        ? 'Запись уже изменилась. Данные обновлены — проверьте статус и повторите.'
        : `Изменение отклонено: ${error.message}`;
      if (error.status === 409) await openDetail(company.companyId, dialog);
    } finally { submit.disabled = false; }
  } }, [element('h3', { text: 'Ручной engagement status' }), select, element('label', { for: 'safe-note', text: 'Безопасная заметка' }), note,
    element('label', { for: 'next-action', text: 'Следующее действие' }), next, dnc, submit, message]);
}

async function openDetail(companyId, existingDialog = null) {
  const dialog = existingDialog || document.querySelector('#detail-dialog');
  const panel = dialog.querySelector('.drawer-body');
  panel.replaceChildren(element('p', { className: 'loading', text: 'Загружаем карточку…' }));
  if (!dialog.open) dialog.showModal();
  try {
    const result = await api(`/api/companies/${companyId}`);
    const company = result.company;
    state.selected = company;
    const header = element('div', { className: 'drawer-heading' }, [
      element('div', {}, [element('p', { className: 'eyebrow', text: company.canonicalHostname }), element('h2', { text: company.companyName })]),
      element('button', { type: 'button', className: 'icon-button', 'aria-label': 'Закрыть', text: '×', onclick: () => dialog.close() }),
    ]);
    const details = element('dl', { className: 'detail-grid' }, [
      detailPair('Сайт', company.canonicalUrl, true), detailPair('Адресат', company.recipientEmail),
      detailPair('Источник контакта', company.contactSourceUrl, true), detailPair('Job ID', company.sentJobId || company.lastJobId),
      detailPair('SMTP acceptance', formatDate(company.lastSmtpAcceptedAt)), detailPair('Отправок', String(company.sendCount)),
    ]);
    const draft = company.bodyText
      ? element('section', { className: 'drawer-section' }, [element('h3', { text: 'Фактически отправленное письмо' }), element('strong', { text: company.subject }), element('pre', { text: company.bodyText })])
      : element('section', { className: 'empty-panel' }, [element('h3', { text: 'Email не отправлялся' }), element('p', { text: 'Нет SMTP_ACCEPTED — черновик не выдаётся за отправленное письмо.' })]);
    const evidence = element('section', { className: 'drawer-section' }, [
      element('h3', { text: 'Подтверждённое основание' }), element('p', { text: company.evidenceExcerpt || company.fact || '—' }),
      company.evidenceSourceUrl ? element('a', { href: company.evidenceSourceUrl, target: '_blank', rel: 'noreferrer', text: 'Открыть источник' }) : null,
      element('h4', { text: 'Персональная фраза' }), element('p', { text: company.personalizationPhrase || '—' }),
    ]);
    const timeline = element('ol', { className: 'timeline' });
    for (const event of result.timeline) timeline.append(element('li', {}, [
      element('time', { text: formatDate(event.createdAt) }), element('strong', { text: event.eventType }),
      element('span', { text: event.fromStatus ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}` : event.eventGroup }),
    ]));
    panel.replaceChildren(header, details, badge(DELIVERY_LABELS[company.deliveryStatus], company.deliveryStatus),
      element('p', { className: 'smtp-hint', text: company.deliveryStatus === 'SMTP_ACCEPTED' ? 'Не подтверждает доставку во входящие или прочтение.' : '' }),
      evidence, draft, statusForm(company, dialog), element('section', { className: 'drawer-section' }, [element('h3', { text: 'История' }), timeline]));
  } catch (error) {
    if (error.message !== 'SESSION_EXPIRED') panel.replaceChildren(element('p', { className: 'error-panel', text: 'Не удалось открыть карточку.' }));
  }
}

async function refreshAll() {
  try {
    const stats = await api('/api/stats');
    document.querySelector('#stats').replaceChildren(
      statCard('SMTP принято', stats.smtpAcceptedCount, 'positive'), statCard('Ждём ответа', stats.sentWaitingCount),
      statCard('Ответили', stats.repliedCount), statCard('Есть интерес', stats.interestedCount, 'accent'),
      statCard('Требуют внимания', stats.attentionCount, 'warning'),
    );
    state.cursor = null;
    await loadCompanies();
    document.querySelector('#last-refresh').textContent = `Обновлено ${new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(new Date())}`;
  } catch (error) { if (error.message !== 'SESSION_EXPIRED') document.querySelector('#last-refresh').textContent = 'Ошибка обновления'; }
}

async function renderDashboard() {
  document.title = 'Компании — Workoutreach';
  if (!state.csrf) state.csrf = (await api('/api/session')).csrfToken;
  root.replaceChildren();
  const search = element('input', { id: 'search', type: 'search', placeholder: 'Название, домен, email или job ID', 'aria-label': 'Поиск компаний' });
  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(refreshAll, 350); });
  const tabs = element('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Статусы компаний' });
  for (const [status, label] of TABS) tabs.append(element('button', {
    type: 'button', role: 'tab', className: 'tab', text: label, 'aria-selected': status === 'SENT_WAITING' ? 'true' : 'false',
    'data-status': status, onclick: (event) => {
      for (const tab of tabs.children) tab.setAttribute('aria-selected', 'false');
      event.currentTarget.setAttribute('aria-selected', 'true');
      document.querySelector('#delivery-filter').value = status === 'ERROR' ? 'ERROR' : '';
      refreshAll();
    },
  }));
  const engagement = element('select', { id: 'engagement-filter', 'aria-label': 'Engagement status', onchange: refreshAll }, [element('option', { value: '', text: 'Любой engagement status' })]);
  for (const [value, label] of Object.entries(STATUS_LABELS)) engagement.append(element('option', { value, text: label }));
  const delivery = element('select', { id: 'delivery-filter', 'aria-label': 'Delivery status', onchange: refreshAll }, [element('option', { value: '', text: 'Любой delivery status' })]);
  for (const [value, label] of Object.entries(DELIVERY_LABELS)) delivery.append(element('option', { value, text: label }));
  const drawer = element('dialog', { id: 'detail-dialog', className: 'drawer', onclick: (event) => { if (event.target === drawer) drawer.close(); } }, element('div', { className: 'drawer-body' }));
  const logout = element('button', { className: 'secondary', type: 'button', text: 'Выйти', onclick: async () => { await api('/auth/logout', { method: 'POST' }); state.csrf = null; renderLogin(); } });
  const main = element('main', { id: 'main', className: 'dashboard-shell' }, [
    element('header', { className: 'topbar' }, [element('div', {}, [element('p', { className: 'eyebrow', text: 'WORKOUTREACH' }), element('h1', { text: 'Компании' }), element('p', { className: 'muted', text: 'Операционная витрина без функций отправки и редактирования писем' })]), logout]),
    element('section', { id: 'stats', className: 'stats', 'aria-label': 'Сводка' }),
    tabs,
    element('section', { className: 'filters', 'aria-label': 'Фильтры' }, [search, engagement, delivery,
      element('label', {}, [document.createTextNode('От '), element('input', { id: 'sent-from', type: 'date', onchange: refreshAll })]),
      element('label', {}, [document.createTextNode('До '), element('input', { id: 'sent-to', type: 'date', onchange: refreshAll })]),
      element('select', { id: 'sort', 'aria-label': 'Сортировка', onchange: refreshAll }, [element('option', { value: 'updated', text: 'По изменению' }), element('option', { value: 'last_sent', text: 'По последней отправке' })]),
      element('button', { type: 'button', className: 'secondary', text: 'Обновить', onclick: refreshAll }),
    ]),
    element('div', { className: 'list-meta' }, [element('p', { id: 'list-notice', role: 'status', text: 'Загрузка…' }), element('span', { id: 'last-refresh' })]),
    element('div', { className: 'table-wrap' }, element('table', {}, [
      element('thead', {}, element('tr', {}, ['Компания и факт', 'Сайт', 'Email', 'SMTP acceptance', 'Delivery', 'Engagement', 'Следующая дата', 'Job ID'].map((text) => element('th', { scope: 'col', text })))),
      element('tbody', { id: 'company-body' }),
    ])),
    element('button', { id: 'load-more', type: 'button', className: 'secondary load-more', text: 'Показать ещё', hidden: '', onclick: () => loadCompanies({ append: true }) }),
    drawer,
  ]);
  root.append(main);
  await refreshAll();
  state.poll = setInterval(() => { if (!document.hidden && !drawer.open) refreshAll(); }, 30_000);
}

if (document.body.dataset.authenticated === 'true') renderDashboard().catch(() => renderLogin('Сессия недоступна. Войдите снова.'));
else renderLogin();

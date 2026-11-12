// Дартс-Центр: заявки с сайта → задача в IntraService.
// Yandex Cloud Functions, среда Node.js 18 или новее, точка входа index.handler.
//
// Переменные окружения функции:
//   INTRA_URL        https://darts-center.intraservice.ru
//   INTRA_LOGIN      APIUser
//   INTRA_PASSWORD   пароль APIUser (лучше как секрет Lockbox)
//   SERVICE_ID       1    — сервис «Лицензии Дартс-Центр»
//   TYPE_ID          0    — тип заявки; 0 = тип по умолчанию для сервиса
//   ROLE_ID          54   — роль новых заявителей
//   COMPANY_ID       86   — компания новых заявителей
//   ALLOWED_ORIGINS  https://johnrzncl1-cyber.github.io  (через запятую, если адресов несколько)

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const INTRA_URL = env('INTRA_URL').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(env('INTRA_LOGIN') + ':' + env('INTRA_PASSWORD')).toString('base64');
const SERVICE_ID = +env('SERVICE_ID', '1');
const TYPE_ID = +env('TYPE_ID', '0');
const ROLE_ID = +env('ROLE_ID', '54');
const COMPANY_ID = +env('COMPANY_ID', '86');
const ORIGINS = env('ALLOWED_ORIGINS').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLANS = ['Демо', 'Старт', 'Стандарт', 'Клуб', 'Академия', 'Вопрос'];
const hits = new Map();   // простое ограничение частоты: не больше 5 заявок за 10 минут с одного адреса

function cors(origin) {
  const ok = ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (ORIGINS[0] || 'null'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const reply = (code, obj, origin) => ({
  statusCode: code,
  headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(obj)
});

async function intra(method, path, body) {
  if (!INTRA_URL) throw new Error('Не задана переменная INTRA_URL');
  if (!env('INTRA_LOGIN') || !env('INTRA_PASSWORD')) throw new Error('Не заданы INTRA_LOGIN или INTRA_PASSWORD');
  let r;
  try {
    r = await fetch(INTRA_URL + path, {
      method,
      headers: { Authorization: AUTH, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    const c = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    throw new Error(`Нет связи с ${INTRA_URL}: ${e && e.message}${c}`);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  if (!r.ok) {
    let m = (data && (data.Message || data.message)) || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (r.status === 401) m = 'неверный логин или пароль ' + env('INTRA_LOGIN') + '. ' + m;
    if (r.status === 403) m = 'у ' + env('INTRA_LOGIN') + ' нет прав на это действие. ' + m;
    throw new Error(`IntraService ${method} ${path.split('?')[0]}: HTTP ${r.status} ${m}`);
  }
  return data;
}
const list = d => Array.isArray(d) ? d : (d && Object.values(d).find(Array.isArray)) || [];

async function findUser(email) {
  const e = email.toLowerCase();
  const d = await intra('GET', `/api/user?email=${encodeURIComponent(email)}&fields=Id,Name,Email,IsArchive&pagesize=100`);
  let archived = null;
  for (const u of list(d)) {
    const mails = String(u.Email || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
    if (mails.includes(e)) { if (!u.IsArchive) return u; archived = archived || u; }
  }
  return archived;
}

async function newUser(email, fio) {
  const pw = 'Dc' + require('crypto').randomBytes(12).toString('hex') + '7!';
  let u = await intra('POST', '/api/user', {
    Name: email, Login: email, Email: email, Password: pw, ConfirmPassword: pw,
    RoleId: ROLE_ID, CompanyId: COMPANY_ID, Comments: fio
  });
  if (u && !u.Id && u.User) u = u.User;
  if (!u || !u.Id) throw new Error('IntraService не вернул номер созданного пользователя');
  return u;
}

async function taskDefaults() {
  let q = `/api/newtask?serviceid=${SERVICE_ID}` + (TYPE_ID ? `&tasktypeid=${TYPE_ID}` : '');
  let nt = await intra('GET', q);
  if (nt && nt.Task) nt = nt.Task;
  let typeId = TYPE_ID || +(nt && nt.TypeId) || 0;
  if (!typeId) {
    for (const t of list(await intra('GET', `/api/tasktype?serviceid=${SERVICE_ID}`))) if (!t.IsArchive && t.Id) { typeId = +t.Id; break; }
  }
  if (!typeId) throw new Error('Не удалось определить тип заявки — задайте TYPE_ID');
  if (!(nt && nt.StatusId) && !TYPE_ID) {
    nt = await intra('GET', `/api/newtask?serviceid=${SERVICE_ID}&tasktypeid=${typeId}`);
    if (nt && nt.Task) nt = nt.Task;
  }
  const statusId = +(nt && nt.StatusId) || 0, priorityId = +(nt && nt.PriorityId) || 0;
  if (!statusId || !priorityId) throw new Error('IntraService не вернул статус и приоритет по умолчанию');
  return { typeId, statusId, priorityId };
}

const clip = (v, n) => String(v ?? '').replace(/\s+$/g, '').slice(0, n).trim();

module.exports.handler = async function (event) {
  const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const origin = (h.origin || '').replace(/\/+$/, '');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(origin), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Только POST' }, origin);
  if (ORIGINS.length && !ORIGINS.includes(origin)) return reply(403, { ok: false, error: 'Запрос не с сайта Дартс-Центр' }, origin);

  const ip = String(h['x-forwarded-for'] || (event.requestContext && event.requestContext.identity && event.requestContext.identity.sourceIp) || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 5) return reply(429, { ok: false, error: 'Слишком много заявок подряд. Попробуйте через 10 минут.' }, origin);

  let d;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (raw.length > 20000) throw 0;
    d = JSON.parse(raw);
  } catch { return reply(400, { ok: false, error: 'Неверный формат заявки' }, origin); }

  if (d.website) return reply(200, { ok: true }, origin);                       // ловушка для ботов
  if (+d.elapsed && +d.elapsed < 3000) return reply(200, { ok: true }, origin);  // форма заполнена быстрее 3 секунд — бот

  const name = clip(d.name, 120), email = clip(d.email, 120).toLowerCase(), phone = clip(d.phone, 40);
  const club = clip(d.club, 150), size = clip(d.size, 40), msg = clip(d.message, 4000);
  const plan = PLANS.includes(d.plan) ? d.plan : 'Вопрос';
  if (!name) return reply(400, { ok: false, error: 'Укажите имя' }, origin);
  if (!EMAIL_RE.test(email)) return reply(400, { ok: false, error: 'Проверьте адрес электронной почты' }, origin);
  if (!d.agree) return reply(400, { ok: false, error: 'Нужно согласие на обработку данных' }, origin);

  let step = 'поиск заявителя по e-mail';
  try {
    let user = await findUser(email), created = false;
    if (!user) { step = 'создание пользователя-заявителя'; user = await newUser(email, name); created = true; }
    step = 'тип, статус и приоритет заявки по умолчанию';
    const { typeId, statusId, priorityId } = await taskDefaults();
    const title = `Заявка с сайта: ${plan === 'Вопрос' ? 'вопрос' : 'тариф «' + plan + '»'}${club ? ' — ' + club : ''}`.slice(0, 250);
    const description = [
      msg || '(без комментария)',
      '',
      '—',
      'Имя: ' + name,
      'Клуб или секция: ' + (club || '—'),
      'E-mail: ' + email,
      'Телефон: ' + (phone || '—'),
      'Игроков в клубе: ' + (size || '—'),
      'Интересует: ' + plan,
      '',
      'Источник: сайт ' + (origin || '—')
    ].join('\n');
    step = 'создание задачи';
    let t = await intra('POST', '/api/task', {
      Name: title, Description: description,
      ServiceId: SERVICE_ID, TypeId: typeId, StatusId: statusId, PriorityId: priorityId,
      CreatorId: +user.Id
    });
    if (t && !t.Id && t.Task) t = t.Task;
    recent.push(now); hits.set(ip, recent);
    return reply(200, { ok: true, id: t && t.Id, userCreated: created }, origin);
  } catch (e) {
    const detail = String(e && e.message ? e.message : e).slice(0, 400);
    console.error('Шаг «' + step + '»: ' + detail);
    return reply(502, { ok: false, error: 'Не удалось создать заявку. Попробуйте позже.', step, detail }, origin);
  }
};

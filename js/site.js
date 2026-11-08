/* Сайт программы. Настройки заявки: */
const LEAD = {
  email: 'darts-center@yandex.ru',                                   // куда приходят заявки
  endpoint: 'https://formsubmit.co/ajax/darts-center@yandex.ru',     // сервис отправки писем FormSubmit
  tag: '#дартс-центр.лицензии'                                       // начало темы письма
};

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- вкладки разделов ---------- */
  const tabs = $$('.tabs [role=tab]');
  const select = (t, focus) => {
    tabs.forEach(b => {
      const on = b === t;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      $('#' + b.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) t.focus();
    t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); select(tabs[j], true); }
    });
  });

  /* ---------- переключение снимков внутри вкладки ---------- */
  $$('[data-sub]').forEach(sub => {
    const shot = sub.parentElement.querySelector('.shot');
    const img = shot.querySelector('img');
    $$('button', sub).forEach(b => b.addEventListener('click', () => {
      $$('button', sub).forEach(x => x.setAttribute('aria-pressed', x === b));
      img.src = b.dataset.img;
      img.alt = b.dataset.cap;
      shot.dataset.full = b.dataset.full || b.dataset.img;
      shot.dataset.cap = b.dataset.cap;
    }));
  });

  /* ---------- просмотр снимка ---------- */
  const lb = $('#lb'), lbImg = $('#lb-img'), lbCap = $('#lb-cap');
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-full]');
    if (!s || s.closest('[data-sub]')) return;
    lbImg.src = s.dataset.full;
    lbImg.alt = s.dataset.cap || '';
    lbCap.textContent = s.dataset.cap || '';
    lb.classList.toggle('narrow', s.hasAttribute('data-narrow'));
    if (lb.showModal) lb.showModal(); else window.open(s.dataset.full, '_blank');
  });
  $('.lb-x').addEventListener('click', () => lb.close());
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

  /* ---------- подсветка текущего раздела в меню ---------- */
  const links = $$('#nav a');
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      links.forEach(a => a.removeAttribute('aria-current'));
      const a = map.get(en.target.id);
      if (a) { a.setAttribute('aria-current', 'true'); a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  map.forEach((a, id) => { const s = document.getElementById(id); if (s) io.observe(s); });

  /* ---------- заявка ---------- */
  $$('[data-plan]').forEach(b => b.addEventListener('click', () => { $('#plan').value = b.dataset.plan; }));
  const form = $('#lead'), msg = $('#lead-msg'), btn = form.querySelector('button[type=submit]');
  const say = (t, err) => { msg.textContent = t; msg.className = 'form-msg show' + (err ? ' err' : ''); };
  const mailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    for (const k in d) if (typeof d[k] === 'string') d[k] = d[k].trim();
    if (!d.name) { say('Укажите имя.', true); form.name.focus(); return; }
    if (!d.email) { say('Укажите электронную почту — на неё придёт ответ.', true); form.email.focus(); return; }
    if (!mailOk(d.email)) { say('Проверьте адрес электронной почты: в нём должны быть @ и домен, например club@mail.ru.', true); form.email.focus(); return; }
    if (!form.agree.checked) { say('Отметьте согласие на обработку данных.', true); return; }
    if (d._honey) return;
    const subject = [LEAD.tag, d.club, d.email].filter(Boolean).join(' ');
    const payload = {
      _subject: subject,
      _template: 'basic',
      _captcha: 'false',
      'Имя': d.name,
      'Клуб или секция': d.club || '—',
      email: d.email,
      'Телефон': d.phone || '—',
      'Игроков в клубе': d.size || '—',
      'Интересует': d.plan,
      'Комментарий': d.msg || '—'
    };
    btn.disabled = true; say('Отправляем заявку…');
    try {
      const r = await fetch(LEAD.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === 'false' || j.success === false) throw new Error(j.message || r.status);
      form.reset();
      say('Заявка отправлена. Мы ответим на указанную почту.');
    } catch (err) {
      say(`Заявка не отправилась. Напишите нам на ${LEAD.email} — тема: ${subject}`, true);
    } finally { btn.disabled = false; }
  });
})();

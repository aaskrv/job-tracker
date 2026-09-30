// Auto-submit filter forms on change
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  form.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', () => form.submit()));
});

// Upload a single file as the raw request body
document.querySelectorAll('form[data-upload]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.elements.file.files[0];
    if (file.size > 10 * 1024 * 1024) return window.alert('Файл больше 10 МБ');
    const res = await fetch(form.dataset.upload, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    if (res.ok) window.location = res.url;
    else window.alert(await res.text());
  });
});

// Confirm destructive actions
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
});

// Live progress of a manual collector run (banner rendered by partials/header.ejs)
const banner = document.getElementById('run-banner');
if (banner) {
  const STALL_MS = 3 * 60 * 1000;
  const field = (name) => banner.querySelector(`[data-${name}]`);
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let status = null;
  const tick = () => {
    if (!status) return;
    field('elapsed').textContent = mmss(Date.now() - new Date(status.startedAt));
    const stalled = Date.now() - new Date(status.lastEventAt) > STALL_MS;
    field('stall').hidden = !stalled;
    banner.classList.toggle('run-banner-warn', stalled);
  };
  const timer = setInterval(tick, 1000);
  const done = (last) => {
    clearInterval(timer);
    banner.className = `run-banner ${last?.error ? 'run-banner-bad' : 'run-banner-done'}`;
    banner.innerHTML = last?.error
      ? '<div><b>Сбор завершился с ошибкой.</b> <a href="/settings">Подробнее</a></div>'
      : '<div><b>Сбор завершён.</b> Новые вакансии появятся в списке в течение минуты. <a href="/settings">Отчёт и расход токенов</a></div>';
  };
  const poll = async () => {
    try {
      const { running, lastRun } = await (await fetch('/api/collector-status')).json();
      if (!running) return done(lastRun);
      status = running;
      field('expected').textContent = running.expectedSec ? ` из обычных ~${Math.max(1, Math.round(running.expectedSec / 60))} мин` : '';
      field('action').textContent = running.lastAction || 'Запускается…';
      field('steps').textContent = running.steps;
      field('vacancies').textContent = running.vacancies;
      field('tokens').textContent = running.tokens.toLocaleString('ru-RU');
      tick();
    } catch {}
    setTimeout(poll, 5000);
  };
  poll();
}

// View helpers, exposed to templates as `fmt`.

export function date(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateInput(d) {
  const x = d ? new Date(d) : new Date();
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysAgo(d) {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return days <= 0 ? 'сегодня' : `${days} дн. назад`;
}

const n = (x) => Math.round(x).toLocaleString('en-US');

export function netUsd(min, max) {
  if (min == null && max == null) return '';
  if (min != null && max != null && min !== max) return `$${n(min)} - $${n(max)}`;
  return `$${n(min ?? max)}`;
}

export function rawSalary(v) {
  if (v.salary_min == null && v.salary_max == null) return '';
  const range = v.salary_min != null && v.salary_max != null && v.salary_min !== v.salary_max
    ? `${n(v.salary_min)} - ${n(v.salary_max)}` : n(v.salary_min ?? v.salary_max);
  const period = { year: '/год', month: '/мес', hour: '/час' }[v.salary_period] || '';
  const type = v.salary_type === 'unknown' ? '' : ` ${v.salary_type}`;
  return `${range} ${v.salary_currency || ''}${period}${type}`;
}

export const labels = {
  remote: { remote: 'Удалённо', hybrid: 'Гибрид', onsite: 'Офис', unknown: '?' },
  fit: { yes: 'подходит', maybe: 'на грани', no: 'ниже', unknown: 'не указана' },
  status: { new: 'Новая', shortlisted: 'Интересна', skipped: 'Отказался', closed: 'Закрыта', applied_before: 'Уже подавал' },
  tri: { yes: 'да', no: 'нет', unknown: '?' },
};

export function bool(v) {
  return v === true ? 'да' : v === false ? 'нет' : '?';
}

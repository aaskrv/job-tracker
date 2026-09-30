// Auto-submit filter forms on change
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  form.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', () => form.submit()));
});

// Confirm destructive actions
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
});

// JSON upload on the import page
const uploadForm = document.getElementById('upload-form');
if (uploadForm) {
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('upload-result');
    const files = [...document.getElementById('upload-file').files];
    if (!files.length) return;
    out.hidden = false;
    out.textContent = '';
    for (const file of files) {
      try {
        const body = JSON.parse(await file.text());
        const res = await fetch('/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-File-Name': encodeURIComponent(file.name) },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        out.textContent += data.ok
          ? `${file.name}: найдено ${data.stats.found}, новых ${data.stats.inserted}, обновлено ${data.stats.updated}, дублей ${data.stats.duplicates}, ошибок ${data.stats.errors}\n`
            + data.stats.errorMessages.map((m) => '  ' + m + '\n').join('')
          : `${file.name}: ошибка: ${data.error}\n`;
      } catch (err) {
        out.textContent += `${file.name}: не удалось прочитать JSON (${err.message})\n`;
      }
    }
    out.textContent += '\nОбновите страницу, чтобы увидеть историю.';
  });
}

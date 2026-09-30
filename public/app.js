// Auto-submit filter forms on change
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  form.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', () => form.submit()));
});

// Confirm destructive actions
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
});

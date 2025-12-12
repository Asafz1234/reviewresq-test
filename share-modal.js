const initShareModal = () => {
  const modal = document.querySelector('#share-modal');
  const openButtons = document.querySelectorAll('[data-share-open]') || [];
  const closeButtons = document.querySelectorAll('[data-share-close]') || [];

  if (!modal) return;
  if (!openButtons.length && !closeButtons.length) return;

  openButtons.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!modal) return;
      modal.classList.add('is-open');
    });
  });

  closeButtons.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!modal) return;
      modal.classList.remove('is-open');
    });
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShareModal);
} else {
  initShareModal();
}


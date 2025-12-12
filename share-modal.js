const initShareModal = () => {
  const modal = document.querySelector('#share-modal');
  const openButtons = document.querySelectorAll('[data-share-open]');
  const closeButtons = document.querySelectorAll('[data-share-close]');

  // If the modal or buttons do not exist on this page, do nothing.
  if (!modal) return;
  if (!openButtons?.length && !closeButtons?.length) return;

  openButtons.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      modal.classList.add('is-open');
    });
  });

  closeButtons.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      modal.classList.remove('is-open');
    });
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShareModal);
} else {
  initShareModal();
}


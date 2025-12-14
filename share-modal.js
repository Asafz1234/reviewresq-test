const initShareModal = () => {
  if (typeof document === 'undefined') return;

  const modal = document.querySelector('#share-modal');
  if (!modal) return;

  const openButtons = Array.from(document.querySelectorAll('[data-share-open]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-share-close]'));

  if (!openButtons.length && !closeButtons.length) return;

  const handleOpen = () => {
    modal.classList.add('is-open');
  };

  const handleClose = () => {
    modal.classList.remove('is-open');
  };

  openButtons.forEach((btn) => {
    if (!(btn instanceof Element)) return;
    btn.addEventListener('click', handleOpen);
  });

  closeButtons.forEach((btn) => {
    if (!(btn instanceof Element)) return;
    btn.addEventListener('click', handleClose);
  });
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShareModal);
  } else {
    initShareModal();
  }
}


const initShareModal = () => {
  const modal = document.querySelector('#share-modal');
  const openButtons = Array.from(document.querySelectorAll('[data-share-open]'));
  const closeButtons = Array.from(document.querySelectorAll('[data-share-close]'));

  if (!modal || (!openButtons.length && !closeButtons.length)) return;

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShareModal);
} else {
  initShareModal();
}


(function () {
  const openModals = new Set();

  function lockBodyScroll(lock) {
    document.body.classList.toggle('modal-open', lock);
  }

  function register(modalEl) {
    if (!modalEl) return null;
    const closeButtons = modalEl.querySelectorAll('[data-modal-close]');
    const controller = {
      open() {
        modalEl.classList.add('open');
        modalEl.setAttribute('aria-hidden', 'false');
        openModals.add(modalEl);
        lockBodyScroll(true);
      },
      close() {
        modalEl.classList.remove('open');
        modalEl.setAttribute('aria-hidden', 'true');
        openModals.delete(modalEl);
        if (openModals.size === 0) {
          lockBodyScroll(false);
        }
      },
      isOpen() {
        return modalEl.classList.contains('open');
      },
    };

    modalEl.addEventListener('click', (event) => {
      if (event.target === modalEl) {
        controller.close();
      }
    });

    closeButtons.forEach((btn) => btn.addEventListener('click', controller.close));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && controller.isOpen()) {
        controller.close();
      }
    });

    return controller;
  }

  window.ModalManager = { register };
})();

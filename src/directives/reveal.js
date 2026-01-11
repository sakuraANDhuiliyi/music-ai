const DEFAULT_OBSERVER_OPTIONS = {
  root: null,
  rootMargin: '0px 0px -10% 0px',
  threshold: 0.12,
};

export default {
  mounted(el, binding) {
    const value = binding?.value && typeof binding.value === 'object' ? binding.value : {};
    const { repeat = false, ...observerOptions } = value;

    el.classList.add('reveal');

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          el.classList.add('is-visible');
          if (!repeat) observer.unobserve(el);
        } else if (repeat) {
          el.classList.remove('is-visible');
        }
      }
    }, { ...DEFAULT_OBSERVER_OPTIONS, ...observerOptions });

    observer.observe(el);
    el.__revealObserver = observer;
  },
  unmounted(el) {
    el.__revealObserver?.disconnect();
    delete el.__revealObserver;
  },
};


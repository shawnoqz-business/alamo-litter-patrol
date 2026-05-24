/* ══════════════════════════════
   ALAMO LITTER PATROL — V2 SHARED SCRIPT
══════════════════════════════ */

// ── Nav scroll border ──
const siteNav = document.getElementById('site-nav');
if (siteNav) {
  const onScroll = () => siteNav.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ── Hamburger menu ──
const hamburger = document.querySelector('.hamburger');
const navLinks  = document.getElementById('nav-links');

if (hamburger && navLinks) {
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hamburger.classList.toggle('open');
    navLinks.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open);
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', e => {
    if (siteNav && !siteNav.contains(e.target)) {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
}

// ── Active nav highlight ──
// Highlight the current page in the nav
(function highlightActiveNav() {
  const path = window.location.pathname.replace(/\/$/, '');
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href').replace(/\/$/, '');
    if (href === path || (path === '' && href === '/') || (path === '/index.html' && href === '/')) {
      link.classList.add('active');
    }
  });
})();

// ── FAQ accordion ──
document.querySelectorAll('.faq-question').forEach(question => {
  question.addEventListener('click', () => {
    const answer     = question.nextElementSibling;
    const isExpanded = question.getAttribute('aria-expanded') === 'true';

    // Collapse all
    document.querySelectorAll('.faq-question').forEach(q => {
      q.setAttribute('aria-expanded', 'false');
      q.nextElementSibling.classList.remove('open');
    });

    // Toggle clicked item
    if (!isExpanded) {
      question.setAttribute('aria-expanded', 'true');
      answer.classList.add('open');
    }
  });
});

// ── Pricing tab toggle ──
document.querySelectorAll('.ptab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;

    document.querySelectorAll('.ptab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab);
    });

    document.querySelectorAll('.ptab-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `panel-${target}`);
    });
  });
});

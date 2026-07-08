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

// ── Promo popup (rotating announcements / discounts / exclusivity offers) ──
(function promoPopup() {
  const STORAGE_KEY = 'alp_promo_popup';
  const DISMISS_DAYS = 7;
  const TRIGGER_PERCENT = 47; // slides in between 45–50% scroll depth

  // Edit these to swap in the next promo. PROMO_EXPIRES hides the popup automatically once it passes.
  const PROMO_BADGE = '<svg class="promo-popup-paw" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="16" rx="6" ry="5"/><circle cx="4" cy="8" r="2.5"/><circle cx="9" cy="3" r="2.3"/><circle cx="15" cy="3" r="2.3"/><circle cx="20" cy="8" r="2.5"/></svg> Limited Time';
  const PROMO_HEADLINE = 'Founding members lock in $0 setup fee.';
  const PROMO_COPY = "Book your first cleaning before August 31, 2026 and the setup fee's gone for good.";
  const PROMO_CTA_TEXT = 'Book Now';
  const PROMO_CTA_LINK = '/book.html';
  const PROMO_EXPIRES = new Date('2026-09-01T00:00:00-05:00');

  if (Date.now() >= PROMO_EXPIRES.getTime()) return;

  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    stored = null;
  }

  if (stored) {
    if (stored.status === 'converted') return;
    if (stored.status === 'dismissed') {
      const elapsedDays = (Date.now() - stored.ts) / (1000 * 60 * 60 * 24);
      if (elapsedDays < DISMISS_DAYS) return;
    }
  }

  function remember(status) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ status, ts: Date.now() }));
    } catch (e) { /* localStorage unavailable — nothing to persist */ }
  }

  const widget = document.createElement('div');
  widget.className = 'promo-popup';
  widget.setAttribute('role', 'dialog');
  widget.setAttribute('aria-label', 'Promotional offer');
  widget.innerHTML = `
    <button type="button" class="promo-popup-close" aria-label="Close">&times;</button>
    <div class="promo-popup-content">
      <span class="promo-popup-badge">${PROMO_BADGE}</span>
      <h3 class="promo-popup-headline">${PROMO_HEADLINE}</h3>
      <p class="promo-popup-copy">${PROMO_COPY}</p>
      <a href="${PROMO_CTA_LINK}" class="btn btn-orange promo-popup-cta">${PROMO_CTA_TEXT}</a>
      <button type="button" class="promo-popup-dismiss-link">No thanks</button>
    </div>
  `;
  document.body.appendChild(widget);

  function positionForMobileCta() {
    const bar = document.querySelector('.mobile-cta-bar');
    const offset = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
    widget.style.setProperty('--mobile-cta-offset', `${offset}px`);
  }
  positionForMobileCta();
  window.addEventListener('resize', positionForMobileCta, { passive: true });

  function dismiss() {
    widget.classList.remove('is-visible');
    remember('dismissed');
  }

  widget.querySelector('.promo-popup-close').addEventListener('click', dismiss);
  widget.querySelector('.promo-popup-dismiss-link').addEventListener('click', dismiss);
  widget.querySelector('.promo-popup-cta').addEventListener('click', () => remember('converted'));

  let triggered = false;
  function onScroll() {
    if (triggered) return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return;
    const percent = (window.scrollY / maxScroll) * 100;
    if (percent >= TRIGGER_PERCENT) {
      triggered = true;
      positionForMobileCta();
      widget.classList.add('is-visible');
      window.removeEventListener('scroll', onScroll);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// ── Out-of-area waitlist form (service-area page) ──
(function waitlistForm() {
  const form = document.querySelector('.waitlist-form');
  if (!form) return;

  const errorMsg = form.querySelector('.waitlist-error');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorMsg.hidden = true;

    const data = new FormData(form);
    if (data.get('bot-field')) return; // honeypot tripped — silently drop

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Submit failed');
        form.outerHTML =
          '<p class="waitlist-thanks"><strong>You\'re on the list!</strong> We\'ll reach out the second we\'re cleaning boxes in your neighborhood. Hang tight — your cats are counting on you.</p>';
      })
      .catch(() => {
        errorMsg.hidden = false;
      });
  });
})();

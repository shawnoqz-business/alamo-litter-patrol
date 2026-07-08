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

// ── Email capture slide-in ──
(function emailCapture() {
  const STORAGE_KEY = 'alp_email_capture';
  const DISMISS_DAYS = 7;
  const TRIGGER_PERCENT = 47; // slides in between 45–50% scroll depth

  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    stored = null;
  }

  if (stored) {
    if (stored.status === 'subscribed') return;
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
  widget.className = 'email-capture';
  widget.setAttribute('role', 'dialog');
  widget.setAttribute('aria-label', 'Email signup offer');
  widget.innerHTML = `
    <button type="button" class="email-capture-close" aria-label="Close">&times;</button>
    <div class="email-capture-content">
      <h3 class="email-capture-headline">No setup fee for early sign-ups.</h3>
      <p class="email-capture-copy">Leave your email and we'll waive your setup fee when you're ready to book. No spam, just updates as we roll out in your neighborhood.</p>
      <form class="email-capture-form" name="email-signup" method="POST" data-netlify="true" netlify-honeypot="bot-field">
        <input type="hidden" name="form-name" value="email-signup" />
        <div class="email-capture-honeypot">
          <label>Don't fill this out: <input name="bot-field" tabindex="-1" autocomplete="off" /></label>
        </div>
        <input type="email" name="email" class="email-capture-input" placeholder="you@email.com" aria-label="Email address" required />
        <button type="submit" class="btn btn-orange email-capture-submit">Waive My Setup Fee</button>
        <p class="email-capture-error" hidden>Something went wrong &mdash; please try again.</p>
      </form>
      <button type="button" class="email-capture-dismiss-link">No thanks</button>
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

  widget.querySelector('.email-capture-close').addEventListener('click', dismiss);
  widget.querySelector('.email-capture-dismiss-link').addEventListener('click', dismiss);

  const form = widget.querySelector('.email-capture-form');
  const errorMsg = widget.querySelector('.email-capture-error');

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
        widget.querySelector('.email-capture-content').innerHTML =
          '<p class="email-capture-thanks"><strong>You\'re on the list!</strong> We\'ll email you the moment we\'re booking in your area.</p>';
        remember('subscribed');
      })
      .catch(() => {
        errorMsg.hidden = false;
      });
  });

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

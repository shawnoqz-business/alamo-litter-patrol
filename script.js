/* Alamo Litter Patrol — script.js */

// ── Nav scroll border ──
const siteNav = document.getElementById('site-nav');
const onScroll = () => siteNav.classList.toggle('scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ── Hamburger menu ──
const hamburger = document.querySelector('.hamburger');
const navLinks  = document.getElementById('nav-links');

hamburger.addEventListener('click', () => {
  const open = hamburger.classList.toggle('open');
  navLinks.classList.toggle('open', open);
  hamburger.setAttribute('aria-expanded', open);
});

// Close on any nav link click
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  });
});

// Close on outside click
document.addEventListener('click', e => {
  if (!siteNav.contains(e.target)) {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }
});

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

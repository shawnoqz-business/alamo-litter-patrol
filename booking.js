// Booking form on book.html.
//
// Flow: pick service -> enter ZIP (in-area check) -> pick a live open window
// (check-availability) -> contact details -> save a card with Stripe's Payment
// Element (SetupIntent, no charge) -> create-booking writes Airtable + Slack.
//
// Prices, zips, and the Stripe publishable key come from booking-config so the
// server stays the single source of truth.

(function bookingForm() {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const FN = '/.netlify/functions';
  const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
  const PLURAL_DAYS = { Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays' };

  const el = {
    count: document.getElementById('count'),
    porchOption: document.getElementById('porch-option'),
    accessHint: document.getElementById('access-hint'),
    quotePrice: document.getElementById('quote-price'),
    quotePer: document.getElementById('quote-per'),
    quoteSetup: document.getElementById('quote-setup'),
    quoteNote: document.getElementById('quote-note'),
    quote: document.getElementById('quote'),
    customQuote: document.getElementById('custom-quote'),
    zip: document.getElementById('zip'),
    zipStatus: document.getElementById('zip-status'),
    inAreaSteps: document.getElementById('in-area-steps'),
    waitlist: document.getElementById('waitlist'),
    waitlistZip: document.getElementById('waitlist-zip'),
    waitlistZipInput: document.getElementById('waitlist-zip-input'),
    dayTabs: document.getElementById('day-tabs'),
    timeGrid: document.getElementById('time-grid'),
    slotStatus: document.getElementById('slot-status'),
    serviceDay: document.getElementById('serviceDay'),
    slotStart: document.getElementById('slotStart'),
    accessNotesField: document.getElementById('access-notes-field'),
    paymentElement: document.getElementById('payment-element'),
    submitBtn: document.getElementById('submit-btn'),
    formError: document.getElementById('form-error'),
    done: document.getElementById('booking-done'),
    doneHeading: document.getElementById('done-heading'),
    doneSummary: document.getElementById('done-summary'),
    whatNext: document.getElementById('what-happens-next'),
  };

  const state = {
    config: null,
    inArea: false,
    availability: null, // { days: { Mon: { open: [...] } }, visitMinutes }
    availabilityKey: '',
    selectedDay: '',
    selectedStart: '',
    stripe: null,
    elements: null,
    paymentMounted: false,
    saved: null, // { customerId, setupIntentId } once a card is saved
    submitting: false,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function field(name) {
    return form.elements[name];
  }
  function radioValue(name) {
    const checked = form.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : '';
  }
  function money(n) {
    return `$${Number(n).toLocaleString('en-US')}`;
  }
  function parseTime(label) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
    if (!m) return null;
    let h = Number(m[1]);
    const pm = m[3].toUpperCase() === 'PM';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return h * 60 + Number(m[2]);
  }
  function formatTime(minutes) {
    const h24 = Math.floor(minutes / 60);
    const min = minutes % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(min).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
  }
  // Same rounding as the server: the window ends on the next 30-minute mark.
  function windowEnd(startLabel) {
    const grid = (state.config && state.config.hours.gridMinutes) || 30;
    const start = parseTime(startLabel);
    const minutes = (state.availability && state.availability.visitMinutes) || grid;
    return formatTime(Math.ceil((start + minutes) / grid) * grid);
  }
  function windowLabel(day, startLabel) {
    return `${DAY_NAMES[day] || day}, ${startLabel} to ${windowEnd(startLabel)}`;
  }
  function showError(message) {
    el.formError.textContent = message;
    el.formError.hidden = !message;
    if (message) el.formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function setSubmitting(on) {
    state.submitting = on;
    el.submitBtn.disabled = on;
    el.submitBtn.textContent = on ? 'Booking...' : 'Book my first visit';
  }
  async function getJSON(url, options) {
    const res = await fetch(url, options);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  // ── Pricing (mirrors lib/booking.js quote()) ──────────────────────────────
  function currentSelection() {
    return {
      serviceType: radioValue('serviceType'),
      count: Number(el.count.value),
      accessType: radioValue('accessType'),
      seniorDiscount: field('seniorDiscount').checked,
      hasSpareBox: field('hasSpareBox').checked,
    };
  }

  function quote(sel) {
    const cfg = state.config;
    const rules = cfg.pricing[sel.serviceType];
    if (!rules) return { error: 'unknown' };
    if (sel.count > cfg.maxBoxes) return { error: 'custom-quote' };
    const porch = sel.accessType === 'Porch';
    if (porch && !rules.porchAllowed) return { error: 'home-only' };
    const base = (porch ? rules.porch : rules.homeEntry)[sel.count - 1];
    const price = sel.seniorDiscount ? Math.round(base * (1 - cfg.seniorDiscountRate)) : base;
    const extras = cfg.setupFee.extraBox * (sel.count - 1);
    const listedSetupFee = rules.hasSetupFee ? cfg.setupFee.firstBox + extras : 0;
    const foundingApplied = cfg.foundingMemberPromoActive && rules.hasSetupFee;
    const firstBoxCovered = rules.hasSetupFee && (sel.hasSpareBox || foundingApplied);
    return {
      per: rules.per,
      price,
      basePrice: base,
      listedSetupFee,
      setupFee: firstBoxCovered ? extras : listedSetupFee,
      firstBoxCovered,
      foundingApplied,
      seniorApplied: sel.seniorDiscount,
    };
  }

  function updateServiceUI() {
    const sel = currentSelection();
    const rules = state.config.pricing[sel.serviceType];

    // Scooping is home entry only.
    const porchInput = el.porchOption.querySelector('input');
    if (!rules.porchAllowed) {
      porchInput.disabled = true;
      el.porchOption.classList.add('is-disabled');
      if (porchInput.checked) form.querySelector('input[name="accessType"][value="Home Entry"]').checked = true;
      el.accessHint.textContent = `${rules.label} is home entry only.`;
    } else {
      porchInput.disabled = false;
      el.porchOption.classList.remove('is-disabled');
      el.accessHint.textContent = 'Porch swap: leave the box outside and knock $15 off every visit.';
    }

    // Access notes only matter when we come inside.
    el.accessNotesField.hidden = radioValue('accessType') !== 'Home Entry';

    const q = quote(currentSelection());
    if (q.error === 'custom-quote') {
      el.quote.hidden = true;
      el.customQuote.hidden = false;
      return;
    }
    el.quote.hidden = false;
    el.customQuote.hidden = true;

    el.quotePrice.textContent = money(q.price);
    el.quotePer.textContent = `/${q.per}`;
    const fee = state.config.setupFee;
    const unit = sel.serviceType === 'Litter-Robot' ? 'unit' : 'box';
    if (q.listedSetupFee === 0) {
      el.quoteSetup.textContent = 'No setup fee.';
    } else if (q.firstBoxCovered) {
      el.quoteSetup.innerHTML = `One-time setup fee: <s>${money(q.listedSetupFee)}</s> ${money(q.setupFee)}`;
    } else if (sel.count > 1) {
      el.quoteSetup.textContent = `One-time setup fee: ${money(q.listedSetupFee)} (${money(fee.firstBox)} first ${unit} + ${money(fee.extraBox)} each additional)`;
    } else {
      el.quoteSetup.textContent = `One-time setup fee: ${money(q.listedSetupFee)}`;
    }
    const notes = [];
    if (q.seniorApplied) notes.push(`Senior discount applied (was ${money(q.basePrice)}).`);
    const extraNote = sel.count > 1 ? ` Additional ${unit}s are ${money(fee.extraBox)} each.` : '';
    if (q.foundingApplied) notes.push(`Founding member offer: first week free, and the ${money(fee.firstBox)} setup fee for your first ${unit} is on us.${extraNote}`);
    else if (q.firstBoxCovered) notes.push(`Your spare box covers the ${money(fee.firstBox)} first-${unit} setup fee.${extraNote}`);
    notes.push(q.per === 'week' ? 'Billed weekly after each visit.' : 'Billed per visit, after the visit.');
    el.quoteNote.textContent = notes.join(' ');
  }

  // ── ZIP / service area ────────────────────────────────────────────────────
  function updateZip() {
    const zip = el.zip.value.replace(/\D/g, '').slice(0, 5);
    if (el.zip.value !== zip) el.zip.value = zip;

    if (zip.length < 5) {
      state.inArea = false;
      el.zipStatus.textContent = "Enter your ZIP and we'll check that you're in our zone.";
      el.zipStatus.classList.remove('is-good', 'is-bad');
      el.inAreaSteps.hidden = true;
      el.waitlist.hidden = true;
      return;
    }

    if (state.config.serviceZips.includes(zip)) {
      state.inArea = true;
      el.zipStatus.textContent = `${zip} is in our zone. Pick your window below.`;
      el.zipStatus.classList.add('is-good');
      el.zipStatus.classList.remove('is-bad');
      el.waitlist.hidden = true;
      el.inAreaSteps.hidden = false;
      loadAvailability();
      mountPayment();
    } else {
      state.inArea = false;
      el.zipStatus.textContent = `We don't cover ${zip} yet.`;
      el.zipStatus.classList.add('is-bad');
      el.zipStatus.classList.remove('is-good');
      el.inAreaSteps.hidden = true;
      el.waitlistZip.textContent = zip;
      el.waitlistZipInput.value = zip;
      el.waitlist.hidden = false;
    }
  }

  // ── Availability / slot picker ────────────────────────────────────────────
  let availabilityTimer = null;
  function scheduleAvailability() {
    clearTimeout(availabilityTimer);
    availabilityTimer = setTimeout(loadAvailability, 200);
  }

  async function loadAvailability() {
    if (!state.inArea) return;
    const sel = currentSelection();
    if (sel.count > state.config.maxBoxes) {
      el.dayTabs.innerHTML = '';
      el.timeGrid.innerHTML = '';
      el.slotStatus.textContent = 'Contact us for a custom quote on four or more boxes.';
      return;
    }
    const key = `${sel.serviceType}|${sel.count}`;
    state.availabilityKey = key;
    el.slotStatus.textContent = 'Checking open windows...';
    try {
      const params = new URLSearchParams({ serviceType: sel.serviceType, count: String(sel.count) });
      const data = await getJSON(`${FN}/check-availability?${params}`, { cache: 'no-store' });
      if (state.availabilityKey !== key) return; // a newer request is in flight
      state.availability = data;
      renderDays();
    } catch (err) {
      el.slotStatus.textContent = 'We could not load open windows. Please refresh and try again.';
      console.error(err);
    }
  }

  function renderDays() {
    const days = state.config.days;
    const avail = state.availability.days;
    el.dayTabs.innerHTML = '';

    // Keep the current day if it still has openings, otherwise first open day.
    const stillOpen = state.selectedDay && avail[state.selectedDay] && avail[state.selectedDay].open.length;
    if (!stillOpen) state.selectedDay = days.find((d) => avail[d] && avail[d].open.length) || '';

    days.forEach((d) => {
      const openCount = avail[d] ? avail[d].open.length : 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-day';
      btn.setAttribute('role', 'tab');
      btn.dataset.day = d;
      btn.innerHTML = `<span class="booking-day-name">${DAY_NAMES[d]}</span><span class="booking-day-count">${openCount ? `${openCount} open` : 'Full'}</span>`;
      btn.disabled = openCount === 0;
      if (d === state.selectedDay) btn.classList.add('is-selected');
      btn.setAttribute('aria-selected', d === state.selectedDay ? 'true' : 'false');
      btn.addEventListener('click', () => {
        state.selectedDay = d;
        state.selectedStart = '';
        renderDays();
      });
      el.dayTabs.appendChild(btn);
    });

    renderTimes();
  }

  function renderTimes() {
    el.timeGrid.innerHTML = '';
    const day = state.selectedDay;
    if (!day) {
      el.slotStatus.textContent = 'No open windows right now. Email hello@alamolitterpatrol.com and we will find you a spot.';
      el.serviceDay.value = '';
      el.slotStart.value = '';
      return;
    }
    const open = state.availability.days[day].open;
    if (!open.includes(state.selectedStart)) state.selectedStart = '';

    open.forEach((start) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-time';
      btn.textContent = start;
      btn.setAttribute('aria-pressed', start === state.selectedStart ? 'true' : 'false');
      if (start === state.selectedStart) btn.classList.add('is-selected');
      btn.addEventListener('click', () => {
        state.selectedStart = start;
        renderTimes();
      });
      el.timeGrid.appendChild(btn);
    });

    el.serviceDay.value = day;
    el.slotStart.value = state.selectedStart;
    el.slotStatus.textContent = state.selectedStart
      ? `Your window: ${PLURAL_DAYS[day]}, ${state.selectedStart} to ${windowEnd(state.selectedStart)}. About ${state.availability.visitMinutes} minutes per visit.`
      : `Pick a start time on ${DAY_NAMES[day]}.`;
  }

  // ── Stripe ────────────────────────────────────────────────────────────────
  function mountPayment() {
    if (state.paymentMounted) return;
    if (!state.config.stripeConfigured || typeof Stripe !== 'function') {
      el.paymentElement.innerHTML = '<p class="booking-error">Card setup is unavailable right now. Please email hello@alamolitterpatrol.com to book.</p>';
      el.submitBtn.disabled = true;
      return;
    }
    state.stripe = Stripe(state.config.stripePublishableKey);
    state.elements = state.stripe.elements({
      mode: 'setup',
      currency: 'usd',
      paymentMethodTypes: ['card'],
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#219EBC',
          colorText: '#023047',
          colorDanger: '#B3261E',
          fontFamily: '"DM Sans", sans-serif',
          borderRadius: '4px',
        },
      },
    });
    // Card only: the SetupIntent is created card-only, so hide Link and the
    // bank option the element would otherwise offer.
    const payment = state.elements.create('payment', {
      layout: 'tabs',
      wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
    });
    payment.mount(el.paymentElement);
    state.paymentMounted = true;
  }

  async function saveCard(contact) {
    if (state.saved) return state.saved;

    const { error: submitError } = await state.elements.submit();
    if (submitError) throw new Error(submitError.message);

    const intent = await getJSON(`${FN}/create-setup-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    });

    const { error } = await state.stripe.confirmSetup({
      elements: state.elements,
      clientSecret: intent.clientSecret,
      confirmParams: {
        return_url: window.location.href,
        payment_method_data: {
          billing_details: { name: contact.name, email: contact.email, phone: contact.phone || undefined },
        },
      },
      redirect: 'if_required',
    });
    if (error) throw new Error(error.message);

    state.saved = { customerId: intent.customerId, setupIntentId: intent.setupIntentId };
    return state.saved;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function validate() {
    const sel = currentSelection();
    if (sel.count > state.config.maxBoxes) return 'For four or more boxes, contact us for a custom quote.';
    if (!state.inArea) return 'Enter a ZIP code inside our service area.';
    if (!field('address').value.trim()) return 'Please enter your street address.';
    if (!el.serviceDay.value || !el.slotStart.value) return 'Pick a day and a time window.';
    if (!field('name').value.trim()) return 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field('email').value.trim())) return 'Please enter a valid email.';
    if (field('phone').value.replace(/\D/g, '').length < 10) return 'Please enter a phone number we can text.';
    if (!state.paymentMounted) return 'Card setup did not load. Please refresh and try again.';
    return '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.submitting) return;
    showError('');
    if (field('bot-field').value) return;

    const problem = validate();
    if (problem) {
      showError(problem);
      return;
    }

    setSubmitting(true);
    const sel = currentSelection();
    const contact = {
      name: field('name').value.trim(),
      email: field('email').value.trim(),
      phone: field('phone').value.trim(),
    };

    try {
      const saved = await saveCard(contact);

      const city = (field('city').value.trim() || 'San Antonio').replace(/,\s*TX$/i, '');
      const payload = {
        serviceType: sel.serviceType,
        count: sel.count,
        accessType: sel.accessType,
        seniorDiscount: sel.seniorDiscount,
        hasSpareBox: sel.hasSpareBox,
        serviceDay: el.serviceDay.value,
        slotStart: el.slotStart.value,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        address: `${field('address').value.trim()}, ${city}, TX ${el.zip.value}`,
        zip: el.zip.value,
        accessNotes: sel.accessType === 'Home Entry' ? field('accessNotes').value.trim() : '',
        notes: field('notes').value.trim(),
        stripeCustomerId: saved.customerId,
        stripeSetupIntentId: saved.setupIntentId,
        botField: field('bot-field').value,
      };

      const result = await getJSON(`${FN}/create-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      showConfirmation(result.booking, contact);
    } catch (err) {
      if (err.status === 409) {
        // Card is saved; only the slot needs re-picking.
        state.selectedStart = '';
        await loadAvailability();
        showError(err.message || 'That window was just taken. Please pick another time.');
        document.getElementById('step-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showError(err.message || 'Something went wrong. Please try again or email hello@alamolitterpatrol.com.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  function showConfirmation(b, contact) {
    const rules = state.config.pricing[b.serviceType];
    const unit = b.serviceType === 'Litter-Robot' ? 'unit' : 'box';
    const items = [
      `<strong>Service:</strong> ${rules.label}, ${b.count} ${unit}${b.count > 1 ? (unit === 'box' ? 'es' : 's') : ''}, ${b.accessType.toLowerCase()}`,
      `<strong>Your window:</strong> ${PLURAL_DAYS[b.serviceDay]}, ${b.slotStart} to ${b.slotEnd}`,
      `<strong>Price:</strong> ${money(b.price)}/${b.per}${b.seniorApplied ? ' with senior discount' : ''}, setup fee ${money(b.setupFee)}${b.firstBoxCovered ? ` (first ${unit} covered${b.foundingApplied ? ' by the founding member offer' : ' by your spare box'})` : ''}`,
      `<strong>Card on file:</strong> saved, nothing charged yet`,
      `<strong>Confirmation to:</strong> ${contact.email}`,
    ];
    el.doneSummary.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
    el.doneHeading.textContent = `See you ${DAY_NAMES[b.serviceDay]}, ${contact.name.split(' ')[0]}!`;
    form.hidden = true;
    el.waitlist.hidden = true;
    if (el.whatNext) el.whatNext.hidden = true;
    el.done.hidden = false;
    el.done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Wire up ───────────────────────────────────────────────────────────────
  async function init() {
    try {
      state.config = await getJSON(`${FN}/booking-config`, { cache: 'no-store' });
    } catch (err) {
      console.error(err);
      form.innerHTML = '<p class="booking-error">The booking form could not load. Please refresh, or email <a href="mailto:hello@alamolitterpatrol.com">hello@alamolitterpatrol.com</a>.</p>';
      return;
    }

    form.querySelectorAll('input[name="serviceType"], input[name="accessType"], input[name="seniorDiscount"], input[name="hasSpareBox"]').forEach((input) => {
      input.addEventListener('change', () => {
        updateServiceUI();
        if (input.name === 'serviceType') scheduleAvailability();
      });
    });
    el.count.addEventListener('change', () => {
      updateServiceUI();
      scheduleAvailability();
    });
    el.zip.addEventListener('input', updateZip);

    updateServiceUI();
    updateZip();
  }

  init();
})();

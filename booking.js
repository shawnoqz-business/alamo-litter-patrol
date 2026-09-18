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
      ownBoxes: Number(field('ownBoxes').value) || 0,
      extraBoxes: Number(field('extraBoxes').value) || 0,
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
    const own = rules.hasSetupFee ? Math.min(Math.max(0, sel.ownBoxes), sel.count) : 0;
    const extra = rules.hasSetupFee ? Math.min(Math.max(0, sel.extraBoxes), cfg.maxExtraBoxes) : 0;
    const supplied = rules.hasSetupFee ? sel.count - own : 0;
    const listedSetupFee = rules.hasSetupFee ? sel.count * cfg.boxPrice : 0;
    const foundingApplied = cfg.foundingMemberPromoActive && supplied > 0;
    return {
      per: rules.per,
      price,
      basePrice: base,
      listedSetupFee,
      setupFee: (supplied + extra - (foundingApplied ? 1 : 0)) * cfg.boxPrice,
      ownBoxes: own,
      suppliedBoxes: supplied,
      extraBoxes: extra,
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

    // Own-box choice: only for services with a setup fee, never more than the box count.
    const ownRow = document.getElementById('own-boxes-row');
    const ownSelect = field('ownBoxes');
    ownRow.hidden = !rules.hasSetupFee || sel.count > state.config.maxBoxes;
    Array.from(ownSelect.options).forEach((opt) => {
      opt.hidden = Number(opt.value) > sel.count;
    });
    if (Number(ownSelect.value) > sel.count) ownSelect.value = String(sel.count);
    document.getElementById('own-boxes-label').textContent = sel.serviceType === 'Litter-Robot'
      ? 'Have your own spare box for us to leave as the loaner? How many?'
      : 'Using your own litter boxes? How many should we use?';

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
    const boxPrice = state.config.boxPrice;
    const unit = sel.serviceType === 'Litter-Robot' ? 'loaner box' : 'box';
    const boxWord = (n) => (n === 1 ? 'box' : 'boxes');
    if (q.listedSetupFee === 0) {
      el.quoteSetup.textContent = 'No setup fee.';
    } else {
      const parts = [];
      if (q.suppliedBoxes > 0) parts.push(`we supply ${q.suppliedBoxes} ${unit === 'box' ? boxWord(q.suppliedBoxes) : `loaner ${boxWord(q.suppliedBoxes)}`}`);
      if (q.ownBoxes > 0) parts.push(`you supply ${q.ownBoxes}`);
      if (q.extraBoxes > 0) parts.push(`${q.extraBoxes} extra to keep`);
      const label = q.setupFee === 0 ? `One-time: <s>${money(q.listedSetupFee)}</s> $0` : `One-time: ${money(q.setupFee)}`;
      el.quoteSetup.innerHTML = `${label} (${parts.join(', ')}; ${money(boxPrice)} per box we supply)`;
    }
    const notes = [];
    if (q.seniorApplied) notes.push(`Senior discount applied (was ${money(q.basePrice)}).`);
    if (q.foundingApplied) notes.push(`Founding member offer: first week free, and one ${money(boxPrice)} box is on us.`);
    notes.push("Billed on the 1st of each month for the previous month's visits.");
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
      // Stripe's own mandate text says "their terms"; we show our own line instead.
      terms: { card: 'never' },
    });
    payment.mount(el.paymentElement);
    state.payment = payment;
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
        ownBoxes: sel.ownBoxes,
        extraBoxes: sel.extraBoxes,
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

      showConfirmation(result.booking, contact, result);
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

  function showConfirmation(b, contact, result) {
    const rules = state.config.pricing[b.serviceType];
    const unit = b.serviceType === 'Litter-Robot' ? 'unit' : 'box';
    const items = [
      `<strong>Service:</strong> ${rules.label}, ${b.count} ${unit}${b.count > 1 ? (unit === 'box' ? 'es' : 's') : ''}, ${b.accessType.toLowerCase()}`,
      `<strong>Your window:</strong> ${PLURAL_DAYS[b.serviceDay]}, ${b.slotStart} to ${b.slotEnd}`,
      `<strong>Price:</strong> ${money(b.price)}/${b.per}${b.seniorApplied ? ' with senior discount' : ''}`,
      `<strong>Boxes:</strong> ${b.listedSetupFee === 0 ? 'no setup fee' : `${money(b.setupFee)} one-time (${[b.suppliedBoxes > 0 ? `we supply ${b.suppliedBoxes}` : '', b.ownBoxes > 0 ? `you supply ${b.ownBoxes}` : '', b.extraBoxes > 0 ? `${b.extraBoxes} extra to keep` : ''].filter(Boolean).join(', ')})`}`,
      `<strong>Card on file:</strong> ${b.card ? `${b.card.brand} ending in ${b.card.last4}` : 'saved'}, nothing charged yet`,
      `<strong>Confirmation:</strong> ${result && result.emailSent ? `emailed to ${contact.email}` : `we'll text ${contact.phone || 'you'} to confirm`}`,
    ];
    el.doneSummary.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
    buildCalendarLinks(b, rules.label);
    // Tear down the card element and clear every field so nothing lingers on the page.
    try {
      if (state.payment) state.payment.unmount();
    } catch (e) {
      /* already gone */
    }
    state.paymentMounted = false;
    form.reset();
    if (typeof fbq === 'function') fbq('track', 'Schedule');
    el.doneHeading.textContent = `See you ${DAY_NAMES[b.serviceDay]}, ${contact.name.split(' ')[0]}!`;
    form.hidden = true;
    el.waitlist.hidden = true;
    if (el.whatNext) el.whatNext.hidden = true;
    el.done.hidden = false;
    el.done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Calendar links (weekly recurring event, local time) ──────────────────
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function calendarStamp(date, minutes) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
  }
  function buildCalendarLinks(b, serviceLabel) {
    const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[b.serviceDay];
    const first = new Date();
    first.setHours(0, 0, 0, 0);
    first.setDate(first.getDate() + 1);
    while (first.getDay() !== dayIndex) first.setDate(first.getDate() + 1);
    const startMin = parseTime(b.slotStart);
    const endMin = parseTime(b.slotEnd);
    const title = `Alamo Litter Patrol: ${serviceLabel}`;
    const details = `Weekly ${serviceLabel.toLowerCase()} visit. Target window ${b.slotStart} to ${b.slotEnd}; exact timing may shift slightly with the day's route. Questions: hello@alamolitterpatrol.com`;
    const byDay = b.serviceDay.slice(0, 2).toUpperCase();
    const start = calendarStamp(first, startMin);
    const end = calendarStamp(first, endMin);

    const google = new URL('https://calendar.google.com/calendar/render');
    google.searchParams.set('action', 'TEMPLATE');
    google.searchParams.set('text', title);
    google.searchParams.set('dates', `${start}/${end}`);
    google.searchParams.set('details', details);
    google.searchParams.set('recur', `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`);
    google.searchParams.set('ctz', 'America/Chicago');
    document.getElementById('cal-google').href = google.toString();

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Alamo Litter Patrol//Booking//EN',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@alamolitterpatrol.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${details.replace(/,/g, '\\,')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const icsLink = document.getElementById('cal-ics');
    if (icsLink.href && icsLink.href.startsWith('blob:')) URL.revokeObjectURL(icsLink.href);
    icsLink.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));

    document.getElementById('cal-first').textContent = first.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
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

    field('ownBoxes').addEventListener('change', updateServiceUI);
    field('extraBoxes').addEventListener('change', updateServiceUI);
    form.querySelectorAll('input[name="serviceType"], input[name="accessType"], input[name="seniorDiscount"]').forEach((input) => {
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

  // If the browser restores this page from its back/forward cache, start over
  // rather than showing whatever was typed before.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
  });

  init();
})();

# Alamo Litter Patrol — V2 Website

**For:** Claude Code deployment to existing repo (`github.com/shawnoqz-business/alamo-litter-patrol`) → Netlify.

---

## What's In This Folder

```
alamo-litter-patrol-v2/
├── index.html                  ← Home (short, drives to other pages)
├── how-it-works.html           ← Detailed 3-step process
├── pricing.html                ← Full pricing with Box Swap / Litter-Robot / Scooping tabs
├── service-area.html           ← ZIPs + neighborhoods
├── about.html                  ← Founder + mission + SDVOSB
├── faq.html                    ← Full Q&A
├── contact.html                ← Contact info + booking link
├── book.html                   ← Native booking form (booking.js + Netlify Functions, Airtable + Stripe)
├── founding-member.html        ← noindex mailer-QR landing page (deliberately not in sitemap)
├── privacy.html                ← Privacy placeholder (replace with Termly later)
├── terms.html                  ← Terms placeholder (replace with Termly later)
├── style.css                   ← Shared stylesheet (every page uses it)
├── script.js                   ← Shared JS (nav, FAQ, pricing tabs, promo popup, form handlers)
├── robots.txt                  ← SEO
├── sitemap.xml                 ← SEO
├── README-FOR-CLAUDE-CODE.md   ← This file
├── netlify/functions/          ← booking functions (booking-config, check-availability, create-setup-intent, create-booking, shared lib/) + slack-notify.js + sheets-relay.js relays
└── assets/                     ← logo, favicons, hero (bug-hero-glow.jpg/.webp), about photo, og-card
```

---

## Instructions For Claude Code

### Step 1 — Replace the existing repo contents
```bash
# In the local clone of github.com/shawnoqz-business/alamo-litter-patrol
# Delete everything except .git and .gitignore
# Then copy in all files from this v2 folder
```

### Step 2 — Move the hero image
The current site uses `images/bug-hero.jpg`. The new site expects `assets/bug-hero.jpg`. Move it:
```bash
mkdir -p assets
mv images/bug-hero.jpg assets/bug-hero.jpg
```
(Or just copy bug-hero.jpg from Shawn's upload into the `assets/` folder.)

### Step 3 — Commit and push
```bash
git add -A
git commit -m "V2: multi-page site with new pricing model"
git push
```
Netlify will auto-deploy. Should be live in ~60 seconds.

### Step 4 — Verify
Visit alamolitterpatrol.com and click through every nav link. Confirm:
- All 10 pages load
- Mobile hamburger menu works
- Pricing page tabs switch between Box Swap / Litter-Robot / Scooping
- FAQ accordion expands/collapses
- "Book Now" buttons go to /book.html, the native booking form (live slot picker, Stripe card on file)
- Mobile sticky CTA bar shows at the bottom of every page on mobile

---

## Critical Settings (Don't Change)

- **Booking system:** `/book.html` + `booking.js` + `netlify/functions/` (booking-config, check-availability, create-setup-intent, create-booking; shared code in `lib/`). Customers live in Airtable (base id + PAT in Netlify env), cards in Stripe. Prices live in `pricing.html` (and the cards on `index.html`, and the FAQ) AND `netlify/functions/lib/booking.js`; change all of them. Confirmation email goes through Resend (`lib/email.js`; env `NETLIFY_BOOKING_CONFIRMS_RESEND_API_KEY`, or `RESEND_API_KEY`; sender defaults to hello@bookings.alamolitterpatrol.com, the domain verified in Resend). Tally is gone.
- **Email:** `hello@alamolitterpatrol.com` — Namecheap forwards this to Shawn's Gmail.
- **Color palette:** `#FFFFFF` (white) / `#023047` (deep space blue) / `#FFB703` (amber flame) / `#219EBC` (blue green). ~70/20/7/3 ratio. All colors route through CSS variables in the `:root` block of `style.css` — `--black` (deep blue), `--orange` / `--orange-hover` (amber; variable names kept for compatibility), and `--blue-green` / `--blue-green-hover`. **Contrast rule:** amber is light — any text on an amber background must be dark (`var(--black)`), never white; amber as text only on dark backgrounds. Use `--blue-green` for secondary touches (links, active nav, hover states).
- **Fonts:** Bebas Neue (display) + DM Sans (body) — loaded from Google Fonts in `style.css`.
- **No build step:** Plain HTML/CSS/JS. No frameworks, no bundler, no Node. Netlify deploys the static files as-is.

---

## What Changed From V1

| Area | V1 | V2 |
|---|---|---|
| Architecture | Single long-scroll page | 10 separate pages |
| Pricing unit | Per cat ($40/$65/$90) | Per box ($55/$80/$105) |
| Default service | Porch (cheaper) | Home entry (baseline), porch = $15 off |
| Service types | Box swap only | Box swap + Litter-Robot + Scooping (3 tabs on pricing) |
| Senior discount | None | 10% off for 65+ |
| Setup fee | $50 always | $50 swap/Robot only, waived if customer has own loaner; no setup fee for scoop |
| Skip language | "Reply STOP" | "Reply SKIP" |
| Mobile CTA | None | Sticky bottom bar with Book + Contact |
| Pages | 1 | 10 |
| SEO | One meta description | Per-page titles, descriptions, canonicals, sitemap, robots.txt |

---

## Known Placeholders To Replace Later

1. **privacy.html and terms.html** — usable, hand-edited (the Cookies & Advertising section discloses the Meta Pixel), but generate proper versions on termly.io (~10 min, free) before formal LLC launch.

---

## Resolved Since The V2 Build

Kept here so these don't get re-opened by a future pass:

- **Hero image** — `bug-hero.jpg` no longer exists. The hero is `assets/bug-hero-glow.jpg`, served via `<picture>` with a WebP first (`bug-hero-glow.webp`). It's the LCP image and keeps `fetchpriority="high"`.
- **ZIP codes** — no longer a guess. Confirmed 2026-08-23 and extended 2026-09-17; the service zone is 9 ZIPs: 78238 Leon Valley, 78240 / 78250 / 78230 NW San Antonio, 78229 Medical Center, 78249 UTSA area, 78231 Shavano Park area, 78023 Helotes, 78253 Alamo Ranch. They live in exactly two places — the `zip-chip` grid on `service-area.html` and the `areaServed` block of the `LocalBusiness` JSON-LD on all 10 indexable pages. Changing the zone means editing both.
- **About page photo** — `assets/about-photo.jpg` is in place; it no longer reuses the hero.
- **Phone number** — (210) 920-0654 is live. **Shawn's call: contact page only.** It appears as a visible `tel:` link on `contact.html` and in the JSON-LD on all 10 indexable pages. Deliberately NOT in the footer, nav, or the mobile CTA bar — don't "finish the job" by adding it there.
- **Schema.org LocalBusiness markup** — shipped. Present on all 10 indexable pages, anchored at `@id: https://alamolitterpatrol.com/#business`. `faq.html` also carries `FAQPage`; `pricing.html` also carries an `OfferCatalog` using price ranges. `founding-member.html` is excluded on purpose (noindex).

---

## Future V3 Items (Not In This Build)

- Customer portal (deferred to self-built software phase)
- Live route tracker (Phase 2)
- Gift cards (bookmarked for later)
- SDVOSB certification logo (once SBA VetCert approved)
- Real operation photos (replacing stock-ish elements)
- Google Business Profile embed on contact page

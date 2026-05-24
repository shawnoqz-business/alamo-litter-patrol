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
├── book.html                   ← Tally form embedded inline
├── privacy.html                ← Privacy placeholder (replace with Termly later)
├── terms.html                  ← Terms placeholder (replace with Termly later)
├── style.css                   ← Shared stylesheet (every page uses it)
├── script.js                   ← Shared JS (nav, FAQ, pricing tabs)
├── robots.txt                  ← SEO
├── sitemap.xml                 ← SEO
├── README-FOR-CLAUDE-CODE.md   ← This file
└── assets/                     ← Drop bug-hero.jpg here (and any future images)
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
- "Book Now" buttons open the Tally form (popup on most pages; inline on /book.html)
- Mobile sticky CTA bar shows at the bottom of every page on mobile

---

## Critical Settings (Don't Change)

- **Tally form ID:** `eq0L8O` — this is wired into 30+ buttons/links. Don't change unless replacing the form entirely.
- **Email:** `hello@alamolitterpatrol.com` — Namecheap forwards this to Shawn's Gmail.
- **Color palette:** `#FFFFFF` (white) / `#111111` (black) / `#FF5F1F` (orange). 70/20/10 ratio.
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

1. **assets/bug-hero.jpg** — must be added before deploy
2. **ZIP codes on service-area.html** — currently a reasonable best guess for Leon Valley / Helotes / NW SA / Medical Center / UTSA. Shawn should verify and trim/add as needed.
3. **privacy.html and terms.html** — usable placeholders, but generate proper versions on termly.io (~10 min, free) before formal LLC launch.
4. **About page photo** — currently reuses bug-hero.jpg. Consider a second photo (Shawn + Bug, or sanitization station).
5. **Phone number** — not currently displayed anywhere. Add once Google Voice or OpenPhone is set up. Add to contact.html and the mobile CTA bar.

---

## Future V3 Items (Not In This Build)

- Customer portal (deferred to self-built software phase)
- Live route tracker (Phase 2)
- Gift cards (bookmarked for later)
- SDVOSB certification logo (once SBA VetCert approved)
- Real operation photos (replacing stock-ish elements)
- Google Business Profile embed on contact page
- Schema.org LocalBusiness markup (after Google Business Profile is claimed)

# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Quickstop Super Deli — a local deli/convenience store located in Bellport, NY (across from Bellport LIRR station). This repo contains:

1. **Website** (`website/`) — The public-facing deli website
2. **Marketing Dashboard** (`website/dashboard/`) — AI-powered marketing tool for the owner
3. **Marketing Agent** (`.claude/agents/` + `marketing/`) — Claude Code agent for marketing content
4. **API Proxy** (`worker/`) — Cloudflare Worker that connects the dashboard to Anthropic's API

## Architecture

### Technology Stack
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build system)
- **Hosting**: Hostinger (static file hosting)
- **API Proxy**: Cloudflare Worker (free tier)
- **AI**: Anthropic Claude API (Sonnet 4.5) via the dashboard
- **Delivery Integration**: DoorDash, GrubHub

### Design System
- **Fonts**: Bebas Neue (headlines), DM Sans (body)
- **Colors**:
  - Deli Red: #D62828
  - Deli Yellow: #F7B32B
  - Deli Cream: #FFF8E7
  - Deli Dark: #1A1A1A
  - Deli Brown: #5C4033
- **Style**: Retro-modern "brutal" design with bold box shadows

### File Structure
```
.claude/
├── agents/
│   └── local-retail-marketing-agent.md   # Marketing agent persona
└── commands/
    ├── local-seo.md                      # /local-seo command
    ├── social-media.md                   # /social-media command
    ├── promotions.md                     # /promotions command
    ├── weekly-plan.md                    # /weekly-plan command
    └── competitor-check.md               # /competitor-check command

website/
├── index.html                # Main landing page
├── menu.html                 # Full menu page
├── dashboard/
│   ├── index.html            # Marketing dashboard (unlisted)
│   ├── style.css             # Dashboard styles
│   └── app.js                # Dashboard logic + AI prompts
├── favicon.svg
├── robots.txt
├── sitemap.xml
└── .htaccess                 # Security headers (Apache)

marketing/
├── CLAUDE.md                 # Marketing agent project instructions
├── config/
│   ├── business-profile.json # Store details, hours, delivery links
│   ├── brand-voice.md        # Tone, language, personality guide
│   └── target-audiences.md   # Customer segments
├── content/
│   ├── social/               # Generated social media posts
│   ├── templates/            # Post templates with examples
│   └── calendar/             # Weekly content calendars
├── seo/
│   ├── keywords.md           # Target search keywords
│   ├── google-business-profile.md  # GBP setup checklist
│   ├── local-citations.md    # Directory listings tracker
│   └── review-strategy.md    # Review acquisition strategy
├── analytics/
│   └── tracking-setup.md     # What to track and how
└── output/                   # Generated deliverables

worker/
├── index.js                  # Cloudflare Worker API proxy
└── wrangler.toml             # Cloudflare Worker config
```

### Business Information
- **Name**: Quickstop Super Deli
- **Address**: 461 Station Rd, Bellport, NY 11713 (across from Bellport LIRR)
- **Hours**: 5:00 AM - 7:00 PM Daily
- **Delivery**: DoorDash, GrubHub
- **Phone**: (631) 286-1491
- **Domain**: quickstopsuperdeli.com
- **Dashboard**: quickstopsuperdeli.com/dashboard (unlisted, not linked from main site)
- **DoorDash**: https://www.doordash.com/convenience/store/quick-stop-super-deli-bellport-36500379/
- **GrubHub**: https://www.grubhub.com/restaurant/quick-stop-super-deli-461-station-rd-bellport/12684712

## Marketing Dashboard

The dashboard is a mobile-friendly web app at `/dashboard` for the deli owner (non-technical user). It has 5 tools that generate marketing content via the Anthropic API:

1. **This Week's Plan** — Day-by-day posting schedule
2. **Social Media Posts** — Ready-to-paste Instagram/Facebook captions
3. **Promotions & Specials** — Deal ideas with sign text
4. **Help People Find Us** — Google listing posts and SEO tips
5. **Reply to a Review** — Paste a review, get a response

### How It Works
- Dashboard (static HTML/JS) sends requests to a Cloudflare Worker
- Worker holds the Anthropic API key securely and proxies to Claude
- Responses stream back to the browser in real-time
- All copy-paste-ready text appears in copyable code blocks

### Updating the Dashboard
1. Edit files in `website/dashboard/`
2. Upload to Hostinger `public_html/dashboard/` via File Manager

### Cloudflare Worker
- **URL**: https://superdeli-marketing-api.sricharangumudavelli.workers.dev
- **Deploy**: `cd worker && wrangler deploy`
- **API Key**: Stored as Cloudflare secret (set with `wrangler secret put ANTHROPIC_API_KEY`)

## Claude Code Agent

The marketing agent can be used directly in Claude Code with slash commands:
- `/weekly-plan` — Generate a weekly marketing plan
- `/social-media` — Generate social media posts
- `/promotions` — Generate promotion ideas
- `/local-seo` — Generate local SEO content
- `/competitor-check` — Research local competitors

The agent reads config from `marketing/config/` and writes output to `marketing/content/` or `marketing/output/`.

## Development

These are static HTML files. To run locally:
```bash
# Any static file server works
cd website
python -m http.server 8000
# or
npx serve website
```

## Deployment

### Website + Dashboard
Upload files to Hostinger `public_html/` via File Manager.

### Cloudflare Worker
```bash
cd worker
wrangler deploy
```

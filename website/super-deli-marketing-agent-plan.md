# Quickstop Super Deli — Marketing Agent Plan

## Business Context

- **Name:** Quickstop Super Deli (Station Rd)
- **Location:** Bellport, Long Island, NY — directly across from the Bellport LIRR station
- **Hours:** 5 AM – 7 PM daily
- **Type:** Classic NYC deli + convenience store
- **Menu:** Classic sandwiches, chicken over rice, breakfast, cold cuts, wraps, burgers, coffee, snacks & groceries
- **Delivery:** DoorDash, GrubHub
- **Website:** quickstopsuperdeli.com (Hostinger)
- **Key Advantage:** LIRR commuter foot traffic, early morning hours, neighborhood staple

---

## Agent Architecture

### Purpose

A Claude Code agent that acts as a dedicated marketing manager for a local deli/convenience store. It should be able to generate content, plan campaigns, manage social media calendars, optimize local SEO, and provide actionable recommendations — all contextualized to a small, family-owned food retail business in a suburban Long Island commuter town.

### File Structure

```
~/local-business-marketing/
├── .claude/
│   ├── agents/
│   │   └── local-retail-marketing-agent.md      ← Main agent persona + instructions
│   ├── commands/
│   │   ├── local-seo.md                         ← /local-seo command
│   │   ├── social-media.md                      ← /social-media command
│   │   ├── promotions.md                        ← /promotions command
│   │   ├── weekly-plan.md                       ← /weekly-plan command
│   │   └── competitor-check.md                  ← /competitor-check command
│   └── CLAUDE.md                                ← Project-level instructions
├── config/
│   ├── business-profile.json                    ← Store details, hours, menu, etc.
│   ├── brand-voice.md                           ← Tone, language, personality guide
│   └── target-audiences.md                      ← Customer segments
├── content/
│   ├── social/
│   │   ├── instagram/                           ← Generated IG posts + captions
│   │   ├── facebook/                            ← Generated FB posts
│   │   └── google-posts/                        ← Google Business Profile posts
│   ├── templates/
│   │   ├── daily-special.md
│   │   ├── seasonal-promo.md
│   │   ├── community-event.md
│   │   └── review-response.md
│   └── calendar/
│       └── content-calendar.md                  ← Weekly/monthly content schedule
├── seo/
│   ├── keywords.md                              ← Target keywords + tracking
│   ├── google-business-profile.md               ← GBP optimization checklist
│   ├── local-citations.md                       ← Directory listings tracker
│   └── review-strategy.md                       ← How to get/respond to reviews
├── analytics/
│   └── tracking-setup.md                        ← What to track and how
└── output/                                      ← Generated deliverables land here
```

---

## Agent Definition: `local-retail-marketing-agent.md`

### Persona

The agent should be instructed to act as a **local food retail marketing specialist** with deep knowledge of:

- Small-town / suburban Long Island community dynamics
- LIRR commuter behavior and schedules
- Food photography and social media best practices for delis
- Google Business Profile optimization for local food businesses
- Seasonal and weather-driven promotions (snow days, summer, holidays)
- DoorDash/GrubHub listing optimization
- Review management and reputation building

### Core Capabilities the Agent Should Have

1. **Content Generation** — Write social media posts, Google Business posts, and promotional copy in the deli's voice
2. **Campaign Planning** — Create weekly/monthly marketing calendars tied to seasons, holidays, local events, and commuter patterns
3. **Local SEO Management** — Generate keyword-optimized content, manage citation lists, write review responses
4. **Promotion Design** — Create specials, loyalty ideas, and community engagement campaigns
5. **Competitor Analysis** — Research other delis and convenience stores in the Bellport/Patchogue/Medford area
6. **Performance Recommendations** — Suggest what to track and how to interpret basic analytics

---

## Config Files

### `business-profile.json`

Populate with:

```json
{
  "name": "Quickstop Super Deli",
  "tagline": "Station Rd",
  "address": "461 Station Rd, Bellport, NY 11713",
  "phone": "(631) 286-1491",
  "website": "https://quickstopsuperdeli.com",
  "hours": {
    "open": "5:00 AM",
    "close": "7:00 PM",
    "days": "Monday - Sunday"
  },
  "delivery_platforms": ["GrubHub", "DoorDash"],
  "menu_categories": [
    "Breakfast Sandwiches",
    "Cold Cut Heroes",
    "Hot Sandwiches",
    "Chicken Over Rice",
    "Burgers & Wraps",
    "Salads",
    "Coffee & Drinks",
    "Snacks & Groceries"
  ],
  "key_differentiators": [
    "Right across from Bellport LIRR station",
    "Open at 5 AM for early commuters",
    "Classic NYC deli experience on Long Island",
    "Convenience store essentials",
    "DoorDash and GrubHub delivery"
  ],
  "competitors_area": ["Bellport", "Patchogue", "Medford", "East Patchogue"],
  "social_accounts": {
    "instagram": "",
    "facebook": "",
    "google_business": ""
  }
}
```

### `brand-voice.md`

Define the deli's personality:

- **Tone:** Friendly, no-nonsense, neighborhood feel. Not corporate. Think a guy behind the counter who knows your regular order.
- **Language:** Casual, warm, occasionally funny. Can use Long Island / NYC slang naturally ("hero" not "sub", "on line" not "in line", "BEC" for bacon egg & cheese).
- **Visual Style:** Bold, warm colors (reds, yellows, cream). Real food photos over stock images. Deli paper textures. Classic signage aesthetic.
- **Avoid:** Corporate marketing speak, overly polished/influencer tone, generic food captions.

### `target-audiences.md`

Define three primary customer segments:

| Segment | Description | When They Come | What They Want |
|---|---|---|---|
| **LIRR Commuters** | Daily train riders heading to/from NYC | 5-7 AM, 5-7 PM | Quick coffee, BEC, grab-and-go. Speed matters. |
| **Neighborhood Regulars** | Bellport/local residents | Lunch hours, weekends | Comfort food, familiarity, convenience store runs |
| **Delivery Customers** | Surrounding area via DoorDash/GrubHub | Lunch and dinner | Menu variety, good portions, solid ratings |

---

## Slash Commands

### `/local-seo`

**Purpose:** Generate or audit local SEO content.

**What it should do:**
- Generate Google Business Profile posts (weekly)
- Audit and suggest keyword improvements for quickstopsuperdeli.com
- Draft responses to Google reviews (positive and negative templates)
- Check/suggest local directory listings (Yelp, YellowPages, Foursquare, Apple Maps, etc.)
- Generate schema markup suggestions for the website

**Key target keywords to bake in:**
- "deli near Bellport LIRR"
- "breakfast sandwiches Bellport NY"
- "convenience store Bellport"
- "chicken over rice Long Island"
- "deli delivery Bellport"
- "best deli Patchogue area"
- "early morning coffee Bellport"

### `/social-media`

**Purpose:** Generate social media content.

**What it should do:**
- Generate a week's worth of Instagram/Facebook posts with captions and hashtag sets
- Suggest photo/video shot ideas (real food, behind the counter, commuter rush)
- Create story ideas and reels concepts
- Provide posting schedule recommendations

**Content pillars (rotating themes):**
1. **The Food** — Hero shots of sandwiches, chicken over rice plating, fresh coffee pour
2. **The Commuter Life** — "5 AM and we're already rolling" vibes, LIRR references, morning rush energy
3. **Convenience Corner** — Highlighting store items, snacks, essentials ("forgot milk? We got you")
4. **Community** — Bellport shoutouts, local events, weather-related posts ("snow day? We're still open")
5. **Behind the Counter** — Making food, stocking shelves, real deli life

**Hashtag bank to include:**
`#BellportNY #LongIslandEats #NYCDeli #LIRRCommute #BellportDeli #SuperDeli #LongIslandFood #SuffolkCountyEats #DeliLife #ChickenOverRice #BECSandwich #LongIslandDeli`

### `/promotions`

**Purpose:** Generate promotion and campaign ideas.

**What it should do:**
- Create seasonal specials (summer cold drinks, winter soups, holiday platters)
- Design loyalty/reward concepts (punch cards, "commuter club")
- Plan community engagement campaigns
- Generate DoorDash/GrubHub promotional strategies (first-order discounts, bundles)
- Weather-driven specials (hot cocoa on cold days, iced coffee when it's 90°)

**Promotion calendar framework:**

| Month | Theme | Example Promotion |
|---|---|---|
| Jan | New Year, Cold Weather | "Warm Up Wednesday" — Free hot coffee with any breakfast sandwich |
| Feb | Valentine's, Super Bowl | Super Bowl catering platters, "Share a Hero" BOGO |
| Mar | Spring, St. Patrick's | Spring menu refresh, green-themed special |
| Apr | Baseball season, Easter | Opening Day combo deal |
| May | Memorial Day, warm weather | Iced coffee launch, BBQ-adjacent items |
| Jun-Aug | Summer | Cold sandwich combos, summer drink specials, beach crowd |
| Sep | Back to school, Labor Day | Commuter loyalty card launch |
| Oct | Halloween, fall | Pumpkin spice coffee, fall comfort food |
| Nov | Thanksgiving | Catering platters, Thanksgiving sandwich |
| Dec | Holidays, cold weather | Holiday catering, gift card push, hot soup season |

### `/weekly-plan`

**Purpose:** Generate a complete weekly marketing action plan.

**What it should output:**
- 5-7 social media posts with captions (ready to copy-paste)
- 1 Google Business Profile post
- 1 promotional idea for the week
- Any relevant local/seasonal hooks
- Suggested photos to take that week

### `/competitor-check`

**Purpose:** Research and compare against local competitors.

**What it should do:**
- Search for delis and convenience stores in the Bellport/Patchogue corridor
- Compare Google ratings, review counts, menu offerings
- Identify gaps and opportunities
- Suggest competitive advantages to emphasize

---

## Review Strategy (`seo/review-strategy.md`)

This is critical for a local deli. The agent should be able to:

1. **Generate review request strategies:**
   - Counter signs / QR codes linking to Google review page
   - Receipt-based "Leave us a review" messaging
   - Timing: ask regulars personally, not every customer every time

2. **Draft review responses:**
   - Positive reviews: Short, personal, mention something specific
   - Negative reviews: Acknowledge, don't argue, offer to make it right, take it offline
   - Template bank for common scenarios (slow service, wrong order, great food compliment)

3. **Track review velocity:**
   - Goal: 2-3 new Google reviews per week
   - Monitor Yelp, GrubHub, and DoorDash ratings separately

---

## Delivery Platform Optimization

The agent should have knowledge of how to optimize DoorDash and GrubHub listings:

- **Photos:** Every menu item should have a photo. Good lighting, real food, not stock.
- **Menu organization:** Clear categories, best sellers at the top
- **Descriptions:** Short, appetizing, include size/portion info
- **Pricing strategy:** Account for platform fees (typically 15-30%) in pricing
- **Promotions:** Use platform-native promotions (free delivery, % off first order) during slow periods
- **Response time:** Keep acceptance rate high, prep time accurate
- **Ratings:** Respond to all reviews on both platforms

---

## Analytics & Tracking Setup

The agent should recommend tracking these from day one:

| Metric | Tool | Frequency |
|---|---|---|
| Google Business Profile views/clicks | GBP Dashboard | Weekly |
| Website traffic | Google Analytics (set up on quickstopsuperdeli.com) | Weekly |
| Google search queries driving traffic | Google Search Console | Weekly |
| Instagram followers + engagement rate | Instagram Insights | Weekly |
| Facebook page reach | Facebook Insights | Weekly |
| GrubHub orders + rating | GrubHub Merchant Portal | Daily |
| DoorDash orders + rating | DoorDash Merchant Portal | Daily |
| Google review count + average rating | GBP Dashboard | Weekly |
| Yelp rating | Yelp Business | Monthly |

---

## CLAUDE.md (Project-Level Instructions)

```markdown
# Super Deli Marketing Agent

You are a local food retail marketing specialist managing the marketing
for Quickstop Super Deli, a classic NYC-style deli and convenience store
in Bellport, Long Island, NY.

## Key Context
- The deli is directly across from the Bellport LIRR station
- Primary customers: LIRR commuters, neighborhood regulars, delivery customers
- Open 5 AM - 7 PM daily
- Delivers via DoorDash and GrubHub
- Website: quickstopsuperdeli.com

## How to Work
- Always read config/business-profile.json and config/brand-voice.md before
  generating any content
- All generated content goes in the content/ or output/ directories
- Use the brand voice: casual, warm, neighborhood NYC deli energy
- Prioritize actionable, copy-paste-ready outputs
- Think local-first: Bellport, Suffolk County, Long Island context
- Reference commuter patterns, weather, local events, and seasons

## What You Don't Do
- No generic "content marketing" advice — everything must be specific
  and ready to execute
- No corporate tone
- No strategies requiring a dedicated marketing team — this is a
  family-run business
```

---

## Implementation Priority (What to Do First)

### Phase 1 — Foundation (This Week)
1. Set up the file structure above
2. Populate `business-profile.json` with real details (phone number, social handles)
3. Write `brand-voice.md` (refine the draft above)
4. Claim/optimize Google Business Profile if not done already
5. Set up Instagram and Facebook business pages if they don't exist

### Phase 2 — Content Engine (Week 2)
1. Test the `/weekly-plan` command — generate your first week of content
2. Start posting consistently (aim for 4-5x/week on Instagram)
3. Set up Google Business Profile posts (1-2x/week)
4. Take 20-30 food photos to build a content library

### Phase 3 — SEO & Reviews (Week 3)
1. Run `/local-seo` audit on quickstopsuperdeli.com
2. Submit to local directories (Yelp, Apple Maps, Foursquare, etc.)
3. Print QR code review cards for the counter
4. Start responding to all existing reviews

### Phase 4 — Optimize & Scale (Week 4+)
1. Optimize DoorDash and GrubHub listings (photos, descriptions, promotions)
2. Launch first promotion campaign
3. Run `/competitor-check` and adjust strategy
4. Review analytics and refine what's working

---

## Notes

- **Photography is everything** for a deli. Before any marketing push, invest a weekend in taking good food photos with natural lighting. Even an iPhone is fine — just use a clean surface, good light, and shoot from above or at 45°.
- **Commuter angle is your superpower.** No other deli in Bellport has that LIRR proximity. Lean into it hard — morning coffee + BEC combos, "grab it before the 6:12 train" energy, loyalty cards for regulars.
- **Google reviews are the #1 growth lever** for a local food business. A deli with 4.5+ stars and 100+ reviews will dominate local search. Make this the top priority.
- **Consistency > perfection.** Posting a decent photo with a good caption 5x a week beats a perfect post once a month.

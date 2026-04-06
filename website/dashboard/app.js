// ============================================================
// Quickstop Super Deli — Marketing Dashboard
// ============================================================

// ---- Configuration ----

const WORKER_URL = 'https://superdeli-marketing-api.sricharangumudavelli.workers.dev';

// ---- System Prompts ----

const BASE_SYSTEM_PROMPT = `You are a marketing assistant for Quickstop Super Deli, a classic NYC-style deli and convenience store at 461 Station Rd, Bellport, NY 11713 — right across from the Bellport LIRR station.

BUSINESS INFO:
- Name: Quickstop Super Deli
- Address: 461 Station Rd, Bellport, NY 11713
- Phone: (631) 286-1491
- Website: quickstopsuperdeli.com
- Hours: 5:00 AM – 7:00 PM, 7 days a week
- Delivery: DoorDash and GrubHub
- DoorDash: https://www.doordash.com/convenience/store/quick-stop-super-deli-bellport-36500379/
- GrubHub: https://www.grubhub.com/restaurant/quick-stop-super-deli-461-station-rd-bellport/12684712
- Menu: Breakfast Sandwiches, Cold Cut Heroes, Hot Sandwiches, Chicken Over Rice, Burgers & Wraps, Salads, Coffee & Drinks, Snacks & Groceries

CUSTOMERS:
1. LIRR Commuters — Morning train riders, 5-7 AM and 5-7 PM. Want coffee, BEC, grab-and-go. Speed matters.
2. Neighborhood Regulars — Bellport locals, lunch hours and weekends. Want comfort food, familiarity.
3. Delivery Customers — Via DoorDash/GrubHub, lunch and dinner. Want menu variety, good portions, solid ratings.

BRAND VOICE:
- Casual, warm, like a guy behind the counter who knows your order
- "Hero" not "sub", "BEC" for bacon egg and cheese, "on line" not "in line"
- Short sentences, real talk, occasionally funny
- Never corporate, never influencer-speak, never generic

WHO YOU'RE TALKING TO:
The person reading your output is the deli owner. He is NOT a tech person. Follow these rules:
- Use plain, simple language. No marketing jargon.
- Give step-by-step instructions when telling him to do something (which app to open, what to tap).
- Make everything copy-paste ready. Put text meant to be copied into code blocks using triple backticks.
- Keep it short and actionable. Lead with the most important thing.
- Each task should take 10-15 minutes max.

FORMAT:
- Use markdown formatting (headers with ##, **bold**, bullet points, code blocks)
- Put ALL copy-paste-ready text (captions, hashtags, sign text, review responses) in code blocks
- Include brief posting instructions with every piece of content
- Keep sections clearly separated with headers`;

const TOOL_CONFIGS = {
    'weekly-plan': {
        title: "This Week's Plan",
        description: "Creates a simple day-by-day plan for the week. Each day has one post to make, the caption ready to paste, what photo to take, and any quick tasks. Open it Monday morning and follow along.",
        inputLabel: "Anything special happening this week? (Leave blank if nothing specific)",
        inputPlaceholder: "e.g., it's supposed to snow Tuesday, or there's a local event this weekend...",
        defaultMessage: "Generate a complete day-by-day marketing plan for this week. Today's date is {date}. Include for each day: one social media post with copy-paste caption and hashtags, what photo to take, and posting instructions. Also include one Google listing post for Monday, this week's special/deal idea with sign text, and a shot list of 5 photos to take this week.",
        systemAddition: `TASK: Generate a weekly marketing plan.

For each day (Monday-Friday), provide:
1. One post: which platform, the caption (in a code block), hashtags (in a separate code block), what photo to take, and brief posting steps
2. One quick task if applicable (under 5 minutes)

Also include once for the week:
- A Google listing post (in a code block) with instructions for how to post it
- This week's special (deal, sign text in a code block, Instagram caption in a code block)
- 5 specific photos to take this week

Keep each day's work to 10-15 minutes. Be specific with photo directions ("take a photo of a BEC from above on deli paper" not "capture a flat lay").`
    },

    'social-media': {
        title: "Social Media Posts",
        description: "Creates 5 ready-to-post Instagram and Facebook posts for the week. Each one has the caption, hashtags, and what photo to take — all ready to copy and paste.",
        inputLabel: "Any specific food or events you want to feature? (Leave blank for general posts)",
        inputPlaceholder: "e.g., we just got new coffee cups, or chicken over rice has been selling great...",
        defaultMessage: "Generate 5 social media posts for this week. Today's date is {date}. For each post provide: what day to post, the platform (Instagram/Facebook/both), the caption (in a code block), hashtags (in a separate code block), specific photo directions, and brief posting instructions. Also suggest 2 simple Story/Reel ideas.",
        systemAddition: `TASK: Generate 5 social media posts for the week.

Rotate through these themes:
1. The Food — Photos of sandwiches, chicken over rice, fresh coffee
2. Morning Rush — Early morning energy, LIRR commuters, "5 AM and we're rolling"
3. Convenience Store — Store items, snacks, essentials
4. Bellport Community — Local shoutouts, weather posts, neighborhood vibes
5. Behind the Counter — Making food, the team, real deli life

For each post:
- Day and time to post
- Platform (Instagram, Facebook, or both)
- Caption in a code block (ready to copy-paste)
- Hashtags in a separate code block
- Specific photo direction (what food, what angle, where to stand)
- Brief posting steps (Open Instagram → tap + → pick photo → paste caption → Share)

Also include 2 simple Story/Reel ideas (what to film, how long, text to put on screen, how to post).

Hashtag bank to mix from: #BellportNY #LongIslandEats #NYCDeli #LIRRCommute #BellportDeli #QuickstopSuperDeli #LongIslandFood #SuffolkCountyEats #DeliLife #ChickenOverRice #BECSandwich #LongIslandDeli #BellportEats #LIFood #NYDeli`
    },

    'promotions': {
        title: "Promotions & Specials",
        description: "Comes up with deal ideas, specials, and promotions — with the sign text and social media captions ready to go. All realistic for a family-run shop.",
        inputLabel: "Anything specific? (Leave blank for seasonal suggestions)",
        inputPlaceholder: "e.g., I want a coffee deal, or we need to push delivery orders, or it's been slow on Tuesdays...",
        defaultMessage: "Generate promotion ideas for this week. Today's date is {date}. Include: this week's main special (name it, describe the deal, write the counter sign text, write an Instagram caption), a monthly theme, a simple loyalty idea (low-tech, like punch cards), one DoorDash promo idea and one GrubHub promo idea with setup steps, and a weather-based special based on typical weather for this time of year in Bellport NY.",
        systemAddition: `TASK: Generate promotion and special ideas.

Provide:
1. This Week's Special — Name it, describe the deal in one sentence, write the counter/window sign text (in a code block — keep it short, big letters), and an Instagram caption (in a code block).
2. Monthly Theme — What's happening this month? One theme and 2-3 things to do.
3. Loyalty Idea — Something simple with paper punch cards (what to write on the card, how to explain it to customers).
4. Delivery App Ideas — One for DoorDash, one for GrubHub, with step-by-step setup instructions for the merchant dashboard.
5. Weather Special — Based on the current season, suggest a weather-appropriate deal with sign text and caption.

Keep everything realistic for a family-run deli. No apps, no graphic designers, no big budgets. Handwritten signs and word-of-mouth are the tools.`
    },

    'local-seo': {
        title: "Help People Find Us",
        description: "Creates posts for the Google listing and gives tips to help more people find the deli when they search on Google. This is how people find you when they search 'deli near me.'",
        inputLabel: "Anything specific you want help with? (Leave blank for the standard package)",
        inputPlaceholder: "e.g., write a Google post, help me respond to reviews, check if we're listed everywhere...",
        defaultMessage: "Generate local SEO content for Quickstop Super Deli. Today's date is {date}. Include: 2 ready-to-post Google Business Profile posts (in code blocks), step-by-step instructions for how to post them, 3 Google review response templates (good, bad, and okay reviews, each in a code block), and a checklist of directories to make sure we're listed on.",
        systemAddition: `TASK: Help the deli show up on Google search.

Provide:
1. Two Google listing posts (in code blocks, 150-300 words each). End with a call to action. Include step-by-step posting instructions (Open Google Business Profile app → tap Add update → paste → add photo → Post).
2. Three review response templates (in code blocks): one for a good review, one for a bad review, one for an okay review. Include step-by-step instructions for how to reply to a review on Google Maps.
3. Directory checklist — list the top sites where the deli should be listed (Yelp, Apple Maps, etc.) with links and brief instructions.

Target keywords to weave in naturally: "deli near Bellport LIRR", "breakfast sandwiches Bellport NY", "convenience store Bellport", "chicken over rice Long Island", "deli delivery Bellport".

Say "Google listing" not "GBP". Say "shows up higher in search" not "improves rankings". Keep it plain and simple.`
    },

    'review-response': {
        title: "Reply to a Review",
        description: "Paste a Google review below and get a response you can copy and paste right back. Works for good reviews, bad reviews, and everything in between.",
        inputLabel: "Paste the review here:",
        inputPlaceholder: "Paste the customer's review text here...\n\ne.g., \"Great BEC and the coffee is always hot. Love this place, been coming here for years.\"",
        defaultMessage: "The customer didn't paste a specific review. Generate 3 review response templates: one for a 5-star positive review, one for a 1-2 star negative review, and one for a 3-star mixed review. Put each response in a code block. Include step-by-step instructions for how to reply on Google Maps.",
        systemAddition: `TASK: Write a reply to a Google review.

Rules:
- Keep the response short (2-4 sentences max)
- Sound genuine and personal, not canned
- If it's a good review: thank them, mention something specific from their review, invite them back
- If it's a bad review: stay calm, say sorry, offer to fix it, give the phone number (631) 286-1491
- If it's a mixed review: thank them, address the concern briefly, invite them back
- Put the response in a code block so it's easy to copy

Also include step-by-step instructions:
1. Open the Google Maps app
2. Search for Quickstop Super Deli
3. Tap on the listing
4. Scroll to Reviews
5. Find this review and tap Reply
6. Paste the response
7. Tap Post reply`
    }
};

// ---- DOM Elements ----

const homeScreen = document.getElementById('home-screen');
const toolScreen = document.getElementById('tool-screen');
const toolTitle = document.getElementById('tool-title');
const toolDescription = document.getElementById('tool-description');
const inputLabel = document.getElementById('input-label');
const toolInput = document.getElementById('tool-input');
const generateBtn = document.getElementById('generate-btn');
const generateBtnText = document.querySelector('.generate-btn-text');
const generateBtnLoading = document.querySelector('.generate-btn-loading');
const resultsArea = document.getElementById('results-area');
const resultsContent = document.getElementById('results-content');
const errorArea = document.getElementById('error-area');
const errorMessage = document.getElementById('error-message');
const backBtn = document.getElementById('back-btn');
const copyAllBtn = document.getElementById('copy-all-btn');
const regenerateBtn = document.getElementById('regenerate-btn');
const retryBtn = document.getElementById('retry-btn');

let currentTool = null;
let rawResultText = '';

// ---- Navigation ----

document.querySelectorAll('.tool-card').forEach(card => {
    card.addEventListener('click', () => {
        const toolId = card.dataset.tool;
        openTool(toolId);
    });
});

backBtn.addEventListener('click', goHome);

function openTool(toolId) {
    currentTool = toolId;
    const config = TOOL_CONFIGS[toolId];

    toolTitle.textContent = config.title;
    toolDescription.textContent = config.description;
    inputLabel.textContent = config.inputLabel;
    toolInput.placeholder = config.inputPlaceholder;
    toolInput.value = '';

    // Reset state
    resultsArea.classList.add('hidden');
    errorArea.classList.add('hidden');
    setGenerating(false);
    rawResultText = '';

    homeScreen.classList.add('hidden');
    toolScreen.classList.remove('hidden');

    // Focus on input if it's the review tool
    if (toolId === 'review-response') {
        setTimeout(() => toolInput.focus(), 100);
    }

    window.scrollTo(0, 0);
}

function goHome() {
    toolScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
    currentTool = null;
    window.scrollTo(0, 0);
}

// ---- Generation ----

generateBtn.addEventListener('click', generate);
regenerateBtn.addEventListener('click', generate);
retryBtn.addEventListener('click', generate);

async function generate() {
    if (!currentTool) return;

    const config = TOOL_CONFIGS[currentTool];
    const userInput = toolInput.value.trim();

    // Build the message
    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let userMessage;
    if (userInput) {
        if (currentTool === 'review-response') {
            userMessage = `Here is the Google review I need to reply to:\n\n"${userInput}"\n\nWrite a response I can copy and paste.`;
        } else {
            userMessage = config.defaultMessage.replace('{date}', today) + `\n\nAdditional context from the user: ${userInput}`;
        }
    } else {
        userMessage = config.defaultMessage.replace('{date}', today);
    }

    const systemPrompt = BASE_SYSTEM_PROMPT + '\n\n' + config.systemAddition;

    // Update UI
    setGenerating(true);
    resultsArea.classList.add('hidden');
    errorArea.classList.add('hidden');
    rawResultText = '';
    resultsContent.innerHTML = '<span class="streaming-cursor"></span>';

    try {
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt, userMessage })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `Request failed (${response.status})`);
        }

        // Stream the response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(dataStr);
                        if (data.type === 'content_block_delta' && data.delta?.text) {
                            rawResultText += data.delta.text;
                            renderMarkdown(rawResultText, true);
                        }
                    } catch {
                        // Skip malformed JSON lines
                    }
                }
            }
        }

        // Final render without cursor
        renderMarkdown(rawResultText, false);
        resultsArea.classList.remove('hidden');
        setGenerating(false);

        // Scroll to results
        resultsArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
        setGenerating(false);
        errorMessage.textContent = 'Something went wrong. Check your internet connection and try again.';

        // Show more detail for debugging
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            errorMessage.textContent = "Can't connect to the server. Make sure you're connected to the internet.";
        } else if (err.message.includes('WORKER_URL') || WORKER_URL.includes('YOUR-WORKER')) {
            errorMessage.textContent = "The dashboard isn't connected to the AI yet. The worker URL needs to be set up — ask your developer.";
        }

        errorArea.classList.remove('hidden');
        resultsArea.classList.add('hidden');
        console.error('Generation error:', err);
    }
}

function setGenerating(isGenerating) {
    generateBtn.disabled = isGenerating;
    if (isGenerating) {
        generateBtnText.classList.add('hidden');
        generateBtnLoading.classList.remove('hidden');
        resultsArea.classList.remove('hidden');
    } else {
        generateBtnText.classList.remove('hidden');
        generateBtnLoading.classList.add('hidden');
    }
}

// ---- Markdown Rendering ----

function renderMarkdown(text, streaming) {
    let html = '';
    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeContent = '';
    let codeBlockCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code block toggle
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                // Close code block
                codeBlockCount++;
                html += `<div class="code-block-wrapper">
                    <button class="copy-btn" data-code-id="code-${codeBlockCount}" onclick="copyCodeBlock(this, 'code-${codeBlockCount}')">Tap to Copy</button>
                    <pre><code id="code-${codeBlockCount}">${escapeHtml(codeContent.trim())}</code></pre>
                </div>`;
                codeContent = '';
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
                codeContent = '';
            }
            continue;
        }

        if (inCodeBlock) {
            codeContent += line + '\n';
            continue;
        }

        // Headers
        if (line.startsWith('### ')) {
            html += `<h3>${formatInline(line.slice(4))}</h3>`;
        } else if (line.startsWith('## ')) {
            html += `<h2>${formatInline(line.slice(3))}</h2>`;
        } else if (line.startsWith('# ')) {
            html += `<h1>${formatInline(line.slice(2))}</h1>`;
        }
        // Horizontal rule
        else if (line.trim() === '---' || line.trim() === '***') {
            html += '<hr>';
        }
        // Unordered list
        else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
            const indent = line.match(/^\s*/)[0].length;
            const content = line.trim().slice(2);
            html += `<li style="margin-left:${indent > 0 ? '1rem' : '0'}">${formatInline(content)}</li>`;
        }
        // Ordered list
        else if (/^\s*\d+\.\s/.test(line)) {
            const content = line.replace(/^\s*\d+\.\s/, '');
            html += `<li>${formatInline(content)}</li>`;
        }
        // Empty line
        else if (line.trim() === '') {
            html += '<br>';
        }
        // Regular paragraph
        else {
            html += `<p>${formatInline(line)}</p>`;
        }
    }

    // Handle unclosed code block (still streaming)
    if (inCodeBlock && streaming) {
        codeBlockCount++;
        html += `<div class="code-block-wrapper">
            <pre><code id="code-${codeBlockCount}">${escapeHtml(codeContent)}</code></pre>
        </div>`;
    }

    // Add streaming cursor
    if (streaming) {
        html += '<span class="streaming-cursor"></span>';
    }

    resultsContent.innerHTML = html;
}

function formatInline(text) {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return text;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- Copy Functions ----

window.copyCodeBlock = function(btn, codeId) {
    const codeEl = document.getElementById(codeId);
    if (!codeEl) return;

    const text = codeEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Tap to Copy';
            btn.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Tap to Copy';
            btn.classList.remove('copied');
        }, 2000);
    });
};

copyAllBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(rawResultText).then(() => {
        copyAllBtn.querySelector('svg + *') || copyAllBtn;
        const originalText = copyAllBtn.textContent;
        copyAllBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg> Copy Everything`;
        }, 2000);
    });
});

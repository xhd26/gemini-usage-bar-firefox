# Gemini Usage Bar — Firefox Fork

> **This is a Firefox port of the original Chrome extension by [Zandaland](https://github.com/Zandaland/gemini-usage-bar).**
> All credit for the original idea, design, and code goes to the original author.
> Original repository: [github.com/Zandaland/gemini-usage-bar](https://github.com/Zandaland/gemini-usage-bar)

---

This fork adapts the extension to run on Firefox with the minimum changes necessary to make it compatible. No features have been added or removed — behavior is identical to the original.

![Gemini Usage Bar Icon](icon.png)

## Features

- **Real-Time Updates**: Automatically refreshes your remaining limit percentage the exact moment Gemini finishes generating a response.
- **Premium Aesthetics**: Sleek, glassmorphic layout that synchronizes natively with Gemini's active light or dark themes.
- **Detailed Dropdown**: Click the pill to expand detailed status bars showing both your **Current Limit** and **Weekly Limit** along with their exact reset times.
- **Manual Refresh**: Includes an interactive refresh button inside the dropdown header with a spin loading animation.
- **Keyboard Shortcut & Toggle**: Press `Alt + U` to hide or show the indicator. When hidden, an unobtrusive floating eye button appears for quick recovery.
- **Dynamic Sidebar Alignment**: Automatically slides to the right when Gemini's sidebar is open to prevent overlapping any logo or navigation text.
- **Auth Detection**: Automatically detects if you are logged out and displays a sign-in warning with a direct redirect link.

---

## How It Works

1. **Header Stripping**: Uses Firefox's `declarativeNetRequest` API to strip restrictive framing headers (`Content-Security-Policy` and `X-Frame-Options`) on requests to `gemini.google.com/usage`.
2. **Dual-Strategy Scraper**:
   - **Strategy 1**: First attempts a fast background `fetch()` request to parse page content.
   - **Strategy 2**: If the page requires dynamic client-side rendering, falls back to loading the page in a hidden same-origin iframe and polls the `iframe.contentDocument` directly.
3. **Response State Observer**: Uses a `MutationObserver` on the document body to monitor Gemini's send/stop buttons. Captures the transition from "active generation" back to "idle" and immediately triggers a refresh.

---

## What Changed for Firefox

Only one file was modified from the original:

**`manifest.json`**
- Replaced `background.service_worker` with `background.scripts` — Firefox MV3 uses event pages rather than service workers.
- Added `browser_specific_settings` with a Gecko ID (`gemini-usage-bar@firefox`) and a minimum version of Firefox 128.

Everything else — `background.js`, `content.js`, `styles.css` — is untouched. Firefox ships a `chrome.*` compatibility namespace that maps directly to its native `browser.*` APIs, so no code changes were needed.

---

## Installation

Install directly from the Mozilla Add-ons store — no setup required:

1. Visit the [Gemini Usage Bar page on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/gemini-usage-bar/)
2. Click **Add to Firefox**
3. Open [Google Gemini](https://gemini.google.com/) and the usage pill will appear in the top-left corner

---

## Keyboard Shortcuts

- **Toggle Visibility**: `Alt + U`

---

## Credits

This is a fork. The original extension was created by **[Zandaland](https://github.com/Zandaland/gemini-usage-bar)** — please visit the original repository and give it a star if you find this useful.

## License

MIT License — see the [LICENSE](LICENSE) file for details.

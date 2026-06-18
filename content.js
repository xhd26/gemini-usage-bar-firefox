// Gemini Tweaks - Content Script

(function () {
  // We only run this script in the top-level main application page
  if (window.self !== window.top) {
    return;
  }

  console.log("[Gemini Tweaks] Running in main chat application mode...");

  let usageData = null;
  let isPillVisible = true;
  let isGeneratingResponse = false;
  let iframeElement = null;
  let pollInterval = null;
  let cachedSidebarElement = null;

  // Load visibility settings on startup
  chrome.storage.local.get({ usageBarVisible: true }, (result) => {
    isPillVisible = result.usageBarVisible;
    updateVisibilityDOM();
  });

  // Create the hidden iframe
  function initIframe() {
    if (document.getElementById('gemini-usage-iframe')) return;

    iframeElement = document.createElement('iframe');
    iframeElement.id = 'gemini-usage-iframe';
    iframeElement.src = 'https://gemini.google.com/usage';
    iframeElement.style.position = 'absolute';
    iframeElement.style.width = '0';
    iframeElement.style.height = '0';
    iframeElement.style.border = 'none';
    iframeElement.style.visibility = 'hidden';
    iframeElement.style.pointerEvents = 'none';
    document.body.appendChild(iframeElement);
  }

  // DOM Parsing Helper
  function extractDataFromDocument(doc) {
    if (!doc) return null;

    let currentPercent = null;
    let currentReset = "";
    let weeklyPercent = null;
    let weeklyReset = "";

    // 1. Selector-based search
    const currentEl = doc.querySelector('[data-test-id="gxu-currently"]') || doc.querySelector('.gxu-currently');
    const weeklyEl = doc.querySelector('[data-test-id="gxu-weekly"]') || doc.querySelector('.gxu-weekly');

    if (currentEl) {
      const texts = Array.from(currentEl.querySelectorAll('p, div, span')).map(el => el.textContent.trim());
      for (const text of texts) {
        const match = text.match(/(\d+)%\s*used/i) || text.match(/(\d+)%/);
        if (match && currentPercent === null) currentPercent = parseInt(match[1], 10);
        if (text.toLowerCase().startsWith('resets') || text.toLowerCase().includes('reset')) currentReset = text;
      }
    }

    if (weeklyEl) {
      const texts = Array.from(weeklyEl.querySelectorAll('p, div, span')).map(el => el.textContent.trim());
      for (const text of texts) {
        const match = text.match(/(\d+)%\s*used/i) || text.match(/(\d+)%/);
        if (match && weeklyPercent === null) weeklyPercent = parseInt(match[1], 10);
        if (text.toLowerCase().startsWith('resets') || text.toLowerCase().includes('reset')) weeklyReset = text;
      }
    }

    // 2. Text-search fallback if selectors fail or are incomplete
    if (currentPercent === null || weeklyPercent === null) {
      const elements = Array.from(doc.querySelectorAll('p, div, span, h1, h2, h3, h4, section'));
      const items = [];
      for (const el of elements) {
        if (el.children.length === 0 || Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0)) {
          const text = el.textContent.trim();
          if (text) items.push({ el, text });
        }
      }

      for (const item of items) {
        const percentMatch = item.text.match(/(\d+)%\s*used/i) || item.text.match(/(\d+)%/);
        if (percentMatch) {
          const val = parseInt(percentMatch[1], 10);
          let isWeekly = false;
          let parent = item.el;
          let depth = 0;
          while (parent && parent !== doc.body && depth < 5) {
            const parentText = parent.textContent.toLowerCase();
            if (parentText.includes('weekly') || parentText.includes('week') || parentText.includes('7-day') || parentText.includes('7 days')) {
              isWeekly = true;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }

          if (isWeekly) {
            if (weeklyPercent === null) weeklyPercent = val;
          } else {
            if (currentPercent === null) currentPercent = val;
          }
        }

        const isResetText = item.text.toLowerCase().includes('reset') || item.text.toLowerCase().startsWith('resets');
        if (isResetText) {
          let isWeekly = false;
          let parent = item.el;
          let depth = 0;
          while (parent && parent !== doc.body && depth < 5) {
            const parentText = parent.textContent.toLowerCase();
            if (parentText.includes('weekly') || parentText.includes('week') || parentText.includes('7-day') || parentText.includes('7 days')) {
              isWeekly = true;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }

          if (isWeekly) {
            if (!weeklyReset) weeklyReset = item.text;
          } else {
            if (!currentReset) currentReset = item.text;
          }
        }
      }
    }

    if (currentPercent === null && weeklyPercent === null) {
      return null;
    }

    return {
      currentPercent: currentPercent !== null ? currentPercent : 0,
      currentReset: currentReset || "Unknown reset time",
      weeklyPercent: weeklyPercent !== null ? weeklyPercent : 0,
      weeklyReset: weeklyReset || "Unknown reset time"
    };
  }

  // Refresh and scrape usage details
  async function refreshUsageData() {
    console.log("[Gemini Tweaks] Refreshing usage details...");
    setPillLoading(true);

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // Strategy 1: Fetch via AJAX (super fast, works if SSR HTML contains data)
    try {
      const response = await fetch('https://gemini.google.com/usage?t=' + Date.now());
      if (response.ok) {
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const data = extractDataFromDocument(doc);
        if (data) {
          console.log("[Gemini Tweaks] Successfully fetched and parsed usage via AJAX:", data);
          usageData = data;
          updateUsageUI();
          return;
        }
      }
    } catch (err) {
      console.warn("[Gemini Tweaks] AJAX fetch failed, falling back to iframe:", err);
    }

    // Strategy 2: Same-origin Iframe (allows Angular to execute and render elements)
    if (!iframeElement) {
      initIframe();
    }

    // Reload iframe content
    iframeElement.src = 'https://gemini.google.com/usage?t=' + Date.now();

    let attempts = 0;
    const maxAttempts = 30; // 15 seconds

    pollInterval = setInterval(() => {
      attempts++;
      try {
        const iframeDoc = iframeElement.contentDocument || iframeElement.contentWindow.document;
        if (iframeDoc) {
          // If we detect Google's sign-in redirect, show auth message
          if (iframeDoc.title && (iframeDoc.title.includes('Sign in') || iframeDoc.title.includes('Anmelden'))) {
            setAuthWarning();
            clearInterval(pollInterval);
            pollInterval = null;
            return;
          }

          const data = extractDataFromDocument(iframeDoc);
          if (data) {
            console.log("[Gemini Tweaks] Successfully scraped usage via iframe DOM:", data);
            usageData = data;
            updateUsageUI();
            clearInterval(pollInterval);
            pollInterval = null;
            return;
          }
        }
      } catch (e) {
        // Cross-origin exception (likely redirected to accounts.google.com for login)
        console.warn("[Gemini Tweaks] Error reading iframe DOM (redirected to sign-in?):", e);
        setAuthWarning();
        clearInterval(pollInterval);
        pollInterval = null;
        return;
      }

      if (attempts >= maxAttempts) {
        console.error("[Gemini Tweaks] Failed to load and scrape usage page after 15s.");
        setPillLoading(false);
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }, 500);
  }

  // Show authorization required warning
  function setAuthWarning() {
    setPillLoading(false);
    
    const valText = document.getElementById('gt-pill-val');
    const indicator = document.getElementById('gt-pill-indicator');
    const curVal = document.getElementById('gt-current-val');
    const curReset = document.getElementById('gt-current-reset');
    
    if (valText) valText.textContent = "Auth 🔑";
    if (indicator) {
      indicator.style.width = '100%';
      indicator.style.backgroundColor = 'var(--gt-accent-high)';
    }
    if (curVal) curVal.textContent = "Sign-in required";
    if (curReset) {
      curReset.innerHTML = '<a href="https://gemini.google.com/usage" target="_blank" style="color: var(--gt-accent-weekly); text-decoration: underline;">Open usage page to sign in</a>';
    }
  }

  // Listen for toggle messages from background script (shortcut Alt+U)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "toggle_visibility") {
      toggleVisibility();
    }
  });

  // Create or retrieve the UI elements
  function getOrCreateUI() {
    let container = document.getElementById('gemini-usage-pill-container');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'gemini-usage-pill-container';
    container.className = 'gemini-usage-pill-container gt-loading';

    // Inner Pill HTML
    container.innerHTML = `
      <div class="gemini-usage-pill" id="gt-pill-btn" title="Click to view details">
        <span class="gt-pill-label">Usage:</span>
        <span class="gt-pill-value" id="gt-pill-val">--%</span>
        <div class="gt-pill-track">
          <div class="gt-pill-indicator" id="gt-pill-indicator"></div>
        </div>
      </div>
      <button class="gt-eye-toggle-btn gt-hidden" id="gt-eye-toggle" title="Show usage bar (Alt+U)">
        <svg viewBox="0 0 24 24">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
      </button>
      <div class="gemini-usage-dropdown" id="gt-dropdown">
        <div class="gt-dropdown-header">
          <h3>Gemini Usage</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="gt-action-btn" id="gt-refresh-btn" title="Refresh Usage">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>
            <button class="gt-close-btn" id="gt-dropdown-close" title="Hide Pill (Alt+U)">&times;</button>
          </div>
        </div>
        <div class="gt-dropdown-content">
          <!-- Current Usage -->
          <div class="gt-usage-section">
            <div class="gt-section-title-row">
              <span class="gt-section-title">Current Limit</span>
              <span class="gt-section-value" id="gt-current-val">--% used</span>
            </div>
            <div class="gt-dropdown-track">
              <div class="gt-dropdown-indicator" id="gt-current-indicator"></div>
            </div>
            <div class="gt-reset-time" id="gt-current-reset">Loading...</div>
          </div>
          
          <!-- Weekly Usage -->
          <div class="gt-usage-section" style="margin-top: 8px;">
            <div class="gt-section-title-row">
              <span class="gt-section-title">Weekly Limit</span>
              <span class="gt-section-value" id="gt-weekly-val">--% used</span>
            </div>
            <div class="gt-dropdown-track">
              <div class="gt-dropdown-indicator" id="gt-weekly-indicator" style="background-color: var(--gt-accent-weekly);"></div>
            </div>
            <div class="gt-reset-time" id="gt-weekly-reset">Loading...</div>
          </div>
        </div>
      </div>
    `;

    // Event: Toggle dropdown on pill click
    const pillBtn = container.querySelector('#gt-pill-btn');
    pillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.toggle('dropdown-open');
    });

    // Event: Close pill from dropdown close button
    const closeBtn = container.querySelector('#gt-dropdown-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.remove('dropdown-open');
      toggleVisibility(false);
    });

    // Event: Click on eye toggle button to show the usage bar
    const eyeBtn = container.querySelector('#gt-eye-toggle');
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVisibility(true);
    });

    // Event: Manual refresh button click
    const refreshBtn = container.querySelector('#gt-refresh-btn');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshUsageData();
    });

    // Prevent closing when clicking inside the dropdown
    const dropdown = container.querySelector('#gt-dropdown');
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close dropdown when clicking anywhere else
    document.addEventListener('click', () => {
      container.classList.remove('dropdown-open');
    });

    return container;
  }

  // Set UI loading state
  function setPillLoading(isLoading) {
    const container = getOrCreateUI();
    if (isLoading) {
      if (!container.classList.contains('gt-loading')) {
        container.classList.add('gt-loading');
      }
    } else {
      if (container.classList.contains('gt-loading')) {
        container.classList.remove('gt-loading');
      }
    }

    const refreshBtn = document.getElementById('gt-refresh-btn');
    if (refreshBtn) {
      if (isLoading) {
        if (!refreshBtn.classList.contains('spinning')) {
          refreshBtn.classList.add('spinning');
        }
      } else {
        if (refreshBtn.classList.contains('spinning')) {
          refreshBtn.classList.remove('spinning');
        }
      }
    }
  }

  // Find the sidebar element in a completely robust way
  function findSidebarElement() {
    if (cachedSidebarElement && cachedSidebarElement.isConnected) {
      return cachedSidebarElement;
    }

    // Search for the vertical sidebar container on the left side of the screen
    const allElements = document.querySelectorAll('*');
    const candidates = [];
    const minWidth = 40;
    const maxWidth = Math.min(450, window.innerWidth * 0.5);

    for (const el of allElements) {
      const rect = el.getBoundingClientRect();
      if (rect.left <= 15 && 
          rect.height >= window.innerHeight * 0.7 && 
          rect.width >= minWidth && rect.width <= maxWidth) {
        candidates.push(el);
      }
    }

    if (candidates.length > 0) {
      // Find the outermost matching container (the element not contained in any other candidate)
      const outermost = candidates.find(c => !candidates.some(other => other !== c && other.contains(c)));
      if (outermost) {
        cachedSidebarElement = outermost;
        return outermost;
      }
    }
    
    return null;
  }

  // Adjust pill position based on sidebar visibility and width
  function adjustPillPosition() {
    const container = document.getElementById('gemini-usage-pill-container');
    if (!container) return;

    const sidebar = findSidebarElement();
    let sidebarRight = 0;
    
    if (sidebar) {
      const rect = sidebar.getBoundingClientRect();
      // A sidebar is considered open/visible if it has a width > 100px,
      // its right edge is > 100px, its left edge is near the left edge (< 50px),
      // and it doesn't span the entire width of the viewport (less than 450px).
      if (rect.width > 100 && rect.width < 450 && rect.right > 100 && rect.left < 50) {
        sidebarRight = rect.right;
      }
    }

    const newLeft = sidebarRight > 0 ? `${sidebarRight + 12}px` : '68px';
    if (container.style.left !== newLeft) {
      container.style.left = newLeft;
    }
  }

  // Mount UI in the header or fallback
  function mountUI() {
    const container = getOrCreateUI();

    // Since we use always-fixed positioning, we mount directly to document.body
    if (container.parentElement !== document.body) {
      document.body.appendChild(container);
    }

    updateVisibilityDOM();
    adjustPillPosition();
  }

  // Update UI elements with scraped data
  function updateUsageUI() {
    if (!usageData) return;
    setPillLoading(false);

    const valText = document.getElementById('gt-pill-val');
    const indicator = document.getElementById('gt-pill-indicator');
    const curVal = document.getElementById('gt-current-val');
    const curIndicator = document.getElementById('gt-current-indicator');
    const curReset = document.getElementById('gt-current-reset');
    
    const wkVal = document.getElementById('gt-weekly-val');
    const wkIndicator = document.getElementById('gt-weekly-indicator');
    const wkReset = document.getElementById('gt-weekly-reset');

    if (valText) valText.textContent = `${usageData.currentPercent}%`;
    if (indicator) {
      indicator.style.width = `${usageData.currentPercent}%`;
      // Choose accent color based on limit threshold
      if (usageData.currentPercent < 50) {
        indicator.style.backgroundColor = 'var(--gt-accent-low)';
      } else if (usageData.currentPercent < 80) {
        indicator.style.backgroundColor = 'var(--gt-accent-medium)';
      } else {
        indicator.style.backgroundColor = 'var(--gt-accent-high)';
      }
    }

    // Update dropdown details
    if (curVal) curVal.textContent = `${usageData.currentPercent}% used`;
    if (curIndicator) {
      curIndicator.style.width = `${usageData.currentPercent}%`;
      if (usageData.currentPercent < 50) {
        curIndicator.style.backgroundColor = 'var(--gt-accent-low)';
      } else if (usageData.currentPercent < 80) {
        curIndicator.style.backgroundColor = 'var(--gt-accent-medium)';
      } else {
        curIndicator.style.backgroundColor = 'var(--gt-accent-high)';
      }
    }
    if (curReset) curReset.textContent = usageData.currentReset;

    if (wkVal) wkVal.textContent = `${usageData.weeklyPercent}% used`;
    if (wkIndicator) wkIndicator.style.width = `${usageData.weeklyPercent}%`;
    if (wkReset) wkReset.textContent = usageData.weeklyReset;
  }

  // Toggle the visible state
  function toggleVisibility(forceState) {
    isPillVisible = forceState !== undefined ? forceState : !isPillVisible;
    chrome.storage.local.set({ usageBarVisible: isPillVisible });
    updateVisibilityDOM();
  }

  // Sync visibility state with the DOM
  function updateVisibilityDOM() {
    const container = document.getElementById('gemini-usage-pill-container');
    if (!container) return;

    const pill = container.querySelector('#gt-pill-btn');
    const eyeBtn = container.querySelector('#gt-eye-toggle');

    if (isPillVisible) {
      if (pill && pill.classList.contains('gt-hidden')) {
        pill.classList.remove('gt-hidden');
      }
      if (eyeBtn && !eyeBtn.classList.contains('gt-hidden')) {
        eyeBtn.classList.add('gt-hidden');
      }
    } else {
      if (pill && !pill.classList.contains('gt-hidden')) {
        pill.classList.add('gt-hidden');
      }
      if (eyeBtn && eyeBtn.classList.contains('gt-hidden')) {
        eyeBtn.classList.remove('gt-hidden');
      }
      if (container.classList.contains('dropdown-open')) {
        container.classList.remove('dropdown-open');
      }
    }
  }

  // Monitor response status
  function checkResponseState() {
    // Look for a Stop Button or Generating Indicators
    const stopBtn = document.querySelector('button[aria-label*="Stop" i]') ||
                    document.querySelector('button[aria-label*="stop" i]') ||
                    document.querySelector('button[aria-label*="Cancel" i]') ||
                    document.querySelector('mat-icon[fonticon="stop"]') ||
                    document.querySelector('gem-icon[name="stop"]') ||
                    document.querySelector('.generating-indicator') ||
                    document.querySelector('div[class*="generating" i]');
    
    const currentlyGenerating = !!stopBtn;

    if (currentlyGenerating && !isGeneratingResponse) {
      // Just started generating
      isGeneratingResponse = true;
      console.log("[Gemini Tweaks] Generation started...");
    } else if (!currentlyGenerating && isGeneratingResponse) {
      // Just finished generating
      isGeneratingResponse = false;
      console.log("[Gemini Tweaks] Generation completed! Triggering refresh.");
      // Give the page a slight moment to process backend logs before fetching
      setTimeout(refreshUsageData, 1000);
    }
  }

  // Initialize all components
  function init() {
    initIframe();
    mountUI();

    // Listen to window resize to reposition the pill if sidebar width changes
    window.addEventListener('resize', adjustPillPosition);

    // Mutation observer to maintain injection and dynamically adjust position
    const bodyObserver = new MutationObserver(() => {
      const container = document.getElementById('gemini-usage-pill-container');
      if (!container || !container.isConnected) {
        mountUI();
      }
      adjustPillPosition();
      checkResponseState();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-expanded']
    });

    // Initial layout mounting checks
    setTimeout(mountUI, 500);
    setTimeout(mountUI, 1500);
    setTimeout(mountUI, 3000);

    // Initial fetch of usage data
    setTimeout(refreshUsageData, 1000);

    // Periodically refresh the data (e.g. every 5 minutes in case of external usage)
    setInterval(refreshUsageData, 5 * 60 * 1000);
  }

  // Run initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

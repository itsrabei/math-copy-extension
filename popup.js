document.addEventListener('DOMContentLoaded', async () => {
    let settings = {};
    let stats = {};
    let selectionCount = 0;
    
    const elements = {
        formatSelect: document.getElementById('format-select'),
        autoCopyToggle: document.getElementById('auto-copy'),
        multiSelectionToggle: document.getElementById('multi-selection'),
        darkModeToggle: document.getElementById('dark-mode'),
        historyContainer: document.getElementById('clipboard-history'),
        clearHistoryBtn: document.getElementById('clear-history'),
        statusBar: document.getElementById('status-bar'),
        statusText: document.getElementById('status-text'),
        selectionCount: document.getElementById('selection-count'),
        copySelectedBtn: document.getElementById('copy-selected'),
        clearSelectionBtn: document.getElementById('clear-selection'),
        helpBtn: document.getElementById('help-btn'),
        advancedBtn: document.getElementById('advanced-btn'),
        detectBtn: document.getElementById('detect-btn'),
        selectionStatus: document.getElementById('selection-status'),
        disablePageBtn: document.getElementById('disable-page'),
        disableSiteBtn: document.getElementById('disable-site'),
        enablePageBtn: document.getElementById('enable-page'),
        enableSiteBtn: document.getElementById('enable-site')
    };

    // Validate critical elements exist
    const criticalElements = ['formatSelect', 'autoCopyToggle', 'historyContainer', 'statusBar'];
    const missingElements = criticalElements.filter(key => !elements[key]);
    if (missingElements.length > 0) {
        console.error('Missing critical popup elements:', missingElements);
    }

    async function loadSettings() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getSettings' });
            if (response && response.error) {
                throw new Error(response.error);
            }
            
            settings = response || {};
            const defaultSettings = { 
                format: 'mathml', 
                autoCopy: true, 
                multiSelection: true,
                darkMode: false 
            };
            settings = { ...defaultSettings, ...settings };
            const validFormats = ['mathml', 'latex', 'unicode', 'asciimath'];
            if (!validFormats.includes(settings.format)) {
                settings.format = 'mathml';
            }
            settings.autoCopy = Boolean(settings.autoCopy);
            settings.multiSelection = Boolean(settings.multiSelection);
            settings.darkMode = Boolean(settings.darkMode);
            
            updateUI();
        } catch (error) {
            console.error("Failed to load settings:", error);
            showStatus("Error loading settings", "error");
            settings = { 
                format: 'mathml', 
                autoCopy: true, 
                multiSelection: true,
                darkMode: false 
            };
            updateUI();
        }
    }

    async function loadStats() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getStats' });
            
            if (response && response.error) {
                console.error('Popup: Error in stats response:', response.error);
                throw new Error(response.error);
            }
            
            stats = response || {};
            updateStatsDisplay(stats);
        } catch (error) {
            console.error("Popup: Failed to load stats:", error);
            console.error("Error stack:", error.stack);
            updateStatsDisplay({
                totalCopies: 0,
                formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
                lastUsed: null
            });
        }
    }

    let saveTimeout;
    function debouncedSaveSettings() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveSettings();
        }, 300);
    }

    async function saveSettings() {
        try {
            const validFormats = ['mathml', 'latex', 'unicode', 'asciimath'];
            if (!validFormats.includes(settings.format)) {
                settings.format = 'mathml';
            }
            settings.autoCopy = Boolean(settings.autoCopy);
            settings.previewMode = Boolean(settings.previewMode);
            settings.validation = Boolean(settings.validation);
            settings.multiSelection = Boolean(settings.multiSelection);
            settings.showTooltips = Boolean(settings.showTooltips);
            settings.darkMode = Boolean(settings.darkMode);
            
            const response = await chrome.runtime.sendMessage({ type: 'saveSettings', settings: settings });
            
            if (response && response.error) {
                throw new Error(response.error);
            }
            
            notifyContentScriptOfUpdate();
        } catch (error) {
            console.error("Failed to save settings:", error);
            showStatus("Error saving settings", "error");
        }
    }

    async function loadHistory() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getHistory' });
            
            if (response && response.error) {
                console.error('Popup: Error in response:', response.error);
                throw new Error(response.error);
            }
            
            const history = Array.isArray(response) ? response : [];
            renderHistory(history);
        } catch (error) {
            console.error("Popup: Failed to load history:", error);
            console.error("Error stack:", error.stack);
            renderHistory([]);
        }
    }

    function updateUI() {
        if (elements.formatSelect) elements.formatSelect.value = settings.format || 'mathml';
        if (elements.autoCopyToggle) elements.autoCopyToggle.checked = !!settings.autoCopy;
        if (elements.multiSelectionToggle) elements.multiSelectionToggle.checked = !!settings.multiSelection;
        if (elements.darkModeToggle) elements.darkModeToggle.checked = !!settings.darkMode;
        document.body.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
    }

    function updateStatsDisplay(statsData) {
    }

    function renderHistory(history) {
        try {
            // Clear existing content
            if (!elements.historyContainer) {
                console.error('History container not found!');
                return;
            }
            
            elements.historyContainer.innerHTML = '';
            
            if (!Array.isArray(history) || history.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                const text = document.createElement('p');
                text.textContent = 'No equations copied yet';
                emptyState.appendChild(text);
                elements.historyContainer.appendChild(emptyState);
                return;
            }
            
            const safeHistory = history.slice(0, 10).filter(item => {
                return item && 
                       typeof item === 'object' && 
                       item.formula && 
                       typeof item.formula === 'string' &&
                       item.formula.length > 0 &&
                       item.formula.length < 10000; // Prevent extremely long formulas
            });
            
            // Create elements programmatically to prevent XSS
            safeHistory.forEach(item => {
                try {
                    const historyItem = document.createElement('div');
                    historyItem.className = 'history-item';
                    historyItem.setAttribute('data-formula', item.formula);
                    historyItem.setAttribute('role', 'button');
                    historyItem.setAttribute('tabindex', '0');
                    const ariaLabel = truncate(item.formula, 30).replace(/[<>]/g, '');
                    historyItem.setAttribute('aria-label', `Copy equation: ${ariaLabel}`);
                    
                    const historyContent = document.createElement('div');
                    historyContent.className = 'history-content';
                    
                    const formula = document.createElement('span');
                    formula.className = 'history-formula';
                    formula.textContent = truncate(item.formula, 40);
                    
                    const format = document.createElement('span');
                    format.className = 'history-format';
                    const safeFormat = (item.format || 'unknown').toUpperCase().slice(0, 10);
                    format.textContent = safeFormat;
                    
                    historyContent.appendChild(formula);
                    historyContent.appendChild(format);
                    
                    const time = document.createElement('div');
                    time.className = 'history-time';
                    const timestamp = item.timestamp ? new Date(item.timestamp) : new Date();
                    if (isNaN(timestamp.getTime())) {
                        time.textContent = '';
                    } else {
                        time.textContent = formatTime(item.timestamp);
                    }
                    
                    historyItem.appendChild(historyContent);
                    historyItem.appendChild(time);
                    
                    elements.historyContainer.appendChild(historyItem);
                } catch (itemError) {
                    console.error('Error rendering history item:', itemError);
                }
            });
        } catch (error) {
            console.error('Error rendering history:', error);
            if (elements.historyContainer) {
                elements.historyContainer.innerHTML = '';
                const errorState = document.createElement('div');
                errorState.className = 'empty-state';
                errorState.textContent = 'Error loading history';
                elements.historyContainer.appendChild(errorState);
            }
        }
    }

    function setupEventListeners() {
        if (elements.formatSelect) {
            elements.formatSelect.addEventListener('change', () => {
                settings.format = elements.formatSelect.value;
                saveSettings();
                showStatus(`Format set to ${settings.format.toUpperCase()}`, 'success');
            });
        }

        if (elements.autoCopyToggle) {
            elements.autoCopyToggle.addEventListener('change', () => {
                settings.autoCopy = elements.autoCopyToggle.checked;
                debouncedSaveSettings();
            });
        }

        if (elements.multiSelectionToggle) {
            elements.multiSelectionToggle.addEventListener('change', () => {
                settings.multiSelection = elements.multiSelectionToggle.checked;
                debouncedSaveSettings();
            });
        }

        if (elements.darkModeToggle) {
            elements.darkModeToggle.addEventListener('change', () => {
                settings.darkMode = elements.darkModeToggle.checked;
                document.body.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
                saveSettings();
            });
        }
        
        if (elements.clearHistoryBtn) {
            elements.clearHistoryBtn.addEventListener('click', async () => {
                await chrome.runtime.sendMessage({ type: 'clearHistory' });
                renderHistory([]);
                showStatus("History cleared", "success");
            });
        }

        if (elements.historyContainer) {
            // Click handler
            elements.historyContainer.addEventListener('click', async (e) => {
                const item = e.target.closest('.history-item');
                if (item && item.dataset.formula) {
                    await copyFromHistory(item);
                }
            });
            
            elements.historyContainer.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const item = e.target.closest('.history-item');
                    if (item && item.dataset.formula) {
                        e.preventDefault();
                        await copyFromHistory(item);
                    }
                }
            });
        }
        
        async function copyFromHistory(item) {
            try {
                const formula = item.dataset.formula;
                if (!formula || formula.length === 0) {
                    showStatus("No formula to copy", "error");
                    return;
                }
                
                if (formula.length > 1000000) {
                    showStatus("Formula too large to copy", "error");
                    return;
                }
                
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(formula);
                    showStatus("Copied from history!", "success");
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = formula;
                    textArea.setAttribute('readonly', '');
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    textArea.style.top = '-999999px';
                    textArea.setAttribute('aria-hidden', 'true');
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    textArea.setSelectionRange(0, formula.length);
                    const success = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    if (success) {
                        showStatus("Copied from history!", "success");
                    } else {
                        throw new Error('execCommand failed');
                    }
                }
            } catch (error) {
                console.error("Failed to copy from history:", error);
                showStatus("Failed to copy. Please try again.", "error");
            }
        }

        // Selection actions
        if (elements.copySelectedBtn) {
            elements.copySelectedBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.id) {
                        const response = await chrome.tabs.sendMessage(tab.id, {
                            type: 'copySelected'
                        });
                        if (response && response.success) {
                            showStatus(`Copied ${response.count} equations`, "success");
                            updateSelectionCount(0);
                        }
                    }
                } catch (error) {
                    console.error("Error copying selected equations:", error);
                    showStatus("Failed to copy selected equations", "error");
                }
            });
        }

        if (elements.clearSelectionBtn) {
            elements.clearSelectionBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.id) {
                        await chrome.tabs.sendMessage(tab.id, {
                            type: 'clearSelection'
                        });
                        updateSelectionCount(0);
                        showStatus("Selection cleared", "success");
                    }
                } catch (error) {
                    console.error("Error clearing selection:", error);
                    showStatus("Failed to clear selection", "error");
                }
            });
        }

        if (elements.helpBtn) {
            elements.helpBtn.addEventListener('click', () => {
                chrome.tabs.create({ 
                    url: 'https://github.com/itsrabei/math-copy-extension/' 
                });
            });
        }

        if (elements.advancedBtn) {
            elements.advancedBtn.addEventListener('click', () => {
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL('advanced.html') 
                });
            });
        }

        if (elements.detectBtn) {
            elements.detectBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.id) {
                        await chrome.tabs.sendMessage(tab.id, { type: 'forceDetection' });
                        showStatus("Equation detection triggered", "success");
                    }
                } catch (error) {
                    console.error("Error triggering detection:", error);
                    showStatus("Failed to trigger detection", "error");
                }
            });
        }

        if (elements.disablePageBtn) {
            elements.disablePageBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url) {
                        await chrome.runtime.sendMessage({ type: 'disableOnPage', url: tab.url });
                        updateEnableDisableButtons(true, false);
                        showStatus("Disabled on this page", "success");
                        if (tab.id) {
                            chrome.tabs.reload(tab.id);
                        }
                    }
                } catch (error) {
                    console.error("Error disabling on page:", error);
                    showStatus("Failed to disable on page", "error");
                }
            });
        }

        if (elements.disableSiteBtn) {
            elements.disableSiteBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url) {
                        const url = new URL(tab.url);
                        const siteUrl = `${url.protocol}//${url.host}`;
                        await chrome.runtime.sendMessage({ type: 'disableOnSite', url: siteUrl });
                        updateEnableDisableButtons(false, true);
                        showStatus("Disabled on this site", "success");
                        if (tab.id) {
                            chrome.tabs.reload(tab.id);
                        }
                    }
                } catch (error) {
                    console.error("Error disabling on site:", error);
                    showStatus("Failed to disable on site", "error");
                }
            });
        }

        if (elements.enablePageBtn) {
            elements.enablePageBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url) {
                        await chrome.runtime.sendMessage({ type: 'enableOnPage', url: tab.url });
                        updateEnableDisableButtons(false, false);
                        showStatus("Enabled on this page", "success");
                        if (tab.id) {
                            chrome.tabs.reload(tab.id);
                        }
                    }
                } catch (error) {
                    console.error("Error enabling on page:", error);
                    showStatus("Failed to enable on page", "error");
                }
            });
        }

        if (elements.enableSiteBtn) {
            elements.enableSiteBtn.addEventListener('click', async () => {
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url) {
                        const url = new URL(tab.url);
                        const siteUrl = `${url.protocol}//${url.host}`;
                        await chrome.runtime.sendMessage({ type: 'enableOnSite', url: siteUrl });
                        updateEnableDisableButtons(false, false);
                        showStatus("Enabled on this site", "success");
                        if (tab.id) {
                            chrome.tabs.reload(tab.id);
                        }
                    }
                } catch (error) {
                    console.error("Error enabling on site:", error);
                    showStatus("Failed to enable on site", "error");
                }
            });
        }
    }

    async function updateEnableDisableButtons(pageDisabled, siteDisabled) {
        if (elements.disablePageBtn) {
            elements.disablePageBtn.style.display = pageDisabled ? 'none' : 'block';
        }
        if (elements.enablePageBtn) {
            elements.enablePageBtn.style.display = pageDisabled ? 'block' : 'none';
        }
        if (elements.disableSiteBtn) {
            elements.disableSiteBtn.style.display = siteDisabled ? 'none' : 'block';
        }
        if (elements.enableSiteBtn) {
            elements.enableSiteBtn.style.display = siteDisabled ? 'block' : 'none';
        }
    }

    async function checkDisabledStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                const response = await chrome.runtime.sendMessage({ type: 'checkDisabled', url: tab.url });
                if (response) {
                    updateEnableDisableButtons(response.pageDisabled || false, response.siteDisabled || false);
                }
            }
        } catch (error) {
            console.debug("Could not check disabled status:", error);
        }
    }

    async function notifyContentScriptOfUpdate() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, { 
                    type: 'settingsUpdated', 
                    settings: settings 
                });
            }
        } catch (error) {
            console.warn("Could not notify content script of settings change.", error);
        }
    }

    function updateSelectionCount(count) {
        selectionCount = count;
        if (elements.selectionCount) {
            elements.selectionCount.textContent = `${count} selected`;
        }
        if (elements.copySelectedBtn) {
            elements.copySelectedBtn.disabled = count === 0;
        }
        if (elements.clearSelectionBtn) {
            elements.clearSelectionBtn.disabled = count === 0;
        }
        if (elements.selectionStatus) {
            elements.selectionStatus.style.display = count > 0 ? 'block' : 'none';
        }
    }

    // Export function removed for cleaner interface
    
    let statusTimeout;
    function showStatus(message, type = 'info') {
        clearTimeout(statusTimeout);
        if (elements.statusText) {
            elements.statusText.textContent = message;
        }
        if (elements.statusBar) {
            elements.statusBar.className = `status-bar ${type}`;
            elements.statusBar.classList.remove('hidden');
        }
        statusTimeout = setTimeout(() => {
            if (elements.statusBar) {
                elements.statusBar.classList.add('hidden');
            }
        }, 3000);
    }
    
    function truncate(text, length = 40) {
        return text.length > length ? text.substring(0, length) + '...' : text;
    }

    function formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            return `${Math.floor(diff / 60000)}m ago`;
        } else if (diff < 86400000) { // Less than 1 day
            return `${Math.floor(diff / 3600000)}h ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Message listener for background script communication
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'selectionUpdated':
                updateSelectionCount(message.count || 0);
                break;

            case 'statsUpdated':
                if (message.stats) {
                    stats = message.stats;
                    updateStatsDisplay(message.stats);
                }
                break;

            case 'historyUpdated':
                loadHistory();
                loadStats();
                break;
        }
        return true;
    });

    try {
        await loadSettings();
        await loadStats();
        await loadHistory();
        await checkDisabledStatus();
        setupEventListeners();
        checkSelectionCount();
    } catch (error) {
        console.error('Error initializing popup:', error);
        showStatus('Error initializing popup', 'error');
    }
    
    async function checkSelectionCount() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 1000)
                );
                const messagePromise = chrome.tabs.sendMessage(tab.id, {
                    type: 'getStats'
                });
                
                const response = await Promise.race([messagePromise, timeoutPromise]);
                if (response && response.success) {
                    updateSelectionCount(response.stats.selectedCount || 0);
                }
            }
        } catch (error) {
            updateSelectionCount(0);
        }
    }
});

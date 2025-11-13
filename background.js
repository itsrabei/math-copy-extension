const CONSTANTS = {
    MAX_HISTORY_ITEMS: 50,
    MAX_NOTIFICATION_DURATION: 5000,
    VALID_FORMATS: ['mathml', 'latex', 'unicode', 'asciimath']
};

const defaultSettings = {
    format: 'mathml',
    autoCopy: true,
    previewMode: false,
    validation: true,
    darkMode: false,
    multiSelection: true,
    clipboardHistory: true,
    showTooltips: true,
    keyboardShortcuts: true
};

let historyIdCounter = 0;

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') {
        onInstall();
    } else if (details.reason === 'update') {
        onUpdate(details.previousVersion);
    }
    setupContextMenu();
});

async function onInstall() {
    try {
        await chrome.storage.sync.set({ mathCopySettings: defaultSettings });
        await chrome.storage.local.set({ 
            mathCopyHistory: [],
            mathCopyStats: {
                totalCopies: 0,
                formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
                lastUsed: null
            }
        });
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-48.png',
            title: 'Math Copy Extension Installed',
            message: 'Click on any math equation to copy as MathML!'
        });
    } catch (error) {
        console.error('Installation failed:', error);
    }
}

async function onUpdate(previousVersion) {
    try {
        const result = await chrome.storage.sync.get('mathCopySettings');
        const settings = result.mathCopySettings || {};
        const migratedSettings = { ...defaultSettings, ...settings };
        if (migratedSettings.format !== 'mathml') {
            migratedSettings.format = 'mathml';
        }
        
        await chrome.storage.sync.set({ mathCopySettings: migratedSettings });
        const localResult = await chrome.storage.local.get('mathCopyStats');
        if (!localResult.mathCopyStats) {
            await chrome.storage.local.set({ 
                mathCopyStats: {
                    totalCopies: 0,
                    formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
                    lastUsed: null
                }
            });
        }
        
    } catch (error) {
        console.error('Update process failed:', error);
    }
}

function setupContextMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'copyMathML',
            title: 'Copy as MathML (for Word)',
            contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
            id: 'copyLaTeX',
            title: 'Copy as LaTeX',
            contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
            id: 'copyUnicode',
            title: 'Copy as Unicode',
            contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
            id: 'copyAsciiMath',
            title: 'Copy as AsciiMath',
            contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
            id: 'separator1',
            type: 'separator',
            contexts: ['page', 'selection']
        });
        chrome.contextMenus.create({
            id: 'openSettings',
            title: 'Open Math Copy Settings',
            contexts: ['page']
        });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) {
        console.warn('No valid tab for context menu action');
        return;
    }
    
    if (info.menuItemId === 'openSettings') {
        try {
            chrome.action.openPopup();
        } catch (error) {
            console.error('Failed to open popup:', error);
        }
        return;
    }
    
    const format = info.menuItemId.replace('copy', '').toLowerCase();
    if (!CONSTANTS.VALID_FORMATS.includes(format)) {
        console.error('Invalid format in context menu:', format);
        return;
    }
    
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (requestedFormat) => {
            try {
                const mathElement = document.querySelector('.math-copy-element, .MathJax, .katex, math');
                if (mathElement && typeof mathElement.click === 'function') {
                    window.mathCopyOverrideFormat = requestedFormat;
                    mathElement.click();
                    delete window.mathCopyOverrideFormat;
                } else {
                    console.warn('No math element found for context menu copy');
                    const notification = document.createElement('div');
                    notification.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: #F59E0B;
                        color: white;
                        padding: 12px 16px;
                        border-radius: 6px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-size: 14px;
                        z-index: 10000;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    `;
                    notification.textContent = 'No math equations found on this page';
                    document.body.appendChild(notification);
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 3000);
                }
            } catch (error) {
                console.error('Error in context menu script:', error);
            }
        },
        args: [format]
    }).catch(err => {
        console.error("Failed to inject context menu script:", err);
        chrome.tabs.get(tab.id, (tabInfo) => {
            if (tabInfo && tabInfo.url) {
                if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('chrome-extension://')) {
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon-48.png',
                        title: 'Math Copy Extension',
                        message: 'Cannot copy on restricted pages (chrome://, extension pages).'
                    });
                } else {
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon-48.png',
                        title: 'Math Copy Extension',
                        message: 'Unable to copy equation. Please refresh the page and try again.'
                    });
                }
            }
        });
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !message.type) {
        sendResponse({ 
            error: 'Invalid message format',
            success: false 
        });
        return false;
    }
    
    try {
        const messageHandlers = {
            getSettings: () => getSettings(),
            saveSettings: (msg) => {
                if (!msg.settings || typeof msg.settings !== 'object') {
                    throw new Error('Invalid settings object');
                }
                return saveSettings(msg.settings);
            },
            equationCopied: (msg) => {
                const data = msg.data || {
                    formula: msg.formula,
                    format: msg.format,
                    source: msg.source,
                    count: msg.count
                };
                
                if (!data || typeof data !== 'object') {
                    throw new Error('Invalid equation data');
                }
                
                if (!data.formula && !data.content) {
                    console.error('Invalid equation data: missing formula/content', data);
                    throw new Error('Invalid equation data: missing formula or content');
                }
                
                return addToHistory(data);
            },
            getHistory: async () => {
                const history = await getHistory();
                return history; // Return array directly
            },
            clearHistory: () => clearHistory(),
            validateMathML: (msg) => {
                if (!msg.mathml || typeof msg.mathml !== 'string') {
                    return { valid: false, error: 'Invalid MathML string' };
                }
                return { valid: validateMathML(msg.mathml) };
            },
            getStats: async () => {
                const stats = await getStats();
                return stats; // Return stats object directly
            },
            updateStats: (msg) => {
                if (!msg.stats || typeof msg.stats !== 'object') {
                    throw new Error('Invalid stats object');
                }
                return updateStats(msg.stats);
            },
            disableOnPage: (msg) => {
                if (!msg.url || typeof msg.url !== 'string') {
                    throw new Error('Invalid URL');
                }
                return disableOnPage(msg.url);
            },
            disableOnSite: (msg) => {
                if (!msg.url || typeof msg.url !== 'string') {
                    throw new Error('Invalid URL');
                }
                return disableOnSite(msg.url);
            },
            enableOnPage: (msg) => {
                if (!msg.url || typeof msg.url !== 'string') {
                    throw new Error('Invalid URL');
                }
                return enableOnPage(msg.url);
            },
            enableOnSite: (msg) => {
                if (!msg.url || typeof msg.url !== 'string') {
                    throw new Error('Invalid URL');
                }
                return enableOnSite(msg.url);
            },
            checkDisabled: (msg) => {
                if (!msg.url || typeof msg.url !== 'string') {
                    throw new Error('Invalid URL');
                }
                return checkDisabled(msg.url);
            },
            getBlockedSites: async () => {
                const result = await chrome.storage.local.get('disabledSites');
                return result.disabledSites || [];
            },
            getBlockedPages: async () => {
                const result = await chrome.storage.local.get('disabledPages');
                return result.disabledPages || [];
            }
        };

        const handler = messageHandlers[message.type];
        if (handler) {
            Promise.resolve(handler(message))
                .then(result => {
                    if (message.type === 'getHistory' || message.type === 'getStats') {
                        sendResponse(result);
                    } else {
                        sendResponse(result || { success: true });
                    }
                })
                .catch(error => {
                    console.error(`Error handling message ${message.type}:`, error);
                    console.error('Error details:', error.stack);
                    if (message.type === 'getHistory') {
                        sendResponse([]);
                    } else if (message.type === 'getStats') {
                        sendResponse({
                            totalCopies: 0,
                            formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
                            lastUsed: null
                        });
                    } else {
                        sendResponse({ 
                            error: error.message || 'Unknown error occurred',
                            success: false 
                        });
                    }
                });
            return true; // Keep the message channel open for async response
        } else {
            console.warn('Unknown message type:', message.type);
            sendResponse({ 
                error: `Unknown message type: ${message.type}`,
                success: false 
            });
            return false;
        }
    } catch (error) {
        console.error('Error in message listener:', error);
        sendResponse({ 
            error: 'Internal error in message handler',
            success: false 
        });
        return false;
    }
});

async function getSettings() {
    const result = await chrome.storage.sync.get('mathCopySettings');
    return { ...defaultSettings, ...result.mathCopySettings };
}

async function saveSettings(settings) {
    try {
        if (!settings || typeof settings !== 'object') {
            throw new Error('Invalid settings object');
        }
        
        if (!settings.format || !CONSTANTS.VALID_FORMATS.includes(settings.format)) {
            settings.format = 'mathml';
        }
        
        const validatedSettings = {
            ...defaultSettings,
            ...settings,
            format: settings.format,
            autoCopy: Boolean(settings.autoCopy),
            previewMode: Boolean(settings.previewMode),
            validation: Boolean(settings.validation),
            darkMode: Boolean(settings.darkMode),
            multiSelection: Boolean(settings.multiSelection),
            clipboardHistory: Boolean(settings.clipboardHistory),
            showTooltips: Boolean(settings.showTooltips),
            keyboardShortcuts: Boolean(settings.keyboardShortcuts)
        };
        
        await chrome.storage.sync.set({ mathCopySettings: validatedSettings });
        return { success: true };
    } catch (error) {
        console.error('Error saving settings:', error);
        return { 
            success: false, 
            error: error.message || 'Failed to save settings' 
        };
    }
}

async function addToHistory(data) {
    try {
        
        if (!data || typeof data !== 'object') {
            console.error('Invalid history data: data is not an object', data);
            throw new Error('Invalid history data');
        }
        
        const formula = data.formula || data.content;
        if (!formula || typeof formula !== 'string') {
            console.error('Invalid formula content: must be a string', { formula, type: typeof formula });
            throw new Error('Invalid formula content: must be a string');
        }
        
        const trimmedFormula = formula.trim();
        if (trimmedFormula.length === 0) {
            console.error('Invalid formula content: cannot be empty');
            throw new Error('Invalid formula content: cannot be empty');
        }
        
        if (trimmedFormula.length > 1000000) {
            console.error('Formula too large:', trimmedFormula.length);
            throw new Error('Formula too large (max 1MB)');
        }
        
        let format = data.format;
        if (!format || !CONSTANTS.VALID_FORMATS.includes(format)) {
            console.warn('Invalid or missing format, using default (mathml):', format);
            format = 'mathml';
        }
        
        let source = data.source || 'Unknown';
        if (typeof source !== 'string') {
            source = String(source);
        }
        source = source.slice(0, 100);
        
        console.log('Loading existing history from storage...');
        const result = await chrome.storage.local.get('mathCopyHistory');
        const history = Array.isArray(result.mathCopyHistory) ? result.mathCopyHistory : [];
        console.log('Current history has ' + history.length + ' items');
        
        // Create unique ID with counter to prevent race conditions
        const uniqueId = `${Date.now()}-${++historyIdCounter}`;
        
        const historyItem = {
            id: uniqueId,
            formula: trimmedFormula,
            format: format,
            source: source,
            timestamp: new Date().toISOString()
        };
        
        history.unshift(historyItem);
        const trimmedHistory = history.slice(0, CONSTANTS.MAX_HISTORY_ITEMS);
        console.log('Saving ' + trimmedHistory.length + ' items to storage (max: ' + CONSTANTS.MAX_HISTORY_ITEMS + ')');
        await chrome.storage.local.set({ mathCopyHistory: trimmedHistory });
        console.log('History saved successfully');
        
        try {
                    await updateStats({ format: format, action: 'copy' });
        } catch (statsError) {
            console.error('Failed to update stats:', statsError);
            console.error('Stats error stack:', statsError.stack);
        }
        
        try {
            chrome.runtime.sendMessage({ type: 'historyUpdated' }).catch((err) => {
                console.debug('Broadcast message failed (popup might not be open):', err);
            });
        } catch (e) {
            // Ignore broadcast errors
            console.debug('Broadcast message error (ignored):', e);
        }
        
        return { success: true };
    } catch (error) {
        console.error('Error adding to history:', error);
        console.error('Error stack:', error.stack);
        return { 
            success: false, 
            error: error.message || 'Failed to add to history' 
        };
    }
}

async function getHistory() {
    try {
        const result = await chrome.storage.local.get('mathCopyHistory');
        
        if (Array.isArray(result.mathCopyHistory)) {
            console.log('Found ' + result.mathCopyHistory.length + ' history items');
            const filteredHistory = result.mathCopyHistory.filter(item => {
                const isValid = item &&
                       typeof item === 'object' &&
                       item.formula &&
                       typeof item.formula === 'string' &&
                       item.formula.length > 0 &&
                       item.formula.length < 1000000; // Sanity check
                if (!isValid) {
                    console.warn('Invalid history item filtered out:', item);
                }
                return isValid;
            });
                return filteredHistory;
            }
            return [];
    } catch (error) {
        console.error('Error getting history:', error);
        console.error('Error stack:', error.stack);
        return [];
    }
}

async function clearHistory() {
    await chrome.storage.local.set({ mathCopyHistory: [] });
    try {
        chrome.runtime.sendMessage({ type: 'historyUpdated' });
    } catch (e) {
        // ignore
    }
    return { success: true };
}

async function getStats() {
    try {
        const result = await chrome.storage.local.get('mathCopyStats');
        
        const stats = result.mathCopyStats || {
            totalCopies: 0,
            formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
            lastUsed: null
        };
        
            return stats;
    } catch (error) {
        console.error('Error getting stats:', error);
        console.error('Error stack:', error.stack);
        return {
            totalCopies: 0,
            formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
            lastUsed: null
        };
    }
}

async function updateStats(stats) {
    try {
        
        const result = await chrome.storage.local.get('mathCopyStats');
        const currentStats = result.mathCopyStats || {
            totalCopies: 0,
            formatUsage: { mathml: 0, latex: 0, unicode: 0, asciimath: 0 },
            lastUsed: null
        };
        
        
        // Validate stats structure
        if (!currentStats.formatUsage || typeof currentStats.formatUsage !== 'object') {
            console.warn('Invalid formatUsage structure, resetting...');
            currentStats.formatUsage = { mathml: 0, latex: 0, unicode: 0, asciimath: 0 };
        }
        
        if (stats.action === 'copy' && stats.format) {
            // Validate format
            if (CONSTANTS.VALID_FORMATS.includes(stats.format)) {
                const oldTotal = currentStats.totalCopies || 0;
                const oldFormatCount = currentStats.formatUsage[stats.format] || 0;
                
                currentStats.totalCopies = (currentStats.totalCopies || 0) + 1;
                // Prevent integer overflow
                if (currentStats.totalCopies > Number.MAX_SAFE_INTEGER) {
                    currentStats.totalCopies = Number.MAX_SAFE_INTEGER;
                }
                currentStats.formatUsage[stats.format] = (currentStats.formatUsage[stats.format] || 0) + 1;
                // Prevent integer overflow for format usage
                if (currentStats.formatUsage[stats.format] > Number.MAX_SAFE_INTEGER) {
                    currentStats.formatUsage[stats.format] = Number.MAX_SAFE_INTEGER;
                }
                currentStats.lastUsed = new Date().toISOString();
                
            } else {
                console.warn('Invalid format in stats update:', stats.format);
            }
        } else if (stats.action === 'reset') {
            currentStats.totalCopies = 0;
            currentStats.formatUsage = { mathml: 0, latex: 0, unicode: 0, asciimath: 0 };
            currentStats.lastUsed = null;
        } else {
            console.warn('Unknown stats action:', stats.action);
        }
        
        await chrome.storage.local.set({ mathCopyStats: currentStats });
        
        // Broadcast updates (non-blocking)
        try {
            chrome.runtime.sendMessage({ type: 'statsUpdated', stats: currentStats }).catch((err) => {
                // Ignore if no listeners
                console.debug('Broadcast message failed (popup might not be open):', err);
            });
        } catch (e) {
            // Ignore broadcast errors
            console.debug('Broadcast message error (ignored):', e);
        }
        
        return { success: true };
    } catch (error) {
        console.error('Error updating stats:', error);
        console.error('Error stack:', error.stack);
        return { success: false, error: error.message };
    }
}

function validateMathML(mathml) {
    try {
        if (!mathml || typeof mathml !== 'string') {
            return false;
        }
        
        // Basic length check
        if (mathml.length === 0 || mathml.length > 1000000) {
            return false;
        }
        
        // Check for math tag
        if (!mathml.includes('<math')) {
            return false;
        }
        
        // Check for namespace (important for Word compatibility)
        const hasNamespace = mathml.includes('xmlns="http://www.w3.org/1998/Math/MathML"') ||
                            mathml.includes("xmlns='http://www.w3.org/1998/Math/MathML'");
        
        // Check for closing tag
        const hasClosingTag = mathml.includes('</math>');
        
        // Basic structure validation
        const openCount = (mathml.match(/<math/g) || []).length;
        const closeCount = (mathml.match(/<\/math>/g) || []).length;
        
        return hasClosingTag && hasNamespace && openCount === closeCount;
    } catch (error) {
        console.error('Error validating MathML:', error);
        return false;
    }
}

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command === 'toggle-format') {
        const settings = await getSettings();
        const formats = ['mathml', 'latex', 'unicode', 'asciimath'];
        const currentIndex = formats.indexOf(settings.format);
        settings.format = formats[(currentIndex + 1) % formats.length];
        await saveSettings(settings);

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-48.png',
            title: 'Format Changed',
            message: `Now copying as ${settings.format.toUpperCase()}`
        });
    } else if (command === 'copy-math' && tab.id) {
        // Copy first math equation on the page
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const mathElement = document.querySelector('.math-copy-element, .MathJax, .katex, math');
                if (mathElement) {
                    mathElement.click();
                }
            }
        }).catch(err => console.error("Failed to execute copy command:", err));
    } else if (command === 'copy-selected') {
        try {
            const activeTabId = tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            if (activeTabId) {
                await chrome.tabs.sendMessage(activeTabId, { type: 'copySelected' });
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Math Copy',
                    message: 'Copying selected equations...'
                });
            }
        } catch (err) {
            console.error('Failed to trigger copy-selected:', err);
        }
    } else if (command === 'clear-selection') {
        try {
            const activeTabId = tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
            if (activeTabId) {
                await chrome.tabs.sendMessage(activeTabId, { type: 'clearSelection' });
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon-48.png',
                    title: 'Math Copy',
                    message: 'Selection cleared'
                });
            }
        } catch (err) {
            console.error('Failed to trigger clear-selection:', err);
        }
    }
});

// --- Error Handling and Logging ---

chrome.runtime.onStartup.addListener(() => {
    console.log('Math Copy Extension started');
});

chrome.runtime.onSuspend.addListener(() => {
});

async function disableOnPage(url) {
    try {
        const result = await chrome.storage.local.get('disabledPages');
        const disabledPages = result.disabledPages || [];
        if (!disabledPages.includes(url)) {
            disabledPages.push(url);
            await chrome.storage.local.set({ disabledPages });
        }
        return { success: true };
    } catch (error) {
        console.error('Error disabling on page:', error);
        return { success: false, error: error.message };
    }
}

async function disableOnSite(siteUrl) {
    try {
        const result = await chrome.storage.local.get('disabledSites');
        const disabledSites = result.disabledSites || [];
        if (!disabledSites.includes(siteUrl)) {
            disabledSites.push(siteUrl);
            await chrome.storage.local.set({ disabledSites });
        }
        return { success: true };
    } catch (error) {
        console.error('Error disabling on site:', error);
        return { success: false, error: error.message };
    }
}

async function enableOnPage(url) {
    try {
        const result = await chrome.storage.local.get('disabledPages');
        const disabledPages = result.disabledPages || [];
        const filtered = disabledPages.filter(u => u !== url);
        await chrome.storage.local.set({ disabledPages: filtered });
        return { success: true };
    } catch (error) {
        console.error('Error enabling on page:', error);
        return { success: false, error: error.message };
    }
}

async function enableOnSite(siteUrl) {
    try {
        const result = await chrome.storage.local.get('disabledSites');
        const disabledSites = result.disabledSites || [];
        const filtered = disabledSites.filter(u => u !== siteUrl);
        await chrome.storage.local.set({ disabledSites: filtered });
        return { success: true };
    } catch (error) {
        console.error('Error enabling on site:', error);
        return { success: false, error: error.message };
    }
}

async function checkDisabled(url) {
    try {
        const result = await chrome.storage.local.get(['disabledPages', 'disabledSites']);
        const disabledPages = result.disabledPages || [];
        const disabledSites = result.disabledSites || [];
        
        const pageDisabled = disabledPages.includes(url);
        const urlObj = new URL(url);
        const siteUrl = `${urlObj.protocol}//${urlObj.host}`;
        const siteDisabled = disabledSites.includes(siteUrl);
        
        return { pageDisabled, siteDisabled };
    } catch (error) {
        console.error('Error checking disabled status:', error);
        return { pageDisabled: false, siteDisabled: false };
    }
}

self.addEventListener('error', (event) => {
    console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

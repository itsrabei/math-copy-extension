(function() {
    'use strict';

    const CONFIG = {
        INITIAL_DELAY: 2000,
        OBSERVER_THROTTLE: 100,
        TOOLTIP_HIDE_DELAY: 200,
        SUCCESS_FEEDBACK_DURATION: 1500,
        ERROR_FEEDBACK_DURATION: 1500,
        BATCH_SIZE: 10,
        MAX_CLIPBOARD_HISTORY: 20,
        MAX_RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000,
        selectorPatterns: {
            katex: ['.katex-html', '.katex-mathml', '.katex', '.katex-display', '.katex > *'],
            mathjax: ['.MathJax', '.mjx-chtml', '.mjx-math', '.MathJax_Display', '.mjx-container', '.MathJax > *'],
            mathml: ['math', 'math *'],
            generic: ['.math', '.equation', '[data-math]', '.formula', '[class*="math"]', '[class*="equation"]', '[class*="formula"]']
        },
        defaultFormat: 'mathml',
        validFormats: ['mathml', 'latex', 'unicode', 'asciimath']
    };

    const Logger = {
        levels: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
        currentLevel: 1,
        
        debug: function(msg, ...args) {
            if (this.currentLevel <= this.levels.DEBUG) {
                console.log(`[DEBUG] ${msg}`, ...args);
            }
        },
        
        info: function(msg, ...args) {
            if (this.currentLevel <= this.levels.INFO) {
                console.log(`[INFO] ${msg}`, ...args);
            }
        },
        
        warn: function(msg, ...args) {
            if (this.currentLevel <= this.levels.WARN) {
                console.warn(`[WARN] ${msg}`, ...args);
            }
        },
        
        error: function(msg, ...args) {
            if (this.currentLevel <= this.levels.ERROR) {
                console.error(`[ERROR] ${msg}`, ...args);
            }
        }
    };

    class ExtensionError extends Error {
        constructor(message, code, severity = 'MEDIUM') {
            super(message);
            this.name = 'ExtensionError';
            this.code = code;
            this.severity = severity;
            this.timestamp = Date.now();
        }
    }

    let state = {
        selectedEquations: new Set(),
        isShiftPressed: false,
        currentFormat: 'mathml',
        settings: {},
        processedElements: new WeakSet(),
        clipboardHistory: [],
        isInitialized: false,
        throttleTimeout: null,
        equationHandlers: new WeakMap(),
        errorCount: 0,
        maxErrors: 10,
        initializationAttempts: 0,
        maxInitAttempts: 3,
        contextMenu: null,
        mutationObserver: null
    };

    class TooltipManager {
        constructor() {
            this.tooltip = null;
            this.activeWrapper = null;
            this.hideTimeout = null;
        }

        createTooltip() {
            if (!this.tooltip) {
                this.tooltip = document.createElement('div');
                this.tooltip.className = 'math-copy-tooltip';
                this.tooltip.setAttribute('aria-hidden', 'true');
                this.tooltip.innerHTML = `
                    <div class="tooltip-content">Click to copy</div>
                    <div class="tooltip-arrow"></div>
                `;
                document.body.appendChild(this.tooltip);

                window.addEventListener('wheel', () => this.hide(), { passive: true });
                window.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') this.hide();
                });
                document.addEventListener('click', (e) => {
                    if (!e.target.closest('.math-copy-element')) {
                        this.hide();
                    }
                });
            }
            return this.tooltip;
        }

        show(wrapper, text = 'Click to copy') {
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }

            const tooltip = this.createTooltip();

            if (this.activeWrapper && this.activeWrapper !== wrapper) {
                this.hide();
            }

            this.activeWrapper = wrapper;

            const content = tooltip.querySelector('.tooltip-content');
            if (content) {
                content.textContent = text;
            }

            this.positionTooltip(wrapper, tooltip);
            tooltip.style.display = 'block';
            tooltip.setAttribute('aria-hidden', 'false');
        }

        positionTooltip(wrapper, tooltip) {
            const rect = wrapper.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            let top = rect.bottom + window.scrollY + 8;
            let left = rect.left + window.scrollX + (rect.width - tooltipRect.width) / 2;

            // Keep in viewport
            if (left + tooltipRect.width > window.innerWidth) {
                left = window.innerWidth - tooltipRect.width - 8;
            }
            if (left < 8) {
                left = 8;
            }

            if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
                top = rect.top + window.scrollY - tooltipRect.height - 8;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        }

        updateContent(text) {
            if (this.tooltip) {
                const content = this.tooltip.querySelector('.tooltip-content');
                if (content) {
                    content.textContent = text;
                }
            }
        }

        hide() {
            if (this.tooltip) {
                this.tooltip.style.display = 'none';
                this.tooltip.setAttribute('aria-hidden', 'true');
            }

            if (this.activeWrapper) {
                this.activeWrapper.classList.remove('math-copy-hover');
                this.activeWrapper.classList.remove('math-copy-success', 'math-copy-error', 'math-copy-copying');
                this.activeWrapper = null;
            }

            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        }

        scheduleHide(delay = CONFIG.TOOLTIP_HIDE_DELAY) {
            this.hideTimeout = setTimeout(() => this.hide(), delay);
        }

        cleanup() {
            if (this.tooltip && this.tooltip.parentNode) {
                this.tooltip.parentNode.removeChild(this.tooltip);
            }
            this.tooltip = null;
            this.activeWrapper = null;
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        }
    }

    const tooltipManager = new TooltipManager();

    class EquationProcessor {
        static async getEquationContent(equation, format = state.currentFormat) {
            try {
                if (!equation || !equation.nodeType) {
                    throw new ExtensionError('Invalid equation element', 'INVALID_ELEMENT', 'HIGH');
                }

                if (!CONFIG.validFormats.includes(format)) {
                    Logger.warn('Invalid format, using default:', format);
                    format = CONFIG.defaultFormat;
                }

                let content = null;
                let katexContainer = null;
                if (equation.classList && equation.classList.contains('katex')) {
                    katexContainer = equation;
                } else {
                    katexContainer = equation.closest('.katex[data-katex-processed]');
                    if (!katexContainer) {
                        katexContainer = equation.closest('.katex');
                    }
                }
                
                if (katexContainer) {
                    content = this.extractFromKaTeX(katexContainer, format);
                } else if (equation.closest('.MathJax') || equation.closest('.mjx-chtml') || equation.closest('.mjx-container')) {
                    content = this.extractFromMathJax(equation, format);
                } else if (equation.closest('math') || equation.tagName === 'MATH') {
                    content = this.extractFromMathML(equation, format);
                } else if (equation.closest('[data-math]') || equation.hasAttribute('data-math')) {
                    content = this.extractFromDataAttribute(equation, format);
                } else {
                    content = this.extractGeneric(equation);
                }

                // If no content found, try fallback methods
                if (!content) {
                    content = this.convertToUnicode(equation);
                }

                if (!content && format === 'mathml') {
                    const anyMath = equation.querySelector('math') || equation.closest('math');
                    if (anyMath) {
                        let mathml = this.ensureMathMLNamespace(anyMath.outerHTML);
                        // Clean spacing elements that Word interprets as visible spaces
                        mathml = this.cleanMathMLSpacing(mathml);
                        content = mathml;
                    }
                }

                // Validate content before returning
                if (content && typeof content === 'string' && content.trim().length > 0) {
                    // Sanitize content to prevent XSS
                    const sanitized = content.trim();
                    if (sanitized.length > 100000) { // Prevent extremely large content
                        throw new ExtensionError('Equation content too large', 'CONTENT_TOO_LARGE', 'MEDIUM');
                    }
                    return sanitized;
                }

                Logger.debug('No content extracted from equation');
                return null;
            } catch (error) {
                if (error instanceof ExtensionError) {
                    Logger.error('Extension error extracting equation:', error.message, error.code);
                } else {
                    Logger.error('Error extracting equation:', error);
                }
                state.errorCount++;
                if (state.errorCount > state.maxErrors) {
                    Logger.error('Too many errors, stopping equation extraction');
                    return null;
                }
                return null;
            }
        }

        static extractFromKaTeX(element, format) {
            const container = element;
            
            if (!container || !container.classList || !container.classList.contains('katex')) {
                Logger.warn('Invalid .katex container provided to extractFromKaTeX');
                return null;
            }

            try {
                switch (format) {
                    case 'latex':
                        // Try annotation first (most reliable for LaTeX)
                        // Same as Similar Version: equation.closest('.katex').querySelector('annotation')
                        // Since container is already the .katex element, just query within it
                        const annotation = container.querySelector('annotation');
                        if (annotation) {
                            // Use innerHTML like Similar Version (in case annotation contains HTML entities)
                            const annotationText = annotation.innerHTML || annotation.textContent || annotation.innerText;
                            if (annotationText && annotationText.trim()) {
                                return this.cleanLatex(annotationText);
                            }
                        }

                        // Try data attributes on the container itself
                        const latex = container.getAttribute('data-latex') || 
                                    container.getAttribute('data-tex') ||
                                    container.getAttribute('data-original');
                        if (latex && latex.trim()) {
                            return this.cleanLatex(latex);
                        }

                        // Don't fallback to text content for LaTeX - that would give rendered output
                        // If no LaTeX source found, return null
                        Logger.debug('No LaTeX source found in KaTeX container');
                        return null;

                    case 'mathml':
                        // Same approach as Similar Version: equation.closest('.katex').querySelector('.katex-mathml math')
                        // Since container is already the .katex element, query within it
                        const katexMathml = container.querySelector('.katex-mathml');
                        let mathml = katexMathml ? katexMathml.querySelector('math') : null;
                        
                        // If not found in .katex-mathml, try direct math element in container
                        if (!mathml) {
                            mathml = container.querySelector('math');
                        }
                        
                        if (!mathml) {
                            Logger.debug('No MathML element found in KaTeX container');
                            return null;
                        }
                        
                        // Get the outerHTML directly (like Similar Version)
                        // This preserves all attributes including display mode
                        let mathmlString = mathml.outerHTML;
                        
                        // Clean up spacing elements that Word interprets as visible spaces
                        mathmlString = this.cleanMathMLSpacing(mathmlString);
                        
                        // Only ensure namespace is present
                        // Don't modify anything else - preserve all attributes for Word compatibility
                        if (!mathmlString.includes('xmlns=')) {
                            mathmlString = mathmlString.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
                        }
                        
                        return mathmlString;

                    case 'unicode':
                    default:
                        // Use the stored .katex-html element if available, otherwise search in container
                        const htmlElement = container._katexHtmlElement || container.querySelector('.katex-html');
                        if (htmlElement) {
                            return this.extractTextContent(htmlElement);
                        }
                        return null;
                }
            } catch (error) {
                Logger.error('KaTeX extraction error:', error);
                return null;
            }
        }

        static extractFromMathJax(element, format) {
            const container = element.closest('.MathJax') || element.closest('.mjx-chtml') || element.closest('.mjx-container');
            if (!container) return null;

            try {
                // First, try to get original LaTeX from MathJax API (most reliable)
                const originalLatex = this.getMathJaxOriginalSource(container);
                
                switch (format) {
                    case 'latex':
                        // Prefer original LaTeX from MathJax API
                        if (originalLatex) {
                            return this.cleanLatex(originalLatex);
                        }
                        
                        // Fallback: Try data attributes (some pages store it here)
                        const latex = container.getAttribute('data-latex') ||
                                     container.getAttribute('data-tex') ||
                                     container.getAttribute('data-original') ||
                                     container.getAttribute('data-mjx-latex') ||
                                     container.getAttribute('data-original-text');
                        if (latex) {
                            return this.cleanLatex(latex);
                        }
                        
                        // Last resort: Extract from rendered text (lossy but better than nothing)
                        Logger.warn('Could not find original LaTeX source for MathJax equation, using rendered text');
                        return this.extractTextContent(container);

                    case 'mathml':
                        // Try to get MathML directly from MathJax rendered output
                        let mathml = container.querySelector('math');
                        
                        // MathJax v3 uses mjx-container > mjx-chtml > math structure
                        if (!mathml) {
                            mathml = container.querySelector('mjx-chtml math') ||
                                    container.querySelector('.mjx-chtml math') ||
                                    container.querySelector('mjx-container math');
                        }
                        
                        // MathJax v2 uses different structure
                        if (!mathml) {
                            mathml = container.querySelector('.MathJax_SVG math') ||
                                    container.querySelector('.MathJax_Display math') ||
                                    container.querySelector('svg math');
                        }
                        
                        // Try to find any math element within container
                        if (!mathml) {
                            const mathElements = container.querySelectorAll('math');
                            if (mathElements.length > 0) {
                                mathml = mathElements[0];
                            }
                        }
                        
                        if (!mathml) {
                            // If no MathML found but we have LaTeX, try to convert
                            if (originalLatex) {
                                Logger.debug('No MathML found, attempting LaTeX to MathML conversion');
                                const converted = this.convertLatexToMathML(originalLatex);
                                if (converted) {
                                    let cleaned = this.cleanMathMLSpacing(converted);
                                    cleaned = this.ensureMathMLNamespace(cleaned);
                                    return cleaned;
                                }
                            }
                            return null;
                        }
                        
                        // Get the outerHTML directly
                        let mathmlString = mathml.outerHTML;
                        
                        // Clean up spacing elements that Word interprets as visible spaces
                        mathmlString = this.cleanMathMLSpacing(mathmlString);
                        
                        // Only ensure namespace is present
                        if (!mathmlString.includes('xmlns=')) {
                            mathmlString = mathmlString.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
                        }
                        
                        return mathmlString;

                    case 'unicode':
                    default:
                        return this.extractTextContent(container);
                }
            } catch (error) {
                Logger.error('MathJax extraction error:', error);
                return null;
            }
        }

        /**
         * Get original LaTeX source from MathJax API
         * Supports both MathJax v2 and v3
         */
        static getMathJaxOriginalSource(element) {
            try {
                // Check if MathJax v3 is available
                if (typeof window.MathJax !== 'undefined' && window.MathJax.startup) {
                    return this.getMathJaxV3Source(element);
                }
                
                // Check if MathJax v2 is available
                if (typeof window.MathJax !== 'undefined' && window.MathJax.Hub) {
                    return this.getMathJaxV2Source(element);
                }
                
                // MathJax not loaded or element not associated with MathJax
                return null;
            } catch (error) {
                Logger.warn('Error accessing MathJax API:', error);
                return null;
            }
        }

        /**
         * Get original LaTeX source from MathJax v3
         */
        static getMathJaxV3Source(element) {
            try {
                // MathJax v3 stores source in data-mjx-alt attribute or in MathItem
                const altText = element.getAttribute('data-mjx-alt') || 
                               element.getAttribute('data-mjx-latex');
                if (altText) {
                    return altText;
                }
                
                // Try to find the MathItem associated with this element
                if (window.MathJax.startup && window.MathJax.startup.document) {
                    const mathItems = window.MathJax.startup.document.getMathItemsWithin(element);
                    if (mathItems && mathItems.length > 0) {
                        // Get the first MathItem (closest match)
                        const mathItem = mathItems[0];
                        if (mathItem && mathItem.math) {
                            return mathItem.math;
                        }
                    }
                }
                
                // Try parent elements (MathJax wraps content)
                let parent = element.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                    const parentAlt = parent.getAttribute('data-mjx-alt') || 
                                     parent.getAttribute('data-mjx-latex');
                    if (parentAlt) {
                        return parentAlt;
                    }
                    parent = parent.parentElement;
                }
                
                return null;
            } catch (error) {
                Logger.warn('Error getting MathJax v3 source:', error);
                return null;
            }
        }

        /**
         * Get original LaTeX source from MathJax v2
         */
        static getMathJaxV2Source(element) {
            try {
                // MathJax v2 stores original text in the Jax object
                // We need to find the Jax associated with this element
                if (window.MathJax.Hub && window.MathJax.Hub.getAllJax) {
                    const allJax = window.MathJax.Hub.getAllJax();
                    
                    // Find the Jax that corresponds to this element
                    for (const jax of allJax) {
                        if (!jax.SourceElement()) continue;
                        
                        // Check if this element is within the Jax's source element
                        const sourceElement = jax.SourceElement();
                        if (sourceElement && (sourceElement === element || sourceElement.contains(element) || element.contains(sourceElement))) {
                            // Get the original text
                            if (jax.originalText) {
                                return jax.originalText;
                            }
                            
                            // Alternative: get from input jax
                            if (jax.inputID) {
                                const inputElement = document.getElementById(jax.inputID);
                                if (inputElement) {
                                    return inputElement.textContent || inputElement.innerText;
                                }
                            }
                        }
                    }
                }
                
                // Fallback: Try to find script tag with type="math/tex" or "math/tex; mode=display"
                let parent = element;
                for (let i = 0; i < 5 && parent; i++) {
                    // MathJax v2 often wraps content, look for script tags
                    const script = parent.querySelector('script[type="math/tex"], script[type="math/tex; mode=display"]');
                    if (script) {
                        return script.textContent || script.innerText;
                    }
                    
                    // Check if parent has data-original-text (some custom implementations)
                    const originalText = parent.getAttribute('data-original-text') ||
                                        parent.getAttribute('data-latex') ||
                                        parent.getAttribute('data-tex');
                    if (originalText) {
                        return originalText;
                    }
                    
                    parent = parent.parentElement;
                }
                
                return null;
            } catch (error) {
                Logger.warn('Error getting MathJax v2 source:', error);
                return null;
            }
        }

        static extractFromMathML(element, format) {
            const mathElement = element.tagName === 'MATH' ? element : element.closest('math');
            if (!mathElement) return null;

            try {
                switch (format) {
                    case 'mathml':
                        // Get outerHTML directly and ensure namespace
                        let mathmlString = mathElement.outerHTML;
                        
                        // Clean up spacing elements that Word interprets as visible spaces
                        mathmlString = this.cleanMathMLSpacing(mathmlString);
                        
                        if (!mathmlString.includes('xmlns=')) {
                            mathmlString = mathmlString.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
                        }
                        return mathmlString;

                    case 'latex':
                    case 'unicode':
                    default:
                        return this.extractTextContent(mathElement);
                }
            } catch (error) {
                Logger.error('MathML extraction error:', error);
                return null;
            }
        }

        static extractFromDataAttribute(element, format) {
            const dataMath = element.getAttribute('data-math') || element.closest('[data-math]')?.getAttribute('data-math');
            if (!dataMath) return null;

            try {
                switch (format) {
                    case 'latex':
                        return this.cleanLatex(dataMath);
                    case 'mathml':
                        // Only attempt LaTeX->MathML if this looks like LaTeX
                        if (/\\[a-zA-Z]+|\$.*\$/.test(dataMath)) {
                            let mathml = this.convertLatexToMathML(dataMath);
                            // Clean spacing if conversion succeeded
                            if (mathml) {
                                mathml = this.cleanMathMLSpacing(mathml);
                            }
                            return mathml;
                        }
                        // Already MathML? ensure namespace and clean spacing
                        if (dataMath.trim().startsWith('<math')) {
                            let mathml = this.ensureMathMLNamespace(dataMath.trim());
                            // Clean spacing elements that Word interprets as visible spaces
                            mathml = this.cleanMathMLSpacing(mathml);
                            return mathml;
                        }
                        return null;
                    case 'unicode':
                    default:
                        return dataMath;
                }
            } catch (error) {
                Logger.warn('Error processing data-math attribute:', error);
                return dataMath;
            }
        }

        static extractGeneric(element) {
            const text = element.textContent || '';
            // Enhanced pattern matching for mathematical content
            const mathPattern = /[+\-*/=<>≤≥≈∫∑∏√∂∆∇∞±×÷∈∉⊂⊃∪∩∀∃αβγδεζηθικλμνξοπρστυφχψω]/;
            return mathPattern.test(text) ? text : null;
        }

        static convertToUnicode(element) {
            return this.extractTextContent(element);
        }

        static extractTextContent(element) {
            if (!element) return null;

            let text = '';
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
                null,
                false
            );

            let node;
            while (node = walker.nextNode()) {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const nodeName = node.nodeName.toLowerCase();
                    if (nodeName === 'sup') {
                        text += this.toSuperscript(node.textContent);
                    } else if (nodeName === 'sub') {
                        text += this.toSubscript(node.textContent);
                    }
                }
            }

            return text.trim();
        }

        static toSuperscript(text) {
            const map = {
                '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵',
                '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
                '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ'
            };
            return text.split('').map(char => map[char] || char).join('');
        }

        static toSubscript(text) {
            const map = {
                '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅',
                '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋',
                '=': '₌', '(': '₍', ')': '₎'
            };
            return text.split('').map(char => map[char] || char).join('');
        }

        static cleanLatex(latex) {
            return latex.replace(/^\$|\$$/, '').trim();
        }

        static ensureMathMLNamespace(mathml) {
            if (typeof mathml !== 'string') return null;
            let out = mathml.trim();
            
            // Only ensure namespace is present - don't remove other attributes
            // Attributes like display, mathvariant are needed for proper rendering in Word
            if (!out.includes('xmlns=')) {
                // Check if it's already a math element
                if (out.startsWith('<math')) {
                    out = out.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
                } else {
                    // Wrap in math tags with namespace
                    out = `<math xmlns="http://www.w3.org/1998/Math/MathML">${out}</math>`;
                }
            }
            
            return out;
        }

        static cleanMathMLSpacing(mathmlString) {
            if (typeof mathmlString !== 'string') return mathmlString;
            
            let cleaned = mathmlString;
            
            // Remove ALL <mspace/> elements - they often cause Word to add unwanted visible spaces
            // Word interprets these spacing elements as requiring visible spaces in text conversion
            cleaned = cleaned.replace(/<mspace[^>]*\/?>/gi, '');
            
            // Remove <mtext> elements that contain only whitespace or invisible characters
            // These can cause Word to insert spaces when converting to text
            cleaned = cleaned.replace(/<mtext[^>]*>[\s\u200B-\u200D\uFEFF\u2009\u200A]*<\/mtext>/gi, '');
            
            // Remove invisible spacing characters that Word interprets as visible spaces
            // U+200B (zero-width space), U+200C (zero-width non-joiner), U+200D (zero-width joiner),
            // U+FEFF (zero-width no-break space), U+2009 (thin space), U+200A (hair space)
            cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u2009\u200A]/g, '');
            
            // Remove <mpadded> elements with zero or very small widths that might cause spacing issues
            cleaned = cleaned.replace(/<mpadded[^>]*width\s*=\s*["']0[^"']*["'][^>]*>/gi, '');
            cleaned = cleaned.replace(/<mpadded[^>]*width\s*=\s*["']([0-9.]+)em["'][^>]*>/gi, (match, width) => {
                const widthValue = parseFloat(width);
                // Remove if width is very small (less than 0.05em) - Word might render these as visible spaces
                if (widthValue < 0.05) {
                    return '';
                }
                return match;
            });
            
            // Clean up whitespace in text content of <mo> (operator) elements
            // Operators like ∫ and ∑ should not have trailing spaces that Word converts to visible spaces
            cleaned = cleaned.replace(/(<mo[^>]*>)([^<]+)(<\/mo>)/gi, (match, openTag, content, closeTag) => {
                // Remove leading and trailing whitespace from operator content
                const trimmed = content.trim();
                // Also remove any invisible spacing characters
                const cleanedContent = trimmed.replace(/[\u200B-\u200D\uFEFF\u2009\u200A]/g, '');
                return openTag + cleanedContent + closeTag;
            });
            
            // Remove ALL whitespace and spacing characters between MathML elements
            // Word interprets whitespace between elements as requiring visible spaces in text conversion
            // This is the main cause of unwanted spaces after operators like ∫ and ∑
            // Remove spaces, tabs, carriage returns, and all invisible spacing characters between tags
            cleaned = cleaned.replace(/>[ \t\r\n\u200B-\u200D\uFEFF\u2009\u200A]+</g, '><');
            
            // Special handling: remove spaces immediately after closing operator tags
            // This specifically targets the issue where Word adds spaces after ∫ and ∑
            // Pattern: </mo> followed by any whitespace/spacing chars followed by opening tag
            cleaned = cleaned.replace(/<\/mo>[ \t\r\n\u200B-\u200D\uFEFF\u2009\u200A]*</g, '</mo><');
            
            // Also remove spaces after other mathematical elements that shouldn't have trailing spaces
            // Remove spaces after closing tags of: operators, identifiers, numbers, fractions, etc.
            cleaned = cleaned.replace(/(<\/mo>|<\/mi>|<\/mn>|<\/mfrac>|<\/msup>|<\/msub>|<\/munder>|<\/mover>|<\/mrow>)[ \t\r\n\u200B-\u200D\uFEFF\u2009\u200A]*</g, '$1<');
            
            return cleaned;
        }

        static convertLatexToMathML(latex) {
            // Basic LaTeX to MathML conversion for common patterns
            // This is a simplified converter - for production, consider using a proper library
            try {
                let mathml = latex;
                
                // Common LaTeX patterns
                mathml = mathml.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '<mfrac><mrow>$1</mrow><mrow>$2</mrow></mfrac>');
                mathml = mathml.replace(/\\sqrt\{([^}]+)\}/g, '<msqrt><mrow>$1</mrow></msqrt>');
                mathml = mathml.replace(/\\sum/g, '<mo>∑</mo>');
                mathml = mathml.replace(/\\int/g, '<mo>∫</mo>');
                mathml = mathml.replace(/\\infty/g, '<mo>∞</mo>');
                mathml = mathml.replace(/\\alpha/g, '<mi>α</mi>');
                mathml = mathml.replace(/\\beta/g, '<mi>β</mi>');
                mathml = mathml.replace(/\\gamma/g, '<mi>γ</mi>');
                mathml = mathml.replace(/\\pi/g, '<mi>π</mi>');
                mathml = mathml.replace(/\\theta/g, '<mi>θ</mi>');
                mathml = mathml.replace(/\\lambda/g, '<mi>λ</mi>');
                mathml = mathml.replace(/\\mu/g, '<mi>μ</mi>');
                mathml = mathml.replace(/\\sigma/g, '<mi>σ</mi>');
                mathml = mathml.replace(/\\phi/g, '<mi>φ</mi>');
                mathml = mathml.replace(/\\omega/g, '<mi>ω</mi>');
                
                // Wrap in math tags if not already present
                if (!mathml.includes('<math')) {
                    mathml = `<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow>${mathml}</mrow></math>`;
                }
                
                return this.ensureMathMLNamespace(mathml);
            } catch (error) {
                Logger.warn('Error converting LaTeX to MathML:', error);
                return null;
            }
        }
    }

    /**
     * Enhanced DOM Processor
     */
    class DOMProcessor {
        static initialize() {
            if (state.initializationAttempts >= state.maxInitAttempts) {
                Logger.error('Max initialization attempts reached, aborting');
                return;
            }

            state.initializationAttempts++;
            Logger.info('Initializing Math Copy Extension...');
            Logger.debug('Waiting', CONFIG.INITIAL_DELAY, 'ms for page to load...');

            // Wait for page to load, then wait for MathJax if present
            setTimeout(() => {
                this.waitForMathJaxAndInitialize();
            }, CONFIG.INITIAL_DELAY);
        }

        static async waitForMathJaxAndInitialize() {
            try {
                // Check if MathJax is present on the page
                const hasMathJaxV3 = typeof window.MathJax !== 'undefined' && window.MathJax.startup;
                const hasMathJaxV2 = typeof window.MathJax !== 'undefined' && window.MathJax.Hub;
                
                if (hasMathJaxV3) {
                    Logger.info('MathJax v3 detected, waiting for typeset to complete...');
                    try {
                        // Wait for MathJax v3 to finish typesetting
                        if (window.MathJax.typesetPromise) {
                            await window.MathJax.typesetPromise();
                        }
                        // Also wait a bit for DOM to update
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        Logger.warn('Error waiting for MathJax v3 typeset:', error);
                    }
                } else if (hasMathJaxV2) {
                    Logger.info('MathJax v2 detected, waiting for queue to complete...');
                    try {
                        // Wait for MathJax v2 queue to finish
                        await new Promise((resolve) => {
                            if (window.MathJax.Hub && window.MathJax.Hub.Queue) {
                                window.MathJax.Hub.Queue(() => {
                                    resolve();
                                });
                            } else {
                                // Fallback: just wait
                                setTimeout(resolve, 1000);
                            }
                        });
                        // Additional wait for DOM updates
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        Logger.warn('Error waiting for MathJax v2 queue:', error);
                    }
                } else {
                    Logger.debug('No MathJax detected, proceeding with standard initialization');
                    // Standard delay for pages without MathJax
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                Logger.info('Starting equation processing...');
                this.processExistingEquations();
                this.setupMutationObserver();
                this.setupGlobalEventListeners();
                state.isInitialized = true;
                Logger.info('Math Copy Extension initialized successfully');
                
                // Retry after delay for late-loading equations (including MathJax)
                setTimeout(() => {
                    if (state.isInitialized) {
                        Logger.debug('Retrying equation detection for late-loading content...');
                        this.processExistingEquations();
                    }
                }, 3000);
                
                // Final retry for very late-loading content
                setTimeout(() => {
                    if (state.isInitialized) {
                        Logger.debug('Final retry for equation detection...');
                        this.processExistingEquations();
                    }
                }, 6000);
            } catch (error) {
                Logger.error('Error during initialization:', error);
                state.errorCount++;
                // Still try to initialize even if MathJax detection fails
                try {
                    this.processExistingEquations();
                    this.setupMutationObserver();
                    this.setupGlobalEventListeners();
                    state.isInitialized = true;
                } catch (fallbackError) {
                    Logger.error('Fallback initialization also failed:', fallbackError);
                }
            }
        }

        static setupGlobalEventListeners() {
            // Keyboard events
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Shift') {
                    state.isShiftPressed = true;
                }
                if (e.key === 'Escape') {
                    this.clearSelection();
                    tooltipManager.hide();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'c' && state.selectedEquations.size > 0) {
                    e.preventDefault();
                    this.copySelectedEquations();
                }
            });

            document.addEventListener('keyup', (e) => {
                if (e.key === 'Shift') {
                    state.isShiftPressed = false;
                }
            });
        }

        static processExistingEquations() {
            Logger.debug('Starting equation detection...');
            
            // Prioritize .katex-html processing (like Similar Version)
            // This ensures each equation is processed individually without duplicates
            const katexHtmlElements = document.querySelectorAll('.katex-html:not([data-katex-processed])');
            Logger.debug(`Found ${katexHtmlElements.length} KaTeX equations`);
            
            if (katexHtmlElements.length > 0) {
                this.processBatch(Array.from(katexHtmlElements), 0);
            }
            
            // Then process other math libraries (MathJax, MathML, etc.)
            const otherSelectors = [
                '.MathJax:not([data-katex-processed])',
                '.mjx-chtml:not([data-katex-processed])',
                '.mjx-container:not([data-katex-processed])',
                'math:not([data-katex-processed])',
                '[data-math]:not([data-katex-processed])'
            ];
            
            otherSelectors.forEach(selector => {
                try {
                    const equations = document.querySelectorAll(selector);
                    if (equations.length > 0) {
                        Logger.debug(`Found ${equations.length} equations with selector: ${selector}`);
                        this.processBatch(Array.from(equations), 0);
                    }
                } catch (error) {
                    Logger.warn(`Error with selector ${selector}:`, error);
                }
            });

            if (katexHtmlElements.length === 0) {
                Logger.debug('No equations found. Checking page content...');
                Logger.debug('Page has KaTeX?', !!document.querySelector('.katex'));
                Logger.debug('Page has MathJax?', !!document.querySelector('.MathJax'));
                Logger.debug('Page has math tags?', !!document.querySelector('math'));
            } else {
                Logger.info(`Found and processed ${katexHtmlElements.length} mathematical elements`);
            }
        }

        static processBatch(elements, startIndex, batchSize = CONFIG.BATCH_SIZE) {
            if (startIndex >= elements.length) return;

            const endIndex = Math.min(startIndex + batchSize, elements.length);
            const batch = elements.slice(startIndex, endIndex);

            Logger.debug(`Processing batch: ${startIndex} to ${endIndex} of ${elements.length}`);

            // Process each element individually (like Similar Version)
            // Each .katex-html represents one equation
            batch.forEach(element => {
                try {
                    // For .katex-html elements (KaTeX), process the closest .katex container
                    // This is the same approach as Similar Version
                    if (element.classList && element.classList.contains('katex-html')) {
                        // Check if already processed using data attribute (like Similar Version)
                        if (element.hasAttribute('data-katex-processed')) {
                            return;
                        }
                        
                        const katexContainer = element.closest('.katex');
                        if (katexContainer && !katexContainer.hasAttribute('data-katex-processed')) {
                            // Store reference to the .katex-html element in the container
                            // This helps us extract from the correct source later
                            katexContainer._katexHtmlElement = element;
                            this.setupEquation(katexContainer);
                            // Mark both as processed to prevent duplicates
                            katexContainer.setAttribute('data-katex-processed', 'true');
                            element.setAttribute('data-katex-processed', 'true');
                            state.processedElements.add(katexContainer);
                            state.processedElements.add(element);
                        }
                    } else {
                        // For other math elements (MathJax, MathML, etc.)
                        // Check if already processed
                        if (element.hasAttribute('data-katex-processed')) {
                            return;
                        }
                        
                        const container = this.findMathContainer(element);
                        if (container && !container.hasAttribute('data-katex-processed')) {
                            this.setupEquation(container);
                            container.setAttribute('data-katex-processed', 'true');
                            state.processedElements.add(container);
                        }
                    }
                } catch (error) {
                    Logger.warn('Error processing equation element:', error);
                }
            });

            if (endIndex < elements.length) {
                setTimeout(() => {
                    this.processBatch(elements, endIndex, batchSize);
                }, 0);
            }
        }

        static findMathContainer(element) {
            // Find the immediate math container (don't go too far up)
            // This prevents grouping separate equations together
            
            // For .katex-html, find the closest .katex container
            if (element.classList && element.classList.contains('katex-html')) {
                return element.closest('.katex');
            }
            
            // For .katex elements, use them directly
            if (element.classList && element.classList.contains('katex')) {
                return element;
            }
            
            // For MathJax
            if (element.closest('.MathJax, .mjx-chtml, .mjx-container')) {
                return element.closest('.MathJax, .mjx-chtml, .mjx-container');
            }
            
            // For native MathML
            if (element.tagName === 'MATH' || element.closest('math')) {
                return element.tagName === 'MATH' ? element : element.closest('math');
            }
            
            // Default: try to find any math container, but stop at first match
            const katex = element.closest('.katex');
            if (katex) return katex;
            
            const mathjax = element.closest('.MathJax, .mjx-chtml, .mjx-container');
            if (mathjax) return mathjax;
            
            const math = element.closest('math');
            if (math) return math;
            
            return element;
        }

        static setupMutationObserver() {
            const observer = new MutationObserver(mutations => {
                if (state.throttleTimeout) {
                    clearTimeout(state.throttleTimeout);
                }

                state.throttleTimeout = setTimeout(async () => {
                    await this.processMutations(mutations);
                    state.throttleTimeout = null;
                }, CONFIG.OBSERVER_THROTTLE);
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // Store observer for cleanup
            state.mutationObserver = observer;
        }

        static async processMutations(mutations) {
            try {
                // Like Similar Version: query for new .katex-html elements directly
                // This is more efficient and ensures we catch all new equations
                const newEquations = document.querySelectorAll('.katex-html:not([data-katex-processed])');
                
                if (newEquations.length > 0) {
                    Logger.debug(`Found ${newEquations.length} new equations`);
                    this.processBatch(Array.from(newEquations), 0);
                }
                
                // Also check for other math libraries
                const otherNewEquations = [];
                const otherSelectors = [
                    '.MathJax:not([data-katex-processed])',
                    '.mjx-chtml:not([data-katex-processed])',
                    '.mjx-container:not([data-katex-processed])',
                    'math:not([data-katex-processed])',
                    '[data-math]:not([data-katex-processed])'
                ];
                
                otherSelectors.forEach(selector => {
                    try {
                        const matches = document.querySelectorAll(selector);
                        matches.forEach(match => {
                            if (!state.processedElements.has(match) && !match.hasAttribute('data-katex-processed')) {
                                otherNewEquations.push(match);
                            }
                        });
                    } catch (error) {
                        // Ignore invalid selectors
                    }
                });
                
                if (otherNewEquations.length > 0) {
                    Logger.debug(`Found ${otherNewEquations.length} new equations from other libraries`);
                    
                    // If MathJax is present, wait for it to render new equations
                    const hasMathJax = typeof window.MathJax !== 'undefined';
                    if (hasMathJax) {
                        try {
                            // Check if any of the new equations are MathJax
                            const hasMathJaxEquations = otherNewEquations.some(eq => 
                                eq.classList.contains('MathJax') || 
                                eq.classList.contains('mjx-chtml') || 
                                eq.classList.contains('mjx-container') ||
                                eq.closest('.MathJax, .mjx-chtml, .mjx-container')
                            );
                            
                            if (hasMathJaxEquations) {
                                Logger.debug('Waiting for MathJax to render new equations...');
                                await new Promise(resolve => setTimeout(resolve, 300));
                                
                                if (window.MathJax.startup && window.MathJax.typesetPromise) {
                                    try {
                                        await window.MathJax.typesetPromise();
                                    } catch (e) {
                                    }
                                } else if (window.MathJax.Hub && window.MathJax.Hub.Queue) {
                                    await new Promise((resolve) => {
                                        window.MathJax.Hub.Queue(() => {
                                            resolve();
                                        });
                                    });
                                }
                            }
                        } catch (error) {
                            Logger.warn('Error waiting for MathJax in mutation handler:', error);
                        }
                    }
                    
                    this.processBatch(otherNewEquations, 0);
                }
            } catch (error) {
                Logger.error('Error processing mutations:', error);
            }
        }

        static findEquationsInNode(node) {
            const equations = [];
            
            // Prioritize .katex-html (like Similar Version)
            if (node.querySelectorAll) {
                try {
                    const katexHtmlElements = node.querySelectorAll('.katex-html:not([data-katex-processed])');
                    katexHtmlElements.forEach(element => {
                        if (!state.processedElements.has(element)) {
                            equations.push(element);
                        }
                    });
                } catch (error) {
                    // Ignore invalid selectors
                }
            }
            
            // Then check other math libraries
            const otherSelectors = [
                '.MathJax:not([data-katex-processed])',
                '.mjx-chtml:not([data-katex-processed])',
                '.mjx-container:not([data-katex-processed])',
                'math:not([data-katex-processed])',
                '[data-math]:not([data-katex-processed])'
            ];
            
            otherSelectors.forEach(selector => {
                try {
                    if (node.querySelectorAll) {
                        const matches = node.querySelectorAll(selector);
                        matches.forEach(match => {
                            if (!state.processedElements.has(match) && !match.hasAttribute('data-katex-processed')) {
                                equations.push(match);
                            }
                        });
                    }
                } catch (error) {
                }
            });

            return equations;
        }

        static getAllSelectors() {
            // This method is now deprecated - we process .katex-html directly
            // Kept for backward compatibility with other code
            const selectors = [];
            for (const library in CONFIG.selectorPatterns) {
                selectors.push(...CONFIG.selectorPatterns[library]);
            }
            return selectors;
        }

        static isEquation(node) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

            for (const library in CONFIG.selectorPatterns) {
                const selectors = CONFIG.selectorPatterns[library];
                for (const selector of selectors) {
                    try {
                        if (selector.startsWith('.') && 
                            node.classList.contains(selector.substring(1))) {
                            return true;
                        } else if (selector === node.tagName.toLowerCase()) {
                            return true;
                        } else if (selector.startsWith('[') && 
                                 node.hasAttribute(selector.slice(1, -1))) {
                            return true;
                        }
                    } catch (error) {
                        // Ignore invalid selector
                    }
                }
            }
            return false;
        }

        static setupEquation(equation) {
            try {
                // Validate input
                if (!equation || !equation.nodeType || equation.nodeType !== Node.ELEMENT_NODE) {
                    Logger.warn('Invalid equation element provided to setupEquation');
                    return;
                }

                Logger.debug('Setting up equation:', equation.className || equation.tagName);
                
                // Don't wrap if already wrapped
                if (equation.classList.contains('math-copy-element')) {
                    Logger.debug('Already set up, skipping');
                    return;
                }

                // Check if this element is already inside a math-copy-element
                // But only check immediate parent, not all ancestors (prevents grouping issues)
                const parent = equation.parentElement;
                if (parent && parent.classList && parent.classList.contains('math-copy-element')) {
                    Logger.debug('Parent already set up, skipping');
                    return;
                }

                // For KaTeX: the equation parameter should be the .katex container
                // This is set up in processBatch before calling setupEquation
                // Verify it's a .katex container
                if (equation.classList && equation.classList.contains('katex')) {
                    // This is the container we want - proceed with setup
                } else if (equation.classList && equation.classList.contains('katex-html')) {
                    // This shouldn't happen if processBatch is working correctly
                    // But handle it as a fallback
                    Logger.warn('setupEquation called with .katex-html instead of .katex container');
                    const katexContainer = equation.closest('.katex');
                    if (katexContainer && katexContainer !== equation) {
                        this.setupEquation(katexContainer);
                        return;
                    } else {
                        Logger.warn('Could not find .katex container for .katex-html element');
                        return;
                    }
                }

                equation.classList.add('math-copy-element');
                equation.setAttribute('tabindex', '0');
                equation.setAttribute('role', 'button');
                equation.setAttribute('aria-label', 'Mathematical equation - click to copy');

                Logger.debug('Equation setup complete:', equation.className);
                this.setupEquationListeners(equation);
            } catch (error) {
                Logger.error('Error setting up equation:', error);
                state.errorCount++;
            }
        }

        static setupEquationListeners(equation) {
            // Create handler functions that can be removed later
            const handlers = {
                mouseenter: () => {
                    equation.classList.add('math-copy-hover');
                    const tooltipText = this.getTooltipText(equation);
                    tooltipManager.show(equation, tooltipText);
                },
                mouseleave: () => {
                    equation.classList.remove('math-copy-hover');
                    // Clear any success/error states when leaving the element
                    equation.classList.remove('math-copy-success', 'math-copy-error', 'math-copy-copying');
                    tooltipManager.scheduleHide(CONFIG.TOOLTIP_HIDE_DELAY);
                },
                click: async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const targetEquation = equation;

                    if (state.isShiftPressed) {
                        this.toggleEquationSelection(targetEquation);
                    } else {
                        await this.copyEquation(targetEquation);
                    }
                },
                keydown: async (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        await this.copyEquation(equation);
                    }
                },
                contextmenu: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showContextMenu(e, equation);
                }
            };

            state.equationHandlers.set(equation, handlers);

            equation.addEventListener('mouseenter', handlers.mouseenter);
            equation.addEventListener('mouseleave', handlers.mouseleave);
            equation.addEventListener('click', handlers.click);
            equation.addEventListener('keydown', handlers.keydown);
            equation.addEventListener('contextmenu', handlers.contextmenu);
        }

        static removeEquationListeners(equation) {
            const handlers = state.equationHandlers.get(equation);
            if (handlers) {
                equation.removeEventListener('mouseenter', handlers.mouseenter);
                equation.removeEventListener('mouseleave', handlers.mouseleave);
                equation.removeEventListener('click', handlers.click);
                equation.removeEventListener('keydown', handlers.keydown);
                equation.removeEventListener('contextmenu', handlers.contextmenu);
                state.equationHandlers.delete(equation);
            }
        }

        static getTooltipText(equation) {
            if (state.selectedEquations.has(equation)) {
                return 'Selected - Click to deselect';
            } else if (state.isShiftPressed) {
                return 'Shift+Click to select';
            } else {
                return 'Click to copy';
            }
        }

        static toggleEquationSelection(equation) {
            if (state.selectedEquations.has(equation)) {
                state.selectedEquations.delete(equation);
                equation.classList.remove('math-copy-selected');
            } else {
                state.selectedEquations.add(equation);
                equation.classList.add('math-copy-selected');
            }

            tooltipManager.updateContent(this.getTooltipText(equation));
            this.notifySelectionChange();
        }

        static async copyEquation(equation) {
            try {
                equation.classList.add('math-copy-copying');
                tooltipManager.updateContent('Copying...');

                const format = window.mathCopyOverrideFormat || state.currentFormat;
                const content = await EquationProcessor.getEquationContent(equation, format);

                if (content) {
                    await this.copyToClipboard(content, format);

                    this.addToClipboardHistory(content, format);

                    equation.classList.remove('math-copy-copying');
                    equation.classList.add('math-copy-success');
                    tooltipManager.updateContent('Copied');

                    this.notifyBackground('equationCopied', {
                        formula: content,
                        format: format,
                        source: this.getMathSource(equation)
                    });

                    setTimeout(() => {
                        equation.classList.remove('math-copy-success');
                        tooltipManager.updateContent('Click to copy');
                    }, CONFIG.SUCCESS_FEEDBACK_DURATION);

                } else {
                    throw new Error('Failed to extract equation content');
                }

            } catch (error) {
                Logger.error('Error copying equation:', error);

                equation.classList.remove('math-copy-copying');
                equation.classList.add('math-copy-error');
                tooltipManager.updateContent('Error');

                setTimeout(() => {
                    equation.classList.remove('math-copy-error');
                    tooltipManager.updateContent('Click to copy');
                }, CONFIG.ERROR_FEEDBACK_DURATION);
            }
        }

        static async copySelectedEquations() {
            if (state.selectedEquations.size === 0) return;

            try {
                const equations = Array.from(state.selectedEquations);
                const contents = [];

                for (const equation of equations) {
                    const content = await EquationProcessor.getEquationContent(equation, state.currentFormat);
                    if (content) {
                        contents.push(content);
                    }
                }

                if (contents.length > 0) {
                    const combinedContent = contents.join('\n\n');
                    await this.copyToClipboard(combinedContent, state.currentFormat);

                    this.addToClipboardHistory(combinedContent, state.currentFormat);

                    this.notifyBackground('equationCopied', {
                        formula: combinedContent,
                        format: state.currentFormat,
                        source: 'Multiple Selection',
                        count: contents.length
                    });

                    equations.forEach(equation => {
                        equation.classList.add('math-copy-success');
                        setTimeout(() => {
                            equation.classList.remove('math-copy-success');
                        }, 1000);
                    });

                    this.clearSelection();
                }

            } catch (error) {
                Logger.error('Error copying selected equations:', error);
            }
        }

        static clearSelection() {
            state.selectedEquations.forEach(equation => {
                equation.classList.remove('math-copy-selected');
            });
            state.selectedEquations.clear();
            this.notifySelectionChange();
        }

        static showContextMenu(event, equation) {
            this.hideContextMenu();

            const menu = document.createElement('div');
            menu.className = 'math-copy-context-menu';
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', 'Equation copy menu');

            const formats = [
                { id: 'mathml', label: 'Copy as MathML', desc: 'For Word' },
                { id: 'latex', label: 'Copy as LaTeX', desc: 'For documents' },
                { id: 'unicode', label: 'Copy as Unicode', desc: 'Plain text' },
                { id: 'asciimath', label: 'Copy as AsciiMath', desc: 'Simple format' }
            ];

            formats.forEach(format => {
                const item = document.createElement('div');
                item.className = 'math-copy-menu-item';
                item.setAttribute('role', 'menuitem');
                item.setAttribute('tabindex', '0');
                item.innerHTML = `
                    <span class="menu-item-label">${this.escapeHtml(format.label)}</span>
                    <span class="menu-item-desc">${this.escapeHtml(format.desc)}</span>
                `;

                item.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideContextMenu();
                    await this.copyEquationInFormat(equation, format.id);
                });

                item.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        this.hideContextMenu();
                        await this.copyEquationInFormat(equation, format.id);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.hideContextMenu();
                    }
                });

                menu.appendChild(item);
            });

            document.body.appendChild(menu);

            const rect = equation.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            
            let left = event.clientX;
            let top = event.clientY;

            if (left + menuRect.width > window.innerWidth) {
                left = window.innerWidth - menuRect.width - 8;
            }
            if (top + menuRect.height > window.innerHeight) {
                top = window.innerHeight - menuRect.height - 8;
            }
            if (left < 8) left = 8;
            if (top < 8) top = 8;

            menu.style.left = `${left + window.scrollX}px`;
            menu.style.top = `${top + window.scrollY}px`;

            state.contextMenu = menu;

            const closeMenu = (e) => {
                if (!menu.contains(e.target) && e.target !== equation) {
                    this.hideContextMenu();
                    document.removeEventListener('click', closeMenu);
                    document.removeEventListener('contextmenu', closeMenu);
                    document.removeEventListener('keydown', closeMenuKey);
                }
            };

            const closeMenuKey = (e) => {
                if (e.key === 'Escape') {
                    this.hideContextMenu();
                    document.removeEventListener('click', closeMenu);
                    document.removeEventListener('contextmenu', closeMenu);
                    document.removeEventListener('keydown', closeMenuKey);
                }
            };

            setTimeout(() => {
                document.addEventListener('click', closeMenu);
                document.addEventListener('contextmenu', closeMenu);
                document.addEventListener('keydown', closeMenuKey);
            }, 100);

            menu.querySelector('.math-copy-menu-item')?.focus();
        }

        static hideContextMenu() {
            if (state.contextMenu && state.contextMenu.parentNode) {
                state.contextMenu.parentNode.removeChild(state.contextMenu);
                state.contextMenu = null;
            }
        }

        static escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        static async copyEquationInFormat(equation, format) {
            try {
                equation.classList.add('math-copy-copying');
                tooltipManager.updateContent(`Copying as ${format.toUpperCase()}...`);

                const content = await EquationProcessor.getEquationContent(equation, format);

                if (content) {
                    await this.copyToClipboard(content, format);
                    this.addToClipboardHistory(content, format);

                    equation.classList.remove('math-copy-copying');
                    equation.classList.add('math-copy-success');
                    tooltipManager.updateContent(`Copied as ${format.toUpperCase()}`);

                    this.notifyBackground('equationCopied', {
                        formula: content,
                        format: format,
                        source: this.getMathSource(equation)
                    });

                    setTimeout(() => {
                        equation.classList.remove('math-copy-success');
                        tooltipManager.updateContent('Click to copy');
                    }, CONFIG.SUCCESS_FEEDBACK_DURATION);
                } else {
                    throw new Error('Failed to extract equation content');
                }
            } catch (error) {
                Logger.error('Error copying equation:', error);
                equation.classList.remove('math-copy-copying');
                equation.classList.add('math-copy-error');
                tooltipManager.updateContent('Error');

                setTimeout(() => {
                    equation.classList.remove('math-copy-error');
                    tooltipManager.updateContent('Click to copy');
                }, CONFIG.ERROR_FEEDBACK_DURATION);
            }
        }

        static async copyToClipboard(text, format) {
            Logger.debug('Copying to clipboard:', { format, textLength: text.length });
            
            // Validate input
            if (!text || typeof text !== 'string' || text.length === 0) {
                throw new ExtensionError('Invalid text content for clipboard', 'INVALID_CLIPBOARD_CONTENT', 'HIGH');
            }

            // Security: Prevent copying extremely large content
            if (text.length > 1000000) {
                throw new ExtensionError('Content too large for clipboard', 'CONTENT_TOO_LARGE', 'MEDIUM');
            }

            try {
                // Try modern Clipboard API first (preferred method)
                if (format === 'mathml' && navigator.clipboard && navigator.clipboard.write) {
                    try {
                        const blobHtml = new Blob([text], { type: 'text/html' });
                        const blobText = new Blob([text], { type: 'text/plain' });
                        const clipboardItem = new ClipboardItem({
                            'text/html': blobHtml,
                            'text/plain': blobText
                        });
                        await navigator.clipboard.write([clipboardItem]);
                        Logger.info('MathML copied to clipboard successfully');
                        return;
                    } catch (clipboardError) {
                        // If ClipboardItem fails, fall through to writeText
                        Logger.debug('ClipboardItem failed, trying writeText:', clipboardError);
                    }
                }
                
                // Fallback to writeText for all formats
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                    Logger.info('Text copied to clipboard successfully');
                    return;
                }
                
                // Final fallback to execCommand (deprecated but still needed for older browsers)
                throw new ExtensionError('Modern clipboard API not available', 'CLIPBOARD_API_UNAVAILABLE', 'MEDIUM');
            } catch (error) {
                // Only use fallback if it's not a security/content error
                if (error instanceof ExtensionError && error.severity === 'HIGH') {
                    throw error; // Re-throw high severity errors
                }

                Logger.warn('Modern clipboard API failed, using fallback:', error.message);
                
                // Fallback to execCommand for older browser versions
                try {
                    // Create a secure, hidden textarea element
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.setAttribute('readonly', '');
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    textArea.style.top = '-999999px';
                    textArea.style.opacity = '0';
                    textArea.setAttribute('aria-hidden', 'true');
                    
                    document.body.appendChild(textArea);
                    
                    // Select and copy
                    textArea.focus();
                    textArea.select();
                    textArea.setSelectionRange(0, text.length); // For mobile devices
                    
                    const success = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    if (!success) {
                        throw new ExtensionError('execCommand copy failed', 'EXEC_COMMAND_FAILED', 'HIGH');
                    }
                    
                    Logger.info('Text copied using fallback method');
                } catch (fallbackError) {
                    Logger.error('All clipboard methods failed:', fallbackError);
                    throw new ExtensionError('Unable to copy to clipboard. Please check browser permissions.', 'CLIPBOARD_COPY_FAILED', 'HIGH');
                }
            }
        }

        static getMathSource(element) {
            if (element.closest('.MathJax, .mjx-container')) return 'MathJax';
            if (element.closest('.katex')) return 'KaTeX';
            if (element.closest('math')) return 'MathML';
            return 'Generic';
        }

        static addToClipboardHistory(content, format) {
            // This method is kept for backward compatibility but doesn't save locally
            const historyItem = {
                content: content,
                format: format,
                timestamp: Date.now()
            };

            state.clipboardHistory.unshift(historyItem);

            if (state.clipboardHistory.length > CONFIG.MAX_CLIPBOARD_HISTORY) {
                state.clipboardHistory = state.clipboardHistory.slice(0, CONFIG.MAX_CLIPBOARD_HISTORY);
            }

        }

        static notifySelectionChange() {
            this.notifyBackground('selectionUpdated', {
                count: state.selectedEquations.size
            });
        }

        static notifyBackground(type, data = {}) {
            try {
                if (!chrome.runtime || !chrome.runtime.id) {
                    Logger.debug('Extension context invalidated, skipping message');
                    return;
                }

                Logger.debug('Notifying background:', { type, data });
                chrome.runtime.sendMessage({
                    type: type,
                    ...data
                }).catch(error => {
                    if (error.message && error.message.includes('Extension context invalidated')) {
                        Logger.debug('Extension context invalidated, message skipped');
                    } else {
                        Logger.warn('Failed to notify background script:', error);
                    }
                });
            } catch (error) {
                if (error.message && error.message.includes('Extension context invalidated')) {
                    Logger.debug('Extension context invalidated, message skipped');
                } else {
                    Logger.warn('Error sending message to background:', error);
                }
            }
        }
    }

    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(null, (result) => {
                state.settings = {
                    format: 'mathml',
                    autoCopy: true,
                    previewMode: false,
                    validation: true,
                    darkMode: false,
                    multiSelection: true,
                    clipboardHistory: true,
                    showTooltips: true,
                    keyboardShortcuts: true,
                    ...result.mathCopySettings
                };

                state.currentFormat = state.settings.format;
                resolve(state.settings);
            });
        });
    }

    async function loadClipboardHistory() {
        return new Promise((resolve) => {
            chrome.storage.local.get('clipboardHistory', (result) => {
                state.clipboardHistory = result.clipboardHistory || [];
                resolve(state.clipboardHistory);
            });
        });
    }

    async function checkIfDisabled() {
        try {
            const currentUrl = window.location.href;
            const result = await chrome.storage.local.get(['disabledPages', 'disabledSites']);
            const disabledPages = result.disabledPages || [];
            const disabledSites = result.disabledSites || [];
            
            if (disabledPages.includes(currentUrl)) {
                return true;
            }
            
            try {
                const urlObj = new URL(currentUrl);
                const siteUrl = `${urlObj.protocol}//${urlObj.host}`;
                if (disabledSites.includes(siteUrl)) {
                    return true;
                }
            } catch (e) {
                Logger.warn('Error parsing URL:', e);
            }
            
            return false;
        } catch (error) {
            Logger.error('Error checking disabled status:', error);
            return false;
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'settingsUpdated':
                try {
                    state.settings = { ...state.settings, ...message.settings };
                    // Validate format
                    if (CONFIG.validFormats.includes(state.settings.format)) {
                        state.currentFormat = state.settings.format;
                    } else {
                        Logger.warn('Invalid format in settings, using default');
                        state.currentFormat = CONFIG.defaultFormat;
                    }
                    Logger.debug('Settings updated:', state.settings);
                    sendResponse({ success: true });
                } catch (error) {
                    Logger.error('Error updating settings:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'formatChanged':
                try {
                    if (CONFIG.validFormats.includes(message.format)) {
                        state.currentFormat = message.format;
                        sendResponse({ success: true });
                    } else {
                        Logger.warn('Invalid format requested:', message.format);
                        sendResponse({ success: false, error: 'Invalid format' });
                    }
                } catch (error) {
                    Logger.error('Error changing format:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'copySelected':
                DOMProcessor.copySelectedEquations().then(() => {
                    sendResponse({ 
                        success: true, 
                        count: state.selectedEquations.size 
                    });
                }).catch(error => {
                    sendResponse({ 
                        success: false, 
                        error: error.message 
                    });
                });
                return true; // Async response

            case 'clearSelection':
                DOMProcessor.clearSelection();
                sendResponse({ success: true });
                break;

            case 'getClipboardHistory':
                sendResponse({ 
                    success: true, 
                    history: state.clipboardHistory 
                });
                break;

            case 'getStats':
                sendResponse({
                    success: true,
                    stats: {
                        processedElements: 'N/A', // WeakSet has no size property
                        selectedCount: state.selectedEquations.size,
                        isInitialized: state.isInitialized
                    }
                });
                break;
                
            case 'forceDetection':
                try {
                    Logger.info('Manual equation detection triggered from popup');
                    DOMProcessor.processExistingEquations();
                    sendResponse({ success: true, message: 'Equation detection triggered' });
                } catch (error) {
                    Logger.error('Error during force detection:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;
        }
        return true; // Always return true to keep message channel open
    });

    /**
     * Initialize the content script
     */
    async function initialize() {
        try {
            Logger.info('Starting Math Copy Extension initialization...');
            
            // Check if we're in a valid environment
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
                Logger.debug('Chrome extension APIs not available or context invalidated');
                return;
            }
            
            const isDisabled = await checkIfDisabled();
            if (isDisabled) {
                Logger.info('Extension disabled on this page/site');
                return;
            }
            
            await loadSettings();
            await loadClipboardHistory();
            DOMProcessor.initialize();
            
            Logger.info('Math Copy Extension initialized successfully');
        } catch (error) {
            Logger.error('Failed to initialize Math Copy Extension:', error);
            state.errorCount++;
            
            // Show user-friendly error message only if not too many errors
            if (state.errorCount <= 3) {
                try {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: #EF4444;
                        color: white;
                        padding: 12px 16px;
                        border-radius: 6px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-size: 14px;
                        z-index: 10000;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    `;
                    errorDiv.textContent = 'Math Copy Extension failed to load. Please refresh the page.';
                    errorDiv.setAttribute('role', 'alert');
                    errorDiv.setAttribute('aria-live', 'polite');
                    document.body.appendChild(errorDiv);
                    
                    // Remove after 5 seconds
                    setTimeout(() => {
                        if (errorDiv.parentNode) {
                            errorDiv.parentNode.removeChild(errorDiv);
                        }
                    }, 5000);
                } catch (displayError) {
                    Logger.error('Failed to display error message:', displayError);
                }
            }
        }
    }

    function cleanup() {
        Logger.debug('Cleaning up Math Copy Extension...');
        
        try {
            tooltipManager.cleanup();
            DOMProcessor.hideContextMenu();
            
            if (state.mutationObserver) {
                state.mutationObserver.disconnect();
                state.mutationObserver = null;
            }
            
            if (state.throttleTimeout) {
                clearTimeout(state.throttleTimeout);
                state.throttleTimeout = null;
            }
            
            const processedElements = document.querySelectorAll('.math-copy-element');
            processedElements.forEach(element => {
                try {
                    DOMProcessor.removeEquationListeners(element);
                } catch (error) {
                    Logger.warn('Error removing listeners from element:', error);
                }
            });
            
            state.selectedEquations.clear();
            state.processedElements = new WeakSet();
            state.equationHandlers = new WeakMap();
            state.contextMenu = null;
            state.isInitialized = false;
            state.errorCount = 0;
            
            Logger.debug('Cleanup completed');
        } catch (error) {
            Logger.error('Error during cleanup:', error);
        }
    }

    // Add cleanup listener
    window.addEventListener('beforeunload', cleanup);

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
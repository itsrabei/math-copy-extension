# Math Copy Extension v1.0.0

A powerful browser extension for copying mathematical equations in multiple formats, with MathML as the default for perfect MS Word integration.

**Available on [Chrome Web Store](https://chrome.google.com/webstore/detail/[YOUR_EXTENSION_ID])** | [GitHub Repository](https://github.com/YOUR_USERNAME/YOUR_REPO_NAME)

## Features

### Core Functionality
- **MathML as Default**: Optimized for MS Word compatibility
- **Multiple Formats**: MathML, LaTeX, Unicode, and AsciiMath
- **Universal Detection**: Works with MathJax, KaTeX, and native MathML
- **Smart Selection**: Multi-select equations with Shift+Click
- **Keyboard Shortcuts**: Quick access with Alt+M and Alt+Shift+M

### Advanced Features
- **Clipboard History**: Track and reuse copied equations
- **Statistics**: Usage analytics and format preferences
- **Right-Click Context Menu**: Quick format selection on equations
- **Blocked Sites/Pages**: Disable extension on specific pages or sites
- **Dark Mode**: Modern UI with theme support
- **Accessibility**: Full keyboard navigation and screen reader support
- **Export Options**: Save clipboard history as JSON

### User Experience
- **Hover Tooltips**: Visual feedback on math elements
- **Visual States**: Clear indication of selection and copy status
- **Responsive Design**: Works on all screen sizes
- **Error Handling**: Graceful fallbacks and user feedback

## Installation

1. Download or clone this repository
2. Open Chrome/Edge and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your browser toolbar

## Usage

### Basic Copying
1. Navigate to any webpage with mathematical equations
2. Hover over a math equation to see the tooltip
3. Click to copy as MathML (default format)
4. Paste into MS Word or any compatible application

### Multi-Selection
1. Hold Shift and click multiple equations
2. Use the popup to copy all selected equations
3. Or use Ctrl+Shift+C keyboard shortcut

### Format Options
- **MathML**: Best for MS Word, PowerPoint, and web applications
- **LaTeX**: Standard for academic papers and scientific documents
- **Unicode**: Plain text with mathematical symbols
- **AsciiMath**: Simple, lightweight format

### Keyboard Shortcuts
- `Alt+M`: Copy first math equation as MathML
- `Alt+Shift+M`: Toggle between formats
- `Ctrl+Shift+C`: Copy selected equations
- `Ctrl+Shift+X`: Clear selection
- `Escape`: Clear selection and hide tooltips

## Configuration

Open the extension popup to configure:
- **Output Format**: Choose default format (MathML recommended)
- **Auto-copy**: Enable/disable automatic copying on click
- **Multi-selection**: Enable/disable multi-select mode
- **Tooltips**: Show/hide hover tooltips
- **Dark Mode**: Toggle between light and dark themes
- **Validation**: Enable MathML validation

## Supported Math Libraries

- **MathJax**: All versions and configurations
- **KaTeX**: Inline and display math
- **Native MathML**: Direct browser support
- **Generic**: Fallback for custom implementations

## Browser Compatibility

- Chrome 88+
- Edge 88+
- Firefox 78+ (with minor limitations)
- Safari 14+ (with minor limitations)

## Development

### Project Structure
```
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── content.js            # Content script
├── content.css           # Content script styles
├── popup.html            # Popup interface
├── popup.js              # Popup logic
├── popup.css             # Popup styles
├── advanced.html         # Advanced settings page
├── advanced.js           # Advanced settings logic
├── icons/                # Extension icons (16, 32, 48, 128)
├── .gitignore           # Git ignore rules
├── LICENSE              # MIT License
├── README.md            # This file
└── QA_REPORT_COMPREHENSIVE_V1.md  # QA report
```

### Key Components

#### Background Script (`background.js`)
- Handles extension lifecycle
- Manages settings and storage
- Processes context menu actions
- Tracks usage statistics

#### Content Script (`content.js`)
- Detects mathematical elements
- Handles user interactions
- Processes equation extraction
- Manages clipboard operations

#### Popup Interface (`popup.html/js/css`)
- Settings configuration
- Clipboard history management
- Statistics display
- Selection tools
- Enable/disable controls

#### Advanced Settings (`advanced.html/js`)
- Detailed statistics view
- Blocked sites/pages management
- Data export functionality
- Advanced configuration options

### Building from Source

1. Clone the repository
2. No build process required - pure JavaScript
3. Load as unpacked extension in browser
4. Make changes and reload extension

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Changelog

### v1.0.0 (Current)
- **Right-click context menu**: Quick format selection directly on equations
- **Blocked sites/pages management**: Control where the extension is active
- **MathJax v2/v3 support**: Proper integration with official MathJax APIs
- **Enhanced equation detection**: Improved handling of KaTeX, MathJax, and native MathML
- **Clipboard history**: Track and reuse copied equations
- **Usage statistics**: Analytics and format preferences
- **Multi-selection**: Select and copy multiple equations
- **Keyboard shortcuts**: Quick access with Alt+M, Alt+Shift+M, etc.
- **Dark mode**: Modern UI with theme support
- **Comprehensive error handling**: Graceful fallbacks and user feedback
- **Accessibility**: Full keyboard navigation and screen reader support

## Download

### Chrome Web Store
[![Available on Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-blue)](https://chrome.google.com/webstore/detail/[YOUR_EXTENSION_ID])
[Add to Chrome](https://chrome.google.com/webstore/detail/[YOUR_EXTENSION_ID]) - Install from Chrome Web Store

### Manual Installation
1. Download or clone this repository
2. Open Chrome/Edge and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your browser toolbar

## Privacy & Data Collection

**We do not collect any personal information.**

This extension operates entirely locally:
- **No data transmission**: All data stays on your device
- **No tracking**: We don't track your browsing activity
- **No analytics**: We don't send usage data to any servers
- **No external connections**: The extension works completely offline except for accessing web pages with math equations
- **Local storage only**: Settings, history, and statistics are stored only on your device using Chrome's local storage API
- **No cookies**: We don't use cookies or tracking technologies

Your clipboard history and usage statistics are stored locally in your browser and never leave your device. You can clear this data at any time through the extension's advanced settings.

## Support

- **Issues**: Report bugs and request features on GitHub
- **Documentation**: Check the help section in the popup
- **Community**: Join discussions in GitHub Discussions

## Acknowledgments

- MathJax team for excellent math rendering
- KaTeX team for fast math typesetting
- W3C for MathML specification
- All contributors and testers

---

Made for the mathematical community by Tefo

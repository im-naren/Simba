# nTabManager Chrome Extension

A smart Chrome extension that automatically identifies and closes duplicate tabs to keep your browser organized and improve performance.

## Features

- 🤖 **Real-Time Auto-Detection**: Automatically detects and closes duplicate tabs as soon as they're opened
- 🔍 **Smart Detection**: Finds duplicate tabs across all windows with intelligent URL matching
- 🧹 **One-Click Cleanup**: Manual scan and close all duplicates with a single button click
- 🎯 **Selective Removal**: Choose which duplicate groups to close manually
- 📊 **Clear Statistics**: See how many duplicates were found during manual scans
- 🎨 **Modern UI**: Clean, intuitive interface with smooth animations and live status indicator
- ⚡ **Fast Performance**: Efficient tab scanning and real-time duplicate management

## How It Works

The extension operates in two modes:

### 🤖 **Automatic Mode (Real-time)**
1. Monitors tab creation and navigation events in real-time
2. When a new tab opens or navigates to a URL, checks for existing duplicates
3. Automatically closes older tabs with the same URL (keeps the newest one)
4. Works silently in the background without user intervention
5. Skips Chrome internal pages and new tab pages

### 🔍 **Manual Mode (On-demand)**
1. Scans all open tabs across all Chrome windows when popup is opened
2. Groups tabs by URL (ignoring URL fragments for better matching)
3. Identifies groups with multiple tabs as duplicates
4. Shows statistics and duplicate groups in the popup interface
5. Allows selective or bulk removal of duplicates
6. Keeps the most recently accessed tab from each group

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the `duplicate-tabs` folder
5. The extension icon will appear in your Chrome toolbar

### Using the Extension

**Automatic Operation:**
- The extension works automatically in the background
- When you open a duplicate tab, the older one is closed instantly
- No user action required - just install and enjoy a cleaner browser!

**Manual Control:**
1. Click the extension icon in your Chrome toolbar
2. The extension will scan for any remaining duplicate tabs
3. View the results:
   - **All Clean**: No duplicates found (auto-detection is still running)
   - **Duplicates Found**: Shows statistics and duplicate groups
4. Choose your action:
   - **Close All Duplicates**: Removes all duplicate tabs at once
   - **Close Group**: Remove duplicates from a specific website
   - **Refresh Scan**: Re-scan for duplicates

## Privacy & Permissions

This extension requires:
- `tabs`: To access and manage your browser tabs
- `activeTab`: To interact with the currently active tab

**Privacy Note**: This extension:
- ✅ Works entirely locally - no data is sent to external servers
- ✅ Only accesses tab URLs and titles for duplicate detection
- ✅ Does not store or track your browsing history
- ✅ Does not access page content or personal data

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Architecture**: Service Worker background script + popup interface
- **Compatibility**: Chrome 88+ (Manifest V3 support)

## Development

### Project Structure
```
duplicate-tabs/
├── manifest.json      # Extension configuration
├── background.js      # Service worker for tab management
├── popup.html         # Extension popup interface
├── popup.js          # Popup interaction logic
├── styles.css        # Modern UI styling
├── icon*.png         # Extension icons (16, 32, 48, 128px)
└── README.md         # This file
```

### Key Components

- **DuplicateTabManager**: Core logic for finding and managing duplicate tabs
- **DuplicateTabUI**: Popup interface for user interactions
- **URL Normalization**: Smart URL comparison (removes fragments, handles query parameters)

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve this extension.

## License

This project is open source and available under the MIT License. 
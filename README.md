# Amplify: Smart Tab Management

<div align="center">
  <h3>🚀 Advanced Chrome extension combining Arc-style vertical spaces with intelligent duplicate detection</h3>
</div>

---

## ✨ Features

### 📱 **Arc-Style Vertical Spaces**

- **Professional sidebar interface** with Arc browser's innovative space management
- **Multiple Spaces** - Organize tabs into distinct workspaces (Work, Personal, Projects, etc.)
- **Pinned Tabs** - Keep favorite sites accessible across all spaces
- **Folders** - Group related tabs within spaces for better organization
- **Tab Archiving** - Auto-archive idle tabs to keep spaces clean
- **Beautiful UI** - Modern, customizable color themes for each space

### 🤖 **Intelligent Duplicate Detection**

- **Real-time Detection** - Automatically detects and closes duplicate tabs as they're created
- **Smart URL Matching** - Intelligent normalization ignores fragments and tracking parameters
- **Manual Control** - Use the popup to scan and selectively close duplicates
- **Safe Closing** - Race condition protection ensures reliable tab management
- **Statistics** - View detailed duplicate tab analytics

### ⚡ **Powerful Tab Management**

- **Quick Actions** - One-click tab switching, pinning, and closing
- **Tree View** - Group tabs by domain for better organization and overview
- **Keyboard Shortcuts** - `Ctrl+E` (Cmd+E on Mac) to toggle sidebar, `Ctrl+D` to quick pin/unpin
- **Search & Filter** - Find tabs instantly across all spaces
- **Drag & Drop** - Easily move tabs between spaces and folders
- **Auto-Archive** - Automatically archive idle tabs after configurable time

### 🎨 **Beautiful Design**

- **Dark Theme** - Professional VS Code-inspired dark interface
- **Color-Coded Spaces** - 8 beautiful color themes to organize your workflow
- **Smooth Animations** - Polished transitions and interactions
- **Responsive** - Adapts beautifully to any side panel width

## 🔧 Requirements

- **Chrome V114+** for Side Panel API support
- Chrome browser with extensions enabled

## 📦 Installation

### Method 1: Load Unpacked (Development)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the project folder
6. Click the Amplify extension icon to open the side panel

### Method 2: Chrome Web Store (Coming Soon)

The extension will soon be available on the Chrome Web Store for one-click installation.

## 🎯 Usage

### Side Panel (Main Interface)

**Opening the Sidebar:**
- Click the Amplify icon in Chrome toolbar, OR
- Press `Ctrl+E` (Windows/Linux) or `Cmd+E` (Mac)

**Managing Spaces:**
- All your spaces are displayed as collapsible groups in the Tabs section
- Each space shows its name, color indicator, and tab count
- Click any space header to expand/collapse and view its tabs
- See all your tabs across all spaces in one unified view
- No need to switch between spaces - everything is accessible at once

**Working with Tabs:**
- **Open new tab**: Click the "+ New Tab" button
- **Switch to tab**: Click any tab in the list
- **Pin/Unpin tab**: Drag tab to "Pinned" section or press `Ctrl+D`
- **Move tab**: Drag tab to different space or folder
- **Close tab**: Hover over tab and click the × button or middle-click
- **Tree View**: Click the tree view toggle button to group tabs by domain
  - Tabs are automatically grouped by website
  - Click domain header to expand/collapse groups
  - See tab count per domain at a glance
  - All tab actions (switch, close, context menu) work in tree view

**Creating Folders:**
- Click the space options menu (⋮) and select "New Folder"
- Name your folder and drag tabs into it
- Click folder header to expand/collapse

**Auto-Archive:**
- Idle tabs are automatically archived after the configured time
- View archived tabs by clicking the archive button in space header
- Click any archived tab to restore it

### Duplicate Detection (Popup)

**Opening the Popup:**
- Right-click the Amplify icon and select "Open Popup", OR
- Click the extension icon if you've configured it to show popup

**Using Duplicate Detection:**
- **Automatic**: Duplicates are automatically closed in real-time
- **Manual Scan**: Click "Scan for Duplicates" to find all duplicates
- **Selective Closing**: Close specific duplicate groups individually
- **Close All**: Remove all duplicates at once

### Keyboard Shortcuts

- `Ctrl+E` / `Cmd+E` - Toggle side panel
- `Ctrl+D` / `Cmd+D` - Quick pin/unpin current tab
- `Ctrl+F` - Search tabs (when sidebar is focused)

## ⚙️ Configuration

### Auto-Archive Settings

Configure automatic tab archiving to keep your spaces clean:

1. Right-click extension icon → Options
2. Enable "Auto-archive idle tabs"
3. Set the idle time threshold (in minutes)
4. Tabs idle longer than this will be automatically archived

### Duplicate Detection

The duplicate detection runs automatically in the background. You can:
- Disable auto-close in settings (coming soon)
- Use manual scan mode from the popup
- View statistics on duplicate tab patterns

## 🏗️ Architecture

### File Structure

```
amplify/
├── manifest.json              # Extension configuration
├── background.js              # Service worker (duplicate detection + auto-archive)
├── sidebar.html               # Main sidebar interface
├── sidebar.js                 # Sidebar logic (spaces, tabs, folders)
├── styles.css                 # Sidebar styling
├── popup.html                 # Duplicate detection popup
├── popup.js                   # Popup logic
├── chromeHelper.js            # Chrome API utilities
├── domManager.js              # DOM manipulation helpers
├── localstorage.js            # Storage management
├── utils.js                   # Shared utilities
└── icons.js                   # Icon definitions
```

### Key Technologies

- **Manifest V3** - Latest Chrome extension platform
- **Side Panel API** - Native Chrome sidebar integration
- **ES6 Modules** - Modern JavaScript architecture
- **Chrome Storage API** - Persistent data management
- **Chrome Tabs API** - Tab manipulation and monitoring
- **Chrome Bookmarks API** - Space persistence

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Report Bugs** - Open an issue with detailed reproduction steps
2. **Suggest Features** - Share your ideas in GitHub Issues
3. **Submit PRs** - Fork the repo and submit pull requests

### Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/amplify.git
cd amplify

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer Mode
# 3. Click "Load unpacked"
# 4. Select the project folder
```

### Code Style

- Use ES6+ features
- Follow existing code patterns
- Add comments for complex logic
- Test duplicate detection thoroughly

## 🐛 Known Issues

- Auto-archive requires tab to be in a valid group/space
- Duplicate detection may not work for certain internal Chrome URLs
- Calendar integration requires Google OAuth setup

## 📝 Future Enhancements

- [ ] Settings page for duplicate detection preferences
- [ ] Tab session history and restore
- [ ] Cloud sync for spaces across devices
- [ ] Tab grouping improvements
- [ ] Enhanced search with filters
- [ ] Tab suspender for memory optimization
- [ ] Export/import spaces configuration

## 📄 License

This project is open source. Feel free to use, modify, and distribute.

## 🙏 Acknowledgments

- **Arc Browser** - Inspiration for the space management system
- **Arcify** - Original sidebar implementation ([GitHub](https://github.com/nisargkolhe/arcify.git))

## 📧 Support

If you encounter issues or have questions:

1. Check the [Issues](https://github.com/yourusername/amplify/issues) page
2. Create a new issue with detailed information
3. Join our community discussions

---

<div align="center">
  <p>Made with ❤️ for productivity enthusiasts</p>
  <p>⭐ Star this repo if you find it useful!</p>
</div>

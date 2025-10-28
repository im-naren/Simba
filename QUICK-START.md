# Simba: Quick Start Guide

## 🚀 Installation

### 1. Load the Extension
```bash
cd /Users/narendra.kumar/projects/chrome-extensions/nTabManager
```

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the project folder
5. The extension should now appear with the Simba icon

### 2. Grant Permissions (Optional)
If you want Google Calendar and Drive integration:
- Update the `oauth2.client_id` in `manifest.json` with your Google OAuth client ID
- Follow Google's OAuth setup guide

## 🎯 First Steps

### Open the Side Panel
- **Method 1**: Click the Simba icon in the Chrome toolbar
- **Method 2**: Press `Ctrl+E` (Windows/Linux) or `Cmd+E` (Mac)
- **Method 3**: Right-click anywhere → "Simba"

### Tour the Interface
1. **Header**: Extension name with theme toggle and controls
2. **Favorites**: Drag tabs here for persistent favorites
3. **Tabs**: All your tab groups shown as collapsible sections
   - Each space (Home, Work, Personal, etc.) appears as a group
   - Click any group header to expand/collapse it
   - See tab counts for each group at a glance
4. **New Tab**: Create a new tab in the current space

## 🌙 Enable Dark Mode

1. Open the Simba side panel
2. Look for the sun icon (☀️) in the top-right header
3. Click it to toggle dark mode
4. The moon icon (🌙) will appear when dark mode is active
5. Your preference is saved automatically!

**Pro Tip**: Dark mode uses carefully selected colors for comfortable night browsing.

## 🌳 Try Tree View

1. Open the side panel
2. Find the "Tabs" section
3. Click the view mode button (list icon) next to "Clean All"
4. Tabs will now be grouped by domain
5. Click domain headers to expand/collapse
6. Click tabs to switch to them
7. Hover and click × to close tabs

**Use Cases**:
- Many YouTube tabs? They'll all be under `youtube.com`
- Working on GitHub? All repos grouped under `github.com`
- Research session? Organize by website

## 📋 Create Your First Space

1. Click the **"+"** button at the bottom (next to space switcher)
2. Choose a color for your space
3. Enter a name (e.g., "Work", "Personal", "Research")
4. Click "Create"
5. Your new space is ready!

**Tips**:
- Use different colors for different contexts
- Drag tabs between spaces
- Each space has its own pinned tabs

## 📌 Pin Important Tabs

**Method 1**: In the sidebar
- Right-click a tab → "Pin"
- Or drag it to the "Pinned" section

**Method 2**: Quick keyboard shortcut
- Press `Ctrl+D` / `Cmd+D` to pin/unpin the current tab

## 🔍 Manage Duplicate Tabs

### Automatic (Real-time)
- Duplicates are detected and closed automatically
- The most recent tab is kept
- Works in the background

### Manual Scan
1. Right-click the Simba icon → Click to open popup
2. Click "Scan for Duplicates"
3. Review the found duplicates
4. Click "Close All Duplicates" or close specific groups

## 📁 Organize with Folders

1. In any space, click the space options button (⋮)
2. Select "New Folder"
3. Name your folder
4. Drag tabs into the folder
5. Click the folder name to expand/collapse

**Great for**:
- Grouping related tabs (e.g., "Client Projects")
- Temporary collections (e.g., "Read Later")
- Topic-based organization (e.g., "React Docs")

## ⚙️ Auto-Archive Setup

1. Right-click the Simba icon
2. Select "Options"
3. Enable "Auto-archive tabs"
4. Set idle time (e.g., 30 minutes)
5. Inactive tabs will be archived automatically

**Benefits**:
- Reduces tab clutter
- Saves memory
- Archives are accessible anytime

## 🎨 Customize Space Colors

1. Click the space options button (⋮) next to the space name
2. Select from 8 colors:
   - Grey, Blue, Red, Yellow
   - Green, Pink, Purple, Cyan
3. Color helps identify spaces quickly

## 🆕 Using the New Tab Page

1. Open a new tab (Ctrl+T / Cmd+T)
2. See today's Google Calendar events (if configured)
3. Access recent Google Workspace files
4. Quick, distraction-free interface

## 🔧 Troubleshooting

### Dark Mode Not Working?
- Refresh the side panel (close and reopen)
- Check if the theme toggle button responds
- Try reloading the extension

### Tree View Not Showing?
- Make sure you have tabs in the "Tabs" section
- Click the view mode button again
- Check browser console for errors

### Duplicate Detection Issues?
- Open the popup to manually scan
- Check background service worker in `chrome://extensions/`
- Verify the extension has "tabs" permission

### Side Panel Won't Open?
- Check that the extension is enabled
- Try the keyboard shortcut (Ctrl+E / Cmd+E)
- Reload the extension

## 💡 Pro Tips

1. **Keyboard First**: Use `Ctrl+E` to toggle the panel quickly
2. **Color Code**: Assign colors to spaces based on context
3. **Favorites Bar**: Drag your most-used tabs to favorites
4. **Tree for Research**: Use tree view when researching a topic across many sites
5. **Spaces for Contexts**: Create spaces for Work, Personal, Learning, etc.
6. **Auto-Archive**: Enable it to keep your browser fast
7. **Folders in Spaces**: Organize complex projects with folders
8. **Dark Mode at Night**: Toggle theme based on time of day

## 📱 Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Toggle Side Panel | `Ctrl+E` | `Cmd+E` |
| Quick Pin/Unpin | `Ctrl+D` | `Cmd+D` |
| New Tab | `Ctrl+T` | `Cmd+T` |

## 🎓 Learning Path

**Beginner** (Day 1):
1. ✅ Install and open side panel
2. ✅ Enable dark mode
3. ✅ Create your first space
4. ✅ Pin a few important tabs

**Intermediate** (Day 2-3):
5. ✅ Try tree view
6. ✅ Create folders in spaces
7. ✅ Use duplicate detection
8. ✅ Explore keyboard shortcuts

**Advanced** (Week 1):
9. ✅ Set up multiple spaces with colors
10. ✅ Configure auto-archive
11. ✅ Master drag & drop
12. ✅ Organize workflow with favorites

## 📚 More Resources

- **Full Documentation**: See `README.md`
- **Feature Details**: See `SIMBA-FEATURES.md`
- **Version History**: See `CHANGELOG.md`
- **Privacy Policy**: See `privacy-policy.md`

## 🐛 Report Issues

Found a bug or have a suggestion?
1. Check existing issues on GitHub
2. Create a new issue with details
3. Include:
   - Chrome version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable

## 🌟 Enjoy Simba!

You're now ready to manage your tabs like a pro! Start simple, then gradually explore advanced features as you get comfortable.

Happy browsing! 🚀


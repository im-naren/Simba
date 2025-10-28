# CMD+K Search Feature

## Overview
The CMD+K (Mac) / Ctrl+K (Windows/Linux) search feature provides a quick and intuitive way to search through all your open tabs and bookmarks.

## Usage

### Opening the Search Popup
- **Mac**: Press `CMD + K`
- **Windows/Linux**: Press `Ctrl + K`

The search popup will appear as an overlay on the current page with a beautiful, modern interface.

### Searching
1. Type your search query in the input field
2. The popup will instantly filter through:
   - All open tabs (across all windows)
   - All Chrome bookmarks
3. Results show:
   - Favicon
   - Page title
   - URL
   - Badge indicating whether it's a Tab or Bookmark

### Navigation
- **Arrow Up/Down**: Navigate through search results
- **Enter**: Open the selected item
  - For tabs: Switches to the existing tab
  - For bookmarks: Opens in a new tab
- **Escape**: Close the search popup
- **Click**: You can also click on any result to open it

## Features

✨ **Instant Search**: Real-time filtering as you type
🎨 **Beautiful UI**: Modern, clean design with smooth animations
🌓 **Dark Mode Support**: Automatically adapts to your system theme
⚡ **Fast Navigation**: Keyboard shortcuts for power users
🔍 **Comprehensive Results**: Searches both titles and URLs
🎯 **Smart Highlighting**: Selected item is clearly highlighted
📱 **Responsive**: Works on all screen sizes

## Technical Details

### Files
- `manifest.json`: Adds the CMD+K keyboard command and content script
- `background.js`: Handles command and provides tab/bookmark data
- `search-popup-content.js`: Content script that manages the search popup
- `search-popup.css`: Beautiful styling for the search interface

### Permissions Used
- `tabs`: To query and switch between tabs
- `bookmarks`: To search through all bookmarks
- `commands`: To handle the keyboard shortcut

## Customization

The search feature respects your system preferences:
- Light/dark mode follows your OS settings
- Smooth animations enhance the user experience
- Keyboard shortcuts follow platform conventions (CMD on Mac, Ctrl elsewhere)

## Tips
- Search by domain: Type just the domain name to find all tabs/bookmarks from that site
- Quick navigation: Use arrow keys instead of mouse for faster workflow
- Close with Escape: Press Escape anytime to quickly dismiss the popup


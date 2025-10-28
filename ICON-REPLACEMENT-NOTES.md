# Icon Replacement Instructions for Simba

## Current Status
The extension has been renamed from "Amplify" to "Simba" but the icons need to be replaced with a labrador-themed design.

## Required Icon Sizes
You need to create the following icon files:
- `assets/icon-16.png` (16x16 pixels)
- `assets/icon-32.png` (32x32 pixels)
- `assets/icon-48.png` (48x48 pixels)
- `assets/icon-128.png` (128x128 pixels)

## Recommended Icon Sources
1. **iconfinder.com** - Search for "labrador retriever icon"
   - Example: https://www.iconfinder.com/icons/8025856/labrador_retriever_icon
2. **flaticon.com** - Search for "labrador dog icon"
3. **icons8.com** - Search for "labrador"
4. **Custom Design** - Commission a custom labrador icon that matches the Simba theme

## Design Guidelines
- **Style**: Simple, clean, and recognizable at small sizes
- **Colors**: Use warm, friendly colors appropriate for a labrador (golden, brown, or cream tones)
- **Format**: PNG with transparency
- **Quality**: High resolution, scalable design

## Installation Steps
1. Download or create your labrador icons in the required sizes
2. Place them in the `/assets/` directory with these exact names:
   - `icon-16.png`
   - `icon-32.png`
   - `icon-48.png`
   - `icon-128.png`
3. The `manifest.json` has already been updated to reference these files
4. Reload the extension in Chrome (`chrome://extensions/`)
5. The new labrador icon should appear immediately

## Current Configuration
The `manifest.json` already references the correct paths:
```json
"action": {
  "default_icon": {
    "16": "assets/icon-16.png",
    "32": "assets/icon-32.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png"
  }
},
"icons": {
  "16": "assets/icon-16.png",
  "32": "assets/icon-32.png",
  "48": "assets/icon-48.png",
  "128": "assets/icon-128.png"
}
```

## Verification
After adding the icons:
1. Go to `chrome://extensions/`
2. Find "Simba: Smart Tab Management"
3. You should see the new labrador icon in:
   - The extensions list
   - The Chrome toolbar
   - The browser's side panel

## Notes
- The old icons are currently in the `/icons/` directory (can be removed after replacement)
- Make sure the icon is clear and recognizable at 16x16 pixels (the smallest size)
- Test the icon on both light and dark backgrounds to ensure visibility
- Consider using a dog profile or dog paw print if a full labrador image is too complex at small sizes

---
**Priority**: Replace these icons to complete the Simba rebranding!


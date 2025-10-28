# How to Properly Reload the Extension

The error you're seeing is from Chrome's cache of the old version. Follow these steps:

## Steps to Fix:

1. **Go to** `chrome://extensions/`

2. **Find** "Simba: Smart Tab Management"

3. **Click the RELOAD button** (circular arrow icon)

4. **If errors persist**, do a hard reset:
   - Click the **Remove** button to completely uninstall
   - Then click **Load unpacked** 
   - Select this folder: `/Users/narendra.kumar/projects/chrome-extensions/nTabManager`

5. **Clear the errors**:
   - Click "Clear all" on the errors page
   - Refresh any open tabs

6. **Test CMD+K**:
   - Go to any webpage
   - Press CMD+K (or Ctrl+K on Windows)
   - The search popup should appear

## Verification

Run these commands to verify all files are valid:

```bash
cd /Users/narendra.kumar/projects/chrome-extensions/nTabManager
node -c sidebar.js && echo "✅ sidebar.js OK"
node -c search-popup-content.js && echo "✅ search-popup-content.js OK"
node -c background.js && echo "✅ background.js OK"
python3 -m json.tool manifest.json > /dev/null && echo "✅ manifest.json OK"
```

All files are syntactically correct. The issue is Chrome's caching.


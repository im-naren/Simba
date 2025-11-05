import { Utils } from './utils.js';

// ==================================================
// CONSTANTS
// ==================================================
const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

// ==================================================
// DUPLICATE TAB DETECTION
// ==================================================

class DuplicateTabManager {
  constructor() {
    this.duplicateGroups = new Map();
    this.closingTabs = new Set();
    this.recentlyClosedTabs = new Set();
  }

  // Find all duplicate tabs across all windows
  async findDuplicateTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      const urlGroups = new Map();
      
      // Group tabs by URL
      tabs.forEach(tab => {
        const normalizedUrl = this.normalizeUrl(tab.url);
        if (!urlGroups.has(normalizedUrl)) {
          urlGroups.set(normalizedUrl, []);
        }
        urlGroups.get(normalizedUrl).push(tab);
      });
      
      // Filter groups that have duplicates (more than 1 tab)
      const duplicateGroups = new Map();
      urlGroups.forEach((tabs, url) => {
        if (tabs.length > 1) {
          duplicateGroups.set(url, tabs);
        }
      });
      
      this.duplicateGroups = duplicateGroups;
      return duplicateGroups;
    } catch (error) {
      console.error('Error finding duplicate tabs:', error);
      return new Map();
    }
  }

  // Normalize URL for comparison
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }

  // Close duplicate tabs, keeping the most recently active one
  async closeDuplicates(urlsToClose = null) {
    try {
      let closedCount = 0;
      
      for (const [url, tabs] of this.duplicateGroups) {
        if (urlsToClose && urlsToClose.length > 0 && !urlsToClose.includes(url)) {
          continue;
        }
        
        // Sort tabs by last accessed time (most recent first)
        const sortedTabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        
        // Keep the first tab (most recently used), close the rest
        const tabsToClose = sortedTabs.slice(1);
        
        for (const tab of tabsToClose) {
          const closed = await this.safeCloseTab(tab.id, {
            title: tab.title,
            url: tab.url
          });
          if (closed) {
            closedCount++;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return closedCount;
    } catch (error) {
      console.error('Error closing duplicate tabs:', error);
      return 0;
    }
  }

  // Safe tab closing function with race condition protection
  async safeCloseTab(tabId, tabInfo = {}) {
    if (this.closingTabs.has(tabId) || this.recentlyClosedTabs.has(tabId)) {
      return false;
    }
    
    try {
      this.closingTabs.add(tabId);
      
      const tab = await chrome.tabs.get(tabId);
      if (!tab) return false;
      
      console.log('🗑️ Closing duplicate tab:', tabId, tabInfo.title || tabInfo.url || 'Unknown');
      await chrome.tabs.remove(tabId);
      
      this.recentlyClosedTabs.add(tabId);
      setTimeout(() => this.recentlyClosedTabs.delete(tabId), 5000);
      
      return true;
    } catch (error) {
      if (!error.message.includes('No tab with id')) {
        console.error('Error closing tab:', tabId, error.message);
      }
      return false;
    } finally {
      this.closingTabs.delete(tabId);
    }
  }

  // Get duplicate tab statistics
  getDuplicateStats() {
    const groupsData = [];
    let totalDuplicates = 0;
    
    this.duplicateGroups.forEach((tabs, url) => {
      const duplicateCount = tabs.length - 1;
      totalDuplicates += duplicateCount;
      
      groupsData.push({
        url,
        count: tabs.length,
        tabs: tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        }))
      });
    });

    return {
      totalDuplicates,
      duplicateGroups: this.duplicateGroups.size,
      groupsData: groupsData.sort((a, b) => b.count - a.count)
    };
  }
}

// Global duplicate manager instance
const duplicateManager = new DuplicateTabManager();

// Function to check and close duplicate tabs in real-time
async function checkAndCloseDuplicateTab(currentTab) {
  try {
    const allTabs = await chrome.tabs.query({});
    const normalizedCurrentUrl = duplicateManager.normalizeUrl(currentTab.url);
    
    const duplicateTabs = allTabs.filter(tab => {
      const isNotSameTab = tab.id !== currentTab.id;
      const hasSameUrl = duplicateManager.normalizeUrl(tab.url) === normalizedCurrentUrl;
      return isNotSameTab && hasSameUrl;
    });
    
    if (duplicateTabs.length > 0) {
      let successfullyClosed = 0;
      for (const duplicateTab of duplicateTabs) {
        const closed = await duplicateManager.safeCloseTab(duplicateTab.id, {
          title: duplicateTab.title,
          url: duplicateTab.url
        });
        if (closed) {
          successfullyClosed++;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      console.log(`🎉 Successfully closed ${successfullyClosed}/${duplicateTabs.length} duplicate tab(s)`);
    }
  } catch (error) {
    console.error('Error in auto duplicate detection:', error);
  }
}

// ==================================================
// AUTO-ARCHIVE FUNCTIONALITY
// ==================================================

async function updateTabLastActivity(tabId) {
  if (!tabId) return;
  try {
    const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
    const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
    activityData[tabId] = Date.now();
    await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
  } catch (error) {
    console.error("Error updating tab activity:", error);
  }
}

async function removeTabLastActivity(tabId) {
  if (!tabId) return;
  try {
    const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
    const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
    delete activityData[tabId];
    await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
  } catch (error) {
    console.error("Error removing tab activity:", error);
  }
}

async function setupAutoArchiveAlarm() {
  try {
    const settings = await Utils.getSettings();
    if (settings.autoArchiveEnabled && settings.autoArchiveIdleMinutes > 0) {
      const period = Math.max(1, settings.autoArchiveIdleMinutes / 2);
      await chrome.alarms.create(AUTO_ARCHIVE_ALARM_NAME, {
        periodInMinutes: period
      });
      console.log(`Auto-archive alarm set to run every ${period} minutes.`);
    } else {
      await chrome.alarms.clear(AUTO_ARCHIVE_ALARM_NAME);
      console.log("Auto-archive disabled, alarm cleared.");
    }
  } catch (error) {
    console.error("Error setting up auto-archive alarm:", error);
  }
}

async function runAutoArchiveCheck() {
  const settings = await Utils.getSettings();
  if (!settings.autoArchiveEnabled || settings.autoArchiveIdleMinutes <= 0) {
    return;
  }

  const idleThresholdMillis = settings.autoArchiveIdleMinutes * 60 * 1000;
  const now = Date.now();

  try {
    const activityResult = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
    const tabActivity = activityResult[TAB_ACTIVITY_STORAGE_KEY] || {};

    const tabGroupsResult = await chrome.storage.local.get('tabGroups');
    const tabGroups = tabGroupsResult.tabGroups || [];
    const bookmarkedUrls = new Set();
    
    tabGroups.forEach(tabGroup => {
      if (tabGroup.tabGroupBookmarks) {
        tabGroup.tabGroupBookmarks.forEach(bookmark => {
          if (typeof bookmark === 'string') {
            bookmarkedUrls.add(bookmark);
          } else if (bookmark && bookmark.url) {
            bookmarkedUrls.add(bookmark.url);
          }
        });
      }
    });

    const tabs = await chrome.tabs.query({ pinned: false });
    const tabsToArchive = [];

    for (const tab of tabs) {
      if (tab.audible || tab.active) {
        await updateTabLastActivity(tab.id);
        continue;
      }

      if (bookmarkedUrls.has(tab.url)) {
        await updateTabLastActivity(tab.id);
        continue;
      }

      const lastActivity = tabActivity[tab.id];

      if (!lastActivity || (now - lastActivity > idleThresholdMillis)) {
        try {
          await chrome.tabs.get(tab.id);
          tabsToArchive.push(tab);
        } catch (e) {
          await removeTabLastActivity(tab.id);
        }
      }
    }

    for (const tab of tabsToArchive) {
      const tabData = {
        url: tab.url,
        name: tab.title || tab.url,
        groupId: tab.groupId
      };

      if (tabData.groupId && tabData.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await Utils.addArchivedTab(tabData);
        await chrome.tabs.remove(tab.id);
        await removeTabLastActivity(tab.id);
      }
    }
  } catch (error) {
    console.error("Error during auto-archive check:", error);
  }
}

// ==================================================
// CHROME API EVENT LISTENERS
// ==================================================

// Configure Chrome side panel behavior
try {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  }).catch(error => console.error('Side panel behavior error:', error));
} catch (error) {
  console.error('Side panel API error:', error);
}

// Extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('🚀 Simba extension installed and ready!');
  
  setupAutoArchiveAlarm();
  
  if (chrome.contextMenus) {
    chrome.contextMenus.create({
      id: "openSimba",
      title: "Simba",
      contexts: ["all"]
    });
  }
});

// Chrome startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started. Setting up alarm.");
  setupAutoArchiveAlarm();
});

// Handle context menu clicks
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openSimba") {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}

// Log when commands are registered
console.log('🔑 Keyboard command listener registered');

// Track fullscreen state per window
const fullscreenState = new Map(); // windowId -> { wasFullscreen: boolean, previousState: string }

// Keyboard commands
chrome.commands.onCommand.addListener(async function(command) {
  console.log('🎹 Command received:', command);
  
  if (command === "toggleSidebarFullscreen") {
    console.log('🖥️ Toggle sidebar with fullscreen command');
    
    // Get current window info synchronously
    chrome.windows.getCurrent(async (currentWindow) => {
      try {
        const windowId = currentWindow.id;
        const isCurrentlyFullscreen = currentWindow.state === 'fullscreen';
        
        // Check if we have a tracked state for this window
        const tracked = fullscreenState.get(windowId);
        
        if (isCurrentlyFullscreen && tracked) {
          // We're in fullscreen mode that we created - revert everything
          console.log('🔄 Reverting to normal mode');
          
          // Disable the sidebar (this closes it)
          await chrome.sidePanel.setOptions({
            enabled: false
          });
          
          // Small delay to ensure sidebar closes
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Restore the previous window state
          await chrome.windows.update(windowId, { 
            state: tracked.previousState || 'normal' 
          });
          
          // Re-enable the sidebar for future use
          await chrome.sidePanel.setOptions({
            enabled: true
          });
          
          // Clear the tracking
          fullscreenState.delete(windowId);
          console.log('✅ Reverted to normal mode');
        } else {
          // Enter fullscreen + sidebar mode
          console.log('📂 Entering fullscreen + sidebar mode');
          
          // Save the current state before changing
          fullscreenState.set(windowId, {
            wasFullscreen: isCurrentlyFullscreen,
            previousState: currentWindow.state
          });
          
          // IMPORTANT: Open the sidebar FIRST, before ANY awaits
          // sidePanel.open() must be called immediately in response to user gesture
          await chrome.sidePanel.open({ windowId: windowId });
          console.log('📂 Sidebar opened');
          
          // Then make the window fullscreen (this doesn't require user gesture)
          await chrome.windows.update(windowId, { state: 'fullscreen' });
          console.log('✅ Window set to fullscreen');
        }
      } catch (error) {
        console.error('❌ Error toggling sidebar with fullscreen:', error);
      }
    });
  } else if (command === "toggleSidebarOnly") {
    console.log('🔀 Toggle sidebar only command');
    
    // Simple sidebar toggle without fullscreen
    chrome.windows.getCurrent(async (currentWindow) => {
      try {
        // Just toggle the sidebar
        await chrome.sidePanel.open({ windowId: currentWindow.id });
        console.log('📂 Sidebar toggled');
      } catch (error) {
        // If it's already open, this will fail - that's the "toggle off" behavior
        console.log('ℹ️ Sidebar toggle (may have closed):', error.message);
      }
    });
  } else if (command === "quickPinToggle") {
    console.log('📌 Quick pin toggle command');
    chrome.runtime.sendMessage({ command: "quickPinToggle" });
  } else if (command === "focusSidebarSearch") {
    // Focus the sidebar search using a persistent flag
    console.log('⌨️ Cmd+K pressed - setting focus flag');
    try {
      // Set a flag with timestamp
      await chrome.storage.local.set({ 
        cmdKPressed: true,
        cmdKTimestamp: Date.now()
      });
      console.log('✅ Focus flag set in storage');
      
      // Try to open the sidebar if it's not already open
      const windows = await chrome.windows.getAll();
      if (windows.length > 0) {
        const currentWindow = windows.find(w => w.focused) || windows[0];
        chrome.sidePanel.open({ windowId: currentWindow.id }).then(() => {
          console.log('📂 Sidebar opened');
        }).catch((err) => {
          console.log('ℹ️ Sidebar already open or error:', err.message);
        });
      }
      
      // Also send a message as backup
      chrome.runtime.sendMessage({ action: 'focusSidebarSearch' }).catch(() => {
        // Ignore errors if sidebar isn't ready
        console.log('Message to sidebar failed (sidebar may not be ready)');
      });
    } catch (error) {
      console.error('❌ Error handling Cmd+K:', error);
    }
  } else {
    console.log('❓ Unknown command received:', command);
  }
});

// Alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_ARCHIVE_ALARM_NAME) {
    await runAutoArchiveCheck();
  }
});

// Tab event listeners for DUPLICATE DETECTION
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.url && tab.url !== 'chrome://newtab/' && !tab.url.startsWith('chrome://')) {
    await checkAndCloseDuplicateTab(tab);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Handle duplicate detection
  if (changeInfo.url && tab.url && !tab.url.startsWith('chrome://')) {
    await checkAndCloseDuplicateTab(tab);
  }
  
  // Handle activity tracking for auto-archive
  if (changeInfo.status === 'complete' || changeInfo.audible !== undefined) {
    if (tab.active || tab.audible) {
      await updateTabLastActivity(tabId);
    }
  }
});

// Tab activation tracking
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateTabLastActivity(activeInfo.tabId);
});

// Tab removal cleanup
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await removeTabLastActivity(tabId);
});

// Storage changes listener
chrome.storage.onChanged.addListener((changes, areaName) => {
  const settingsChanged = ['autoArchiveEnabled', 'autoArchiveIdleMinutes'].some(key => key in changes);
  
  if ((areaName === 'sync' || areaName === 'local') && settingsChanged) {
    setupAutoArchiveAlarm();
  }
});

// Helper function to get all bookmarks recursively
async function getAllBookmarks() {
  const bookmarks = [];
  
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push({
          id: node.id,
          title: node.title,
          url: node.url
        });
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }
  
  const bookmarkTree = await chrome.bookmarks.getTree();
  traverse(bookmarkTree);
  return bookmarks;
}

// Message listener for both features
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action || message.command) {
        // Search popup actions
        case 'getTabs':
          const tabs = await chrome.tabs.query({});
          sendResponse(tabs);
          break;
          
        case 'getBookmarks':
          const bookmarks = await getAllBookmarks();
          sendResponse(bookmarks);
          break;
          
        case 'switchToTab':
          await chrome.tabs.update(message.tabId, { active: true });
          const tab = await chrome.tabs.get(message.tabId);
          await chrome.windows.update(tab.windowId, { focused: true });
          sendResponse({ success: true });
          break;
          
        case 'openUrl':
          await chrome.tabs.create({ url: message.url });
          sendResponse({ success: true });
          break;
        
        // Duplicate detection actions
        case 'findDuplicates':
          await duplicateManager.findDuplicateTabs();
          const stats = duplicateManager.getDuplicateStats();
          sendResponse({ success: true, data: stats });
          break;
          
        case 'closeAllDuplicates':
          const closedCount = await duplicateManager.closeDuplicates();
          sendResponse({ success: true, closedCount });
          break;
          
        case 'closeSpecificDuplicates':
          const specificClosedCount = await duplicateManager.closeDuplicates(message.urls);
          sendResponse({ success: true, closedCount: specificClosedCount });
          break;
        
        // Tab Group management actions
        case 'toggleTabGroupPin':
          chrome.runtime.sendMessage({ command: "toggleTabGroupPin", tabId: message.tabId });
          sendResponse({ success: true });
          break;
          
        case 'updateAutoArchiveSettings':
          setupAutoArchiveAlarm();
          sendResponse({ success: true });
          break;
          
        case 'quickPinToggle':
          chrome.runtime.sendMessage({ command: "quickPinToggle" });
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open for async responses
});

console.log('✨ Simba: One Extension to rule them all - initialized with duplicate detection, auto-archive, and search!');

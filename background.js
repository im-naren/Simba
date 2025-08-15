// Background service worker for nTabManager - EVENT-DRIVEN duplicate tab detection
// Only runs when:
// 1. User triggers manual scan from popup
// 2. New tab created with real URL
// 3. Tab URL changes
// No continuous background processing to prevent service worker issues

class DuplicateTabManager {
  constructor() {
    this.duplicateGroups = new Map();
  }

  // Find all duplicate tabs across all windows
  async findDuplicateTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      const urlGroups = new Map();
      
      // Group tabs by URL
      tabs.forEach(tab => {
        // Normalize URL by removing fragments and some query parameters
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

  // Normalize URL for comparison (remove fragments, some query params)
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove fragment
      urlObj.hash = '';
      
      // For some sites, we might want to remove specific query parameters
      // For now, keep all query parameters as they might be important
      
      return urlObj.toString();
    } catch (error) {
      // If URL parsing fails, return original URL
      return url;
    }
  }

  // Close duplicate tabs, keeping the most recently active one
  async closeDuplicates(urlsToClose = null) {
    try {
      let closedCount = 0;
      
      for (const [url, tabs] of this.duplicateGroups) {
        // If specific URLs are provided, only close those
        if (urlsToClose && urlsToClose.length > 0 && !urlsToClose.includes(url)) {
          continue;
        }
        
        // Sort tabs by last accessed time (most recent first)
        const sortedTabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        
        // Keep the first tab (most recently used), close the rest
        const tabsToClose = sortedTabs.slice(1);
        
        for (const tab of tabsToClose) {
          const closed = await safeCloseTab(tab.id, {
            title: tab.title,
            url: tab.url
          });
          if (closed) {
            closedCount++;
          }
          // Small delay between manual closures
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return closedCount;
    } catch (error) {
      console.error('Error closing duplicate tabs:', error);
      return 0;
    }
  }

  // Get duplicate tab statistics
  getDuplicateStats() {
    const groupsData = [];
    let totalDuplicates = 0;
    
    this.duplicateGroups.forEach((tabs, url) => {
      const duplicateCount = tabs.length - 1; // Subtract 1 for the original
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

// Global instance
const duplicateManager = new DuplicateTabManager();

// Global sets to track tab operations
const closingTabs = new Set();
const recentlyClosedTabs = new Set();

// Safe tab closing function with race condition protection
async function safeCloseTab(tabId, tabInfo = {}) {
  // Check if this tab is already being closed
  if (closingTabs.has(tabId)) {
    console.log(`⏭️ Tab ${tabId} already being closed, skipping`);
    return false;
  }
  
  // Check if this tab was recently closed
  if (recentlyClosedTabs.has(tabId)) {
    console.log(`⏭️ Tab ${tabId} was recently closed, skipping`);
    return false;
  }
  
  try {
    closingTabs.add(tabId);
    
    // Double-check the tab still exists
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      console.log(`⏭️ Tab ${tabId} no longer exists`);
      return false;
    }
    
    console.log('🗑️ Safely closing duplicate tab:', tabId, tabInfo.title || tabInfo.url || 'Unknown');
    await chrome.tabs.remove(tabId);
    
    // Track recently closed tabs to prevent double closure
    recentlyClosedTabs.add(tabId);
    setTimeout(() => recentlyClosedTabs.delete(tabId), 5000); // Clear after 5 seconds
    
    console.log(`✅ Successfully closed duplicate tab: ${tabInfo.title || tabInfo.url || tabId}`);
    return true;
  } catch (error) {
    if (error.message.includes('No tab with id')) {
      console.log(`⏭️ Tab ${tabId} was already closed: ${error.message}`);
    } else {
      console.error(`❌ Error closing tab ${tabId}:`, error.message);
    }
    return false;
  } finally {
    // Always remove from closing set
    closingTabs.delete(tabId);
  }
}

// Extension initialization
chrome.runtime.onInstalled.addListener(() => {
  console.log('🚀 nTabManager extension installed and ready!');
});

// Tab event listeners for duplicate detection only

// Event-driven tab listeners - only check duplicates when needed
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('📝 Tab created:', tab.id, tab.url);
  
  // Only check for duplicates if it's a real URL (not chrome:// or newtab)
  if (tab.url && tab.url !== 'chrome://newtab/' && !tab.url.startsWith('chrome://')) {
    console.log('🚨 New tab with real URL - checking for duplicates:', tab.url);
    await checkAndCloseDuplicateTab(tab);
  }
  

});

// Only check duplicates when URL actually changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when URL changes (not just loading status)
  if (changeInfo.url && tab.url && !tab.url.startsWith('chrome://')) {
    console.log('🔄 Tab URL changed - checking for duplicates:', tab.url);
    await checkAndCloseDuplicateTab(tab);
  }

});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
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
          
        case 'testAutoDetection':
          console.log('🧪 Manual duplicate detection test triggered by user');
          const allTabs = await chrome.tabs.query({});
          console.log('📊 Total tabs found:', allTabs.length);
          
          let duplicatesFound = 0;
          for (const tab of allTabs) {
            if (tab.url && !tab.url.startsWith('chrome://')) {
              const duplicates = allTabs.filter(t => 
                t.id !== tab.id && 
                duplicateManager.normalizeUrl(t.url) === duplicateManager.normalizeUrl(tab.url)
              );
              if (duplicates.length > 0) {
                console.log('🎯 Manual test found duplicates for:', tab.url, duplicates.length);
                duplicatesFound += duplicates.length;
              }
            }
          }
          
          console.log(`✅ Manual test completed: ${duplicatesFound} duplicates found`);
          sendResponse({ 
            success: true, 
            totalTabs: allTabs.length, 
            duplicatesFound: duplicatesFound 
          });
          break;
          
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  // Return true to indicate we'll respond asynchronously
  return true;
});

// Function to check and close duplicate tabs in real-time
async function checkAndCloseDuplicateTab(currentTab) {
  try {
    console.log('🔍 Starting duplicate check for tab:', currentTab.id, currentTab.url);
    const allTabs = await chrome.tabs.query({});
    console.log('📊 Total tabs found:', allTabs.length);
    
    const normalizedCurrentUrl = duplicateManager.normalizeUrl(currentTab.url);
    console.log('🔗 Normalized URL:', normalizedCurrentUrl);
    
    // Find all tabs with the same normalized URL
    const duplicateTabs = allTabs.filter(tab => {
      const isNotSameTab = tab.id !== currentTab.id;
      const hasSameUrl = duplicateManager.normalizeUrl(tab.url) === normalizedCurrentUrl;
      if (hasSameUrl && isNotSameTab) {
        console.log('🎯 Found duplicate:', tab.id, tab.url);
      }
      return isNotSameTab && hasSameUrl;
    });
    
    console.log(`📈 Found ${duplicateTabs.length} duplicate tabs to close`);
    
    if (duplicateTabs.length > 0) {
      // Close the older tabs (keeping the newest one)
      let successfullyClosed = 0;
      for (const duplicateTab of duplicateTabs) {
        const closed = await safeCloseTab(duplicateTab.id, {
          title: duplicateTab.title,
          url: duplicateTab.url
        });
        if (closed) {
          successfullyClosed++;
        }
        // Small delay between closures to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      console.log(`🎉 Successfully closed ${successfullyClosed}/${duplicateTabs.length} duplicate tab(s) for: ${currentTab.title || currentTab.url}`);
    } else {
      console.log('✨ No duplicates found for:', currentTab.url);
    }
  } catch (error) {
    console.error('❌ Error in auto duplicate detection:', error);
  }
} 

// Service worker ready - will only activate on events (tab creation, URL changes, user actions)
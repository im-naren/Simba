// Background service worker for nTabManager - duplicate tab detection and management

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
  async closeDuplicates(urlsToClose = []) {
    try {
      let closedCount = 0;
      
      for (const [url, tabs] of this.duplicateGroups) {
        // If specific URLs provided, only process those
        if (urlsToClose.length > 0 && !urlsToClose.includes(url)) {
          continue;
        }
        
        // Sort tabs by last accessed time (most recent first)
        const sortedTabs = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        
        // Keep the first tab (most recently accessed), close the rest
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
    let totalDuplicates = 0;
    let duplicateGroups = 0;
    
    this.duplicateGroups.forEach(tabs => {
      duplicateGroups++;
      totalDuplicates += tabs.length - 1; // -1 because we keep one tab per group
    });
    
    return {
      totalDuplicates,
      duplicateGroups,
      groupsData: Array.from(this.duplicateGroups.entries()).map(([url, tabs]) => ({
        url,
        count: tabs.length,
        tabs: tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          lastAccessed: tab.lastAccessed
        }))
      }))
    };
  }
}

// Global instance
const duplicateManager = new DuplicateTabManager();

// Global tracking to prevent duplicate closure attempts
const closingTabs = new Set();
const recentlyClosedTabs = new Set();

// Helper function to safely close a tab
async function safeCloseTab(tabId, tabInfo = {}) {
  // Check if we're already closing this tab
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
    // Mark tab as being closed
    closingTabs.add(tabId);
    
    // Verify tab still exists before closing
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      console.log(`⏭️ Tab ${tabId} no longer exists`);
      return false;
    }
    
    console.log('🗑️ Safely closing duplicate tab:', tabId, tabInfo.title || tabInfo.url || 'Unknown');
    await chrome.tabs.remove(tabId);
    
    // Mark as recently closed to prevent future attempts
    recentlyClosedTabs.add(tabId);
    setTimeout(() => recentlyClosedTabs.delete(tabId), 5000); // Clean up after 5 seconds
    
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

// More aggressive real-time duplicate checking
let realtimeCheckEnabled = true;

async function aggressiveRealTimeCheck() {
  if (!realtimeCheckEnabled) return;
  
  try {
    const allTabs = await chrome.tabs.query({});
    const realTabs = allTabs.filter(tab => 
      tab.url && !tab.url.startsWith('chrome://') && tab.url !== 'chrome://newtab/'
    );
    
    if (realTabs.length < 2) {
      setTimeout(aggressiveRealTimeCheck, 2000);
      return;
    }
    
    const urlGroups = new Map();
    realTabs.forEach(tab => {
      const normalizedUrl = duplicateManager.normalizeUrl(tab.url);
      if (!urlGroups.has(normalizedUrl)) {
        urlGroups.set(normalizedUrl, []);
      }
      urlGroups.get(normalizedUrl).push(tab);
    });
    
    // Find and close duplicates immediately
    let duplicatesFound = false;
    for (const [url, tabs] of urlGroups) {
      if (tabs.length > 1) {
        duplicatesFound = true;
        console.log(`🎯 REALTIME: Found ${tabs.length} tabs for ${url}`);
        
        // Sort by ID (creation time), keep the newest (highest ID)
        const sortedTabs = tabs.sort((a, b) => a.id - b.id);
        const tabsToClose = sortedTabs.slice(0, -1); // Close all but the newest
        
        let realtimeClosed = 0;
        for (const tab of tabsToClose) {
          const closed = await safeCloseTab(tab.id, {
            title: tab.title,
            url: tab.url
          });
          if (closed) {
            realtimeClosed++;
          }
          // Small delay between closures
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`✅ REALTIME closed ${realtimeClosed}/${tabsToClose.length} duplicates for ${url}`);
      }
    }
    
    if (duplicatesFound) {
      console.log('🚀 Realtime duplicate cleanup completed');
    }
    
  } catch (error) {
    console.error('❌ Error in realtime duplicate check:', error);
  }
  
  // Check again less frequently to reduce race conditions
  setTimeout(aggressiveRealTimeCheck, 2000); // Check every 2 seconds (reduced frequency)
}

// Start aggressive real-time checking immediately
aggressiveRealTimeCheck();

// Nuclear option: Immediate duplicate cleanup function
async function immediateCleanup(triggerReason = 'unknown') {
  console.log(`🔥 NUCLEAR CLEANUP triggered by: ${triggerReason}`);
  
  try {
    const allTabs = await chrome.tabs.query({});
    console.log(`📊 Total tabs: ${allTabs.length}`);
    
    // Group by normalized URL
    const urlMap = new Map();
    allTabs.forEach(tab => {
      if (tab.url && !tab.url.startsWith('chrome://') && tab.url !== 'chrome://newtab/') {
        const normalizedUrl = duplicateManager.normalizeUrl(tab.url);
        if (!urlMap.has(normalizedUrl)) {
          urlMap.set(normalizedUrl, []);
        }
        urlMap.get(normalizedUrl).push(tab);
      }
    });
    
    // Close duplicates immediately
    for (const [url, tabs] of urlMap) {
      if (tabs.length > 1) {
        console.log(`🎯 NUCLEAR: ${tabs.length} tabs for ${url}`);
        
        // Keep the tab with highest ID (newest)
        const sortedTabs = tabs.sort((a, b) => b.id - a.id);
        const tabsToClose = sortedTabs.slice(1); // Close all except the first (newest)
        
        console.log(`🗑️ NUCLEAR: Closing ${tabsToClose.length} duplicate tabs`);
        
        let nuclearClosed = 0;
        for (const tab of tabsToClose) {
          const closed = await safeCloseTab(tab.id, {
            title: tab.title,
            url: tab.url
          });
          if (closed) {
            nuclearClosed++;
          }
          // Longer delay for nuclear cleanup to be more gentle
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        console.log(`💥 NUCLEAR closed ${nuclearClosed}/${tabsToClose.length} duplicates for ${url}`);
      }
    }
  } catch (error) {
    console.error('❌ Nuclear cleanup failed:', error);
  }
}

// Add nuclear cleanup to tab events with cooldown
let lastNuclearCleanup = 0;
const NUCLEAR_COOLDOWN = 3000; // 3 seconds between nuclear cleanups

function triggerNuclearCleanup(reason) {
  const now = Date.now();
  if (now - lastNuclearCleanup < NUCLEAR_COOLDOWN) {
    console.log(`⏱️ Nuclear cleanup on cooldown, skipping: ${reason}`);
    return;
  }
  lastNuclearCleanup = now;
  setTimeout(() => immediateCleanup(reason), 200);
}

chrome.tabs.onActivated.addListener(() => {
  triggerNuclearCleanup('tab activated');
});

chrome.tabs.onAttached.addListener(() => {
  triggerNuclearCleanup('tab attached');
});

chrome.tabs.onDetached.addListener(() => {
  triggerNuclearCleanup('tab detached');
});

// Keep service worker alive
setInterval(() => {
  console.log('💗 Service worker heartbeat');
}, 20000);

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
          const allTabs = await chrome.tabs.query({});
          console.log('🧪 Manual auto-detection test - Total tabs:', allTabs.length);
          
          let duplicatesFound = 0;
          for (const tab of allTabs) {
            if (tab.url && !tab.url.startsWith('chrome://')) {
              console.log('🔍 Testing tab:', tab.id, tab.url);
              const normalizedUrl = duplicateManager.normalizeUrl(tab.url);
              const duplicates = allTabs.filter(t => 
                t.id !== tab.id && 
                duplicateManager.normalizeUrl(t.url) === normalizedUrl
              );
              if (duplicates.length > 0) {
                console.log('🎯 Found duplicates for:', tab.url, duplicates.length);
                duplicatesFound += duplicates.length;
              }
            }
          }
          
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

// Auto-detect and close duplicates when tabs are created/updated
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('🔍 Tab created:', tab.id, 'URL:', tab.url, 'Status:', tab.status);
  
  // Trigger aggressive checker with slight delay to avoid conflicts
  setTimeout(aggressiveRealTimeCheck, 500);
  
  // Also do direct check if we have a real URL
  if (tab.url && tab.url !== 'chrome://newtab/' && !tab.url.startsWith('chrome://')) {
    console.log('🚨 IMMEDIATE check for newly created tab:', tab.url);
    setTimeout(async () => {
      await checkAndCloseDuplicateTab(tab);
    }, 300);
  } else {
    console.log('⏭️ Skipping tab (chrome:// or newtab):', tab.url);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log('🔄 Tab updated:', tabId, 'ChangeInfo:', changeInfo, 'Tab URL:', tab.url);
  
  // Trigger immediate check on any significant change
  if ((changeInfo.status === 'complete' || changeInfo.url) && 
      tab.url && !tab.url.startsWith('chrome://') && tab.url !== 'chrome://newtab/') {
    console.log('🚨 IMMEDIATE duplicate check triggered for:', tab.url);
    
    // Immediate check without delay
    await checkAndCloseDuplicateTab(tab);
    
    // Also trigger the aggressive checker with delay to avoid conflicts
    setTimeout(aggressiveRealTimeCheck, 300);
  }
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
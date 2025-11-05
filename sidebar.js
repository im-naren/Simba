import { ChromeHelper } from './chromeHelper.js';
import { FOLDER_CLOSED_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
import { setupDOMElements, showTabGroupNameInput, activateTabInDOM, activateTabGroupInDOM, showTabContextMenu, showArchivedTabsPopup } from './domManager.js';

// Constants
const MouseButton = {
    LEFT: 0,
    MIDDLE: 1,
    RIGHT: 2
};

// DOM Elements - These will be initialized after DOM is ready
let tabGroupsList = null;
let tabGroupSwitcher = null;
let addTabGroupBtn = null;
let newTabBtn = null;
let tabGroupTemplate = null;

// Global state
let tabGroups = [];
let activeGroupId = null;
let isCreatingTabGroup = false;
let isOpeningBookmark = false;
let isDraggingTab = false;
let currentWindow = null;
let defaultTabGroupName = 'Home';
let isTreeViewMode = false;
let treeViewStates = {}; // Store tree view state per tabGroup
let treeViewRenderTimeout = null; // Debounce tree view renders
let favorites = []; // Store favorite tabs
let hideDuplicates = false; // Hide duplicate tabs and bookmarks
let twoLevelHierarchy = false; // Enable 2-level hierarchy in tree view

// Helper function to update bookmark for a tab
async function updateBookmarkForTab(tab, bookmarkTitle) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

    for (const tabGroupFolder of tabGroupFolders) {
        const bookmarks = await chrome.bookmarks.getChildren(tabGroupFolder.id);
        const bookmark = bookmarks.find(b => b.url === tab.url);
        if (bookmark) {
            await chrome.bookmarks.update(bookmark.id, {
                title: bookmarkTitle,
                url: tab.url
            });
        }
    }

}

// ==================================================
// FAVORITES MANAGEMENT - Clean Implementation
// ==================================================

let renderFavoritesTimeout = null;
let isRenderingFavorites = false;
let showDefaultFavorites = true; // Show default favorites by default
let favoriteAppsVisibility = {}; // Visibility state for each default app

// Default favorites that are always available
const DEFAULT_FAVORITES = [
    {
        url: 'https://github.com',
        title: 'GitHub',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Gmail',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://calendar.google.com/calendar',
        title: 'Google Calendar',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://myapps.microsoft.com',
        title: 'Microsoft Apps',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://app.devrev.ai',
        title: 'DevRev',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://app5.greenhouse.io',
        title: 'Greenhouse',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://www.linkedin.com',
        title: 'LinkedIn',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://chatgpt.com',
        title: 'ChatGPT',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://www.notion.so',
        title: 'Notion',
        isDefault: true,
        addedAt: 0
    },
    {
        url: 'https://slack.com',
        title: 'Slack',
        isDefault: true,
        addedAt: 0
    }
];

// Helper function to get reliable favicon URL (bypasses CORS issues)
function getReliableFaviconUrl(url, tabFavIconUrl = null, forceFresh = false) {
    try {
        // Parse the URL
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        
        // Skip invalid URLs
        if (!hostname || hostname === 'localhost' || hostname.startsWith('127.0.0.1')) {
            console.warn('⚠️ Invalid hostname for favicon:', hostname);
            return getGenericFaviconDataUrl();
        }
        
        // First, try to use the tab's favicon if it's valid and HTTP(S) and not forcing fresh
        if (!forceFresh && tabFavIconUrl && 
            !tabFavIconUrl.includes('chrome://') && 
            !tabFavIconUrl.includes('chrome-extension://') &&
            (tabFavIconUrl.startsWith('http://') || tabFavIconUrl.startsWith('https://'))) {
            console.log('✅ Using tab favicon for:', hostname);
            return tabFavIconUrl;
        }
        
        // Use Google's favicon service - reliable and CORS-free
        // Use size 128 for better quality, add timestamp for cache busting when forcing fresh
        const size = 128;
        const timestamp = forceFresh ? `&t=${Date.now()}` : '';
        console.log('🌐 Using Google favicon service for:', hostname);
        return `https://www.google.com/s2/favicons?sz=${size}&domain_url=${encodeURIComponent(url)}${timestamp}`;
    } catch (error) {
        console.error('❌ Error parsing URL for favicon:', url, error);
        return getGenericFaviconDataUrl();
    }
}

// Get fallback favicon URL using alternative method
function getFallbackFaviconUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        // Try favicon.io service as alternative (more reliable)
        return `https://favicon.io/favicon/${hostname}`;
    } catch (error) {
        return getGenericFaviconDataUrl();
    }
}

// Generic globe icon as data URL (SVG)
function getGenericFaviconDataUrl() {
    // A simple globe/world icon as SVG data URL
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

// Load favorites from storage
async function loadFavorites() {
    try {
        const result = await chrome.storage.local.get(['favorites', 'favoritesLastSaved', 'showDefaultFavorites', 'favoriteAppsVisibility']);
        favorites = result.favorites || [];
        
        // Load app visibility (default all visible)
        favoriteAppsVisibility = result.favoriteAppsVisibility || {};
        
        // Always show default favorites (we control visibility per-app now)
        showDefaultFavorites = true;
        if (result.showDefaultFavorites === false) {
            // Migrate old setting - if it was hidden, hide all apps instead
            console.log('⚠️ Migrating old showDefaultFavorites=false setting');
            DEFAULT_FAVORITES.forEach(app => {
                if (favoriteAppsVisibility[app.url] === undefined) {
                    favoriteAppsVisibility[app.url] = false;
                }
            });
        }
        
        // Initialize visibility for any new apps
        let needsSave = false;
        DEFAULT_FAVORITES.forEach(app => {
            if (favoriteAppsVisibility[app.url] === undefined) {
                favoriteAppsVisibility[app.url] = true;
                needsSave = true;
            }
        });
        
        // Save initialized values if needed
        if (needsSave) {
            await saveFavoriteAppsVisibility();
        }
        
        console.log('✅ Loaded favorites:', favorites.length, 'items');
        await renderFavoritesDebounced();
    } catch (error) {
        console.error('❌ Error loading favorites:', error);
        favorites = [];
    }
}


// Save favorites to storage (without triggering re-render)
async function saveFavorites() {
    try {
        const timestamp = new Date().toISOString();
        await chrome.storage.local.set({ 
            favorites: [...favorites], // Create copy to avoid reference issues
            favoritesLastSaved: timestamp 
        });
        console.log('✅ Saved favorites:', favorites.length, 'items');
    } catch (error) {
        console.error('❌ Error saving favorites:', error);
    }
}

// Add tab to favorites
async function addToFavorites(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        
        // Check if already in favorites (by URL)
        if (favorites.some(f => f.url === tab.url)) {
            console.log('Tab already in favorites');
            return false;
        }
        
        // Get reliable favicon URL
        const favIconUrl = getReliableFaviconUrl(tab.url, tab.favIconUrl);
        
        // Add to favorites
        favorites.push({
            url: tab.url,
            title: tab.title,
            favIconUrl: favIconUrl,
            addedAt: Date.now()
        });
        
        await saveFavorites();
        await renderFavoritesDebounced();
        console.log('✅ Added to favorites:', tab.title);
        return true;
    } catch (error) {
        console.error('❌ Error adding to favorites:', error);
        return false;
    }
}

// Add URL directly to favorites (without requiring a tab)
async function addUrlToFavorites(url, title = null) {
    try {
        // Validate URL
        const urlObj = new URL(url);
        
        // Check if already in favorites
        if (favorites.some(f => f.url === url)) {
            console.log('URL already in favorites');
            return false;
        }
        
        // Get favicon URL using Google's service
        const hostname = urlObj.hostname;
        const favIconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
        
        // Use provided title or hostname as fallback
        const favoriteTitle = title || hostname;
        
        // Add to favorites
        favorites.push({
            url: url,
            title: favoriteTitle,
            favIconUrl: favIconUrl,
            addedAt: Date.now()
        });
        
        await saveFavorites();
        await renderFavoritesDebounced();
        console.log('✅ Added URL to favorites:', favoriteTitle);
        return true;
    } catch (error) {
        console.error('❌ Error adding URL to favorites:', error);
        return false;
    }
}

// Remove from favorites
async function removeFromFavorites(url) {
    try {
        const index = favorites.findIndex(f => f.url === url);
        if (index === -1) {
            console.warn('Favorite not found:', url);
            return false;
        }
        
        favorites.splice(index, 1);
        await saveFavorites();
        await renderFavoritesDebounced();
        console.log('✅ Removed from favorites');
        return true;
    } catch (error) {
        console.error('❌ Error removing favorite:', error);
        return false;
    }
}

// Check if tab is in favorites
function isInFavorites(url) {
    return favorites.some(f => f.url === url);
}

// Debounced render to prevent multiple rapid re-renders
function renderFavoritesDebounced(delay = 100) {
    if (renderFavoritesTimeout) {
        clearTimeout(renderFavoritesTimeout);
    }
    
    return new Promise((resolve) => {
        renderFavoritesTimeout = setTimeout(async () => {
            await renderFavorites();
            resolve();
        }, delay);
    });
}

// Render favorites list (pure rendering, no data modification)
async function renderFavorites() {
    // Prevent concurrent renders
    if (isRenderingFavorites) {
        console.log('⏳ Render already in progress, skipping');
        return;
    }
    
    isRenderingFavorites = true;
    
    try {
        const favoritesList = document.getElementById('favoritesList');
        if (!favoritesList) {
            console.warn('Favorites list element not found');
            return;
        }
        
        // Clear existing content
        favoritesList.innerHTML = '';
        
        // Combine default favorites with user favorites
        let allFavorites = [];
        if (showDefaultFavorites) {
            // Add default favorites with FRESH favicon URLs (only if visible)
            const visibleDefaults = DEFAULT_FAVORITES.filter(fav => favoriteAppsVisibility[fav.url] !== false);
            
            allFavorites = visibleDefaults.map(fav => ({
                ...fav,
                favIconUrl: getReliableFaviconUrl(fav.url, null, true) // forceFresh = true for defaults
            }));
            
            console.log('✅ Visible default favorites:', visibleDefaults.length, 'of', DEFAULT_FAVORITES.length);
        }
        
        // Add user favorites (filter out any that match default URLs)
        const defaultUrls = DEFAULT_FAVORITES.map(f => f.url);
        const userFavorites = favorites.filter(f => !defaultUrls.includes(f.url));
        allFavorites = [...allFavorites, ...userFavorites];
        
        // Show empty message if no favorites
        if (allFavorites.length === 0) {
            const noFavoritesMsg = document.createElement('div');
            noFavoritesMsg.className = 'no-favorites-message';
            noFavoritesMsg.textContent = 'No favorites yet. Right-click a tab to add it to favorites.';
            favoritesList.appendChild(noFavoritesMsg);
            return;
        }
        
        // Get current tabs for active state (optional, won't block render)
        let allTabs = [];
        let activeTabUrl = null;
        try {
            allTabs = await Promise.race([
                chrome.tabs.query({}),
                new Promise((_, reject) => setTimeout(() => reject('Timeout'), 1000))
            ]);
            const activeTab = allTabs.find(t => t.active);
            activeTabUrl = activeTab?.url;
        } catch (error) {
            console.warn('Could not fetch tabs for active state:', error);
        }
        
        // Render each favorite
        for (const favorite of allFavorites) {
            const favoriteItem = createFavoriteElement(favorite, activeTabUrl);
            favoritesList.appendChild(favoriteItem);
        }
        
        console.log('✅ Rendered', allFavorites.length, 'favorites');
    } catch (error) {
        console.error('❌ Error rendering favorites:', error);
    } finally {
        isRenderingFavorites = false;
    }
}

// Lightweight update of active state (doesn't re-render everything)
function updateFavoritesActiveState() {
    const favoritesList = document.getElementById('favoritesList');
    if (!favoritesList || favorites.length === 0) return;
    
    // Get active tab
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length === 0) return;
        const activeTabUrl = tabs[0].url;
        
        // Update active class on favorite items
        const favoriteItems = favoritesList.querySelectorAll('.favorite-item');
        favoriteItems.forEach(item => {
            if (item.dataset.url === activeTabUrl) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }).catch(error => {
        console.error('Error updating favorites active state:', error);
    });
}

// Create a single favorite element (extracted for clarity)
function createFavoriteElement(favorite, activeTabUrl = null) {
    const favoriteItem = document.createElement('div');
    favoriteItem.className = 'favorite-item';
    favoriteItem.dataset.url = favorite.url;
    
    // Add active class if this is the current tab
    if (activeTabUrl && favorite.url === activeTabUrl) {
        favoriteItem.classList.add('active');
    }
    
    // Favicon - with robust error handling and multiple fallbacks
    const favicon = document.createElement('img');
    favicon.className = 'favorite-favicon';
    
    // If this is a default favorite and favIconUrl is already set, use it
    // Otherwise generate the URL (for user favorites, use their cached favIconUrl)
    if (favorite.favIconUrl) {
        favicon.src = favorite.favIconUrl;
    } else {
        favicon.src = getReliableFaviconUrl(favorite.url, null, false);
    }
    
    favicon.alt = favorite.title;
    
    // Robust error handling with fallback strategies (no CORS issues)
    let errorHandled = false;
    let fallbackAttempted = false;
    
    favicon.onerror = () => {
        if (errorHandled) return;
        
        if (!fallbackAttempted) {
            // First fallback: Try alternative favicon service
            fallbackAttempted = true;
            console.warn('⚠️ Primary favicon failed for:', favorite.url, 'Trying fallback service');
            setTimeout(() => {
                favicon.src = getFallbackFaviconUrl(favorite.url);
            }, 50);
        } else {
            // Final fallback: Use generic icon
            errorHandled = true;
            console.warn('⚠️ All favicon sources failed for:', favorite.url, 'Using generic icon');
            favicon.src = getGenericFaviconDataUrl();
        }
    };
    
    // Handle successful loads
    favicon.onload = () => {
        console.log('✅ Favicon loaded successfully for:', favorite.title);
    };
    
    // Title (shown on hover)
    const title = document.createElement('div');
    title.className = 'favorite-title';
    title.textContent = favorite.title;
    title.title = `${favorite.title}\n${favorite.url}`;
    
    // Remove button (only for user-added favorites, not defaults)
    const removeBtn = document.createElement('button');
    removeBtn.className = 'favorite-remove';
    
    if (favorite.isDefault) {
        // For default favorites, show as less prominent
        favoriteItem.classList.add('favorite-default');
        removeBtn.style.display = 'none'; // Don't show remove button for defaults
    } else {
        removeBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        removeBtn.title = 'Remove from favorites';
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            await removeFromFavorites(favorite.url);
        });
    }
    
    // Click handler - open and pin, or pin existing, or switch to pinned
    favoriteItem.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            // Check ALL windows for existing tabs to prevent duplicates
            const tabs = await chrome.tabs.query({});
            
            // Special handling for Gmail and Calendar - find tabs with URLs starting with these patterns
            let existingTab = null;
            if (favorite.url.startsWith('https://mail.google.com/mail')) {
                existingTab = tabs.find(t => t.url && t.url.startsWith('https://mail.google.com/mail'));
            } else if (favorite.url.startsWith('https://calendar.google.com/calendar')) {
                existingTab = tabs.find(t => t.url && t.url.startsWith('https://calendar.google.com/calendar'));
            } else {
                existingTab = tabs.find(t => t.url === favorite.url);
            }
            
            if (existingTab) {
                // Tab exists - pin it if not pinned, and switch to it
                if (!existingTab.pinned) {
                    await chrome.tabs.update(existingTab.id, { pinned: true });
                    console.log('✅ Pinned existing tab:', favorite.title);
                }
                // Always switch to the tab and focus its window
                await chrome.tabs.update(existingTab.id, { active: true });
                await chrome.windows.update(existingTab.windowId, { focused: true });
                console.log('✅ Switched to favorite:', favorite.title);
            } else {
                // Tab doesn't exist - create it as pinned from the start
                const currentWindow = await chrome.windows.getCurrent();
                const newTab = await chrome.tabs.create({ 
                    url: favorite.url, 
                    active: true,
                    pinned: true,
                    windowId: currentWindow.id  // Create in current window
                });
                console.log('✅ Opened and pinned favorite:', favorite.title);
            }
        } catch (error) {
            console.error('❌ Error opening favorite:', error);
        }
    });
    
    // Right-click handler for editing URL (not for default favorites)
    favoriteItem.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Don't allow editing default favorites
        if (favorite.isDefault) {
            return;
        }
        
        await showEditFavoriteDialog(favorite);
    });
    
    // Assemble the favorite item
    favoriteItem.appendChild(favicon);
    favoriteItem.appendChild(title);
    favoriteItem.appendChild(removeBtn);
    
    return favoriteItem;
}

// Show edit dialog for favorite URL
async function showEditFavoriteDialog(favorite) {
    const newUrl = prompt('Edit URL for ' + favorite.title, favorite.url);
    
    if (newUrl === null) {
        // User cancelled
        return;
    }
    
    if (!newUrl || newUrl.trim() === '') {
        alert('URL cannot be empty');
        return;
    }
    
    // Validate URL
    try {
        new URL(newUrl);
    } catch (error) {
        alert('Invalid URL format');
        return;
    }
    
    // Update the favorite
    await editFavoriteUrl(favorite.url, newUrl.trim());
}

// Edit favorite URL
async function editFavoriteUrl(oldUrl, newUrl) {
    try {
        const favoriteIndex = favorites.findIndex(f => f.url === oldUrl);
        if (favoriteIndex === -1) {
            console.warn('Favorite not found:', oldUrl);
            return false;
        }
        
        // Check if new URL already exists in favorites
        if (favorites.some(f => f.url === newUrl)) {
            alert('This URL is already in your favorites');
            return false;
        }
        
        // Update the URL and refresh favicon
        favorites[favoriteIndex].url = newUrl;
        favorites[favoriteIndex].favIconUrl = getReliableFaviconUrl(newUrl);
        
        await saveFavorites();
        await renderFavoritesDebounced();
        console.log('✅ Updated favorite URL from', oldUrl, 'to', newUrl);
        return true;
    } catch (error) {
        console.error('❌ Error editing favorite URL:', error);
        return false;
    }
}

// ==================================================
// FAVORITES SETTINGS PANEL
// ==================================================

// Toggle favorites settings panel
function toggleFavoritesSettingsPanel() {
    const panel = document.getElementById('favoritesSettingsPanel');
    if (panel) {
        const isVisible = panel.classList.contains('visible');
        if (isVisible) {
            panel.classList.remove('visible');
        } else {
            panel.classList.add('visible');
            renderFavoritesSettingsPanel();
        }
    }
}

// Render favorites settings panel with app toggles
function renderFavoritesSettingsPanel() {
    const appsList = document.getElementById('favoritesAppsList');
    if (!appsList) return;
    
    appsList.innerHTML = '';
    
    DEFAULT_FAVORITES.forEach(app => {
        const appItem = document.createElement('div');
        appItem.className = 'favorites-app-item';
        
        const appInfo = document.createElement('div');
        appInfo.className = 'favorites-app-info';
        
        // App icon
        const appIcon = document.createElement('img');
        appIcon.className = 'favorites-app-icon';
        appIcon.src = getReliableFaviconUrl(app.url);
        appIcon.onerror = () => { appIcon.src = getGenericFaviconDataUrl(); };
        
        // App name
        const appName = document.createElement('span');
        appName.className = 'favorites-app-name';
        appName.textContent = app.title;
        
        appInfo.appendChild(appIcon);
        appInfo.appendChild(appName);
        
        // Toggle switch
        const toggleContainer = document.createElement('label');
        toggleContainer.className = 'favorites-app-toggle';
        
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = favoriteAppsVisibility[app.url] !== false;
        toggleInput.addEventListener('change', async () => {
            favoriteAppsVisibility[app.url] = toggleInput.checked;
            await saveFavoriteAppsVisibility();
            await renderFavoritesDebounced();
        });
        
        const toggleSlider = document.createElement('span');
        toggleSlider.className = 'toggle-slider';
        
        toggleContainer.appendChild(toggleInput);
        toggleContainer.appendChild(toggleSlider);
        
        appItem.appendChild(appInfo);
        appItem.appendChild(toggleContainer);
        appsList.appendChild(appItem);
    });
}

// Save app visibility preferences
async function saveFavoriteAppsVisibility() {
    try {
        await chrome.storage.local.set({ favoriteAppsVisibility });
        console.log('✅ Saved favorites app visibility');
    } catch (error) {
        console.error('❌ Error saving favorites app visibility:', error);
    }
}

// Debug helper - accessible from console
window.debugFavorites = function() {
    console.log('=== FAVORITES DEBUG INFO ===');
    console.log('showDefaultFavorites:', showDefaultFavorites);
    console.log('favoriteAppsVisibility:', favoriteAppsVisibility);
    console.log('favorites array:', favorites);
    console.log('DEFAULT_FAVORITES:', DEFAULT_FAVORITES);
    console.log('Visible apps:', DEFAULT_FAVORITES.filter(fav => favoriteAppsVisibility[fav.url] !== false).map(f => f.title));
    console.log('Hidden apps:', DEFAULT_FAVORITES.filter(fav => favoriteAppsVisibility[fav.url] === false).map(f => f.title));
};

// ==================================================
// BOOKMARKS PANEL
// ==================================================

// Toggle bookmarks panel with carousel effect
function toggleBookmarksPanel() {
    const panel = document.getElementById('bookmarksPanel');
    const sidebarContainer = document.getElementById('sidebar-container');
    
    if (panel && sidebarContainer) {
        const isVisible = panel.classList.contains('visible');
        if (isVisible) {
            // Close panel - remove carousel effect
            panel.classList.remove('visible');
            sidebarContainer.classList.remove('panel-open');
        } else {
            // Open panel - add carousel effect
            panel.classList.add('visible');
            sidebarContainer.classList.add('panel-open');
            renderBookmarksPanel();
        }
    }
}

// Render bookmarks in the side panel
async function renderBookmarksPanel() {
    const bookmarksList = document.getElementById('bookmarksPanelList');
    if (!bookmarksList) return;
    
    bookmarksList.innerHTML = '<div style="padding: 12px; color: var(--text-secondary); font-size: 12px;">Loading bookmarks...</div>';
    
    try {
        // Get the bookmarks tree
        const bookmarksTree = await chrome.bookmarks.getTree();
        bookmarksList.innerHTML = '';
        
        // Render each root folder
        if (bookmarksTree && bookmarksTree[0] && bookmarksTree[0].children) {
            bookmarksTree[0].children.forEach(rootNode => {
                if (rootNode.children) {
                    renderBookmarkNode(rootNode, bookmarksList, 0);
                }
            });
        }
        
        console.log('✅ Rendered bookmarks panel');
    } catch (error) {
        console.error('❌ Error loading bookmarks:', error);
        bookmarksList.innerHTML = '<div style="padding: 12px; color: var(--text-secondary); font-size: 12px;">Error loading bookmarks</div>';
    }
}

// Render a single bookmark node (folder or bookmark)
function renderBookmarkNode(node, parentElement, depth) {
    if (node.url) {
        // It's a bookmark (not a folder)
        const bookmarkItem = document.createElement('a');
        bookmarkItem.className = 'bookmark-panel-item';
        bookmarkItem.href = node.url;
        bookmarkItem.target = '_blank';
        bookmarkItem.style.marginLeft = `${depth * 16}px`;
        
        // Favicon
        const favicon = document.createElement('img');
        favicon.className = 'bookmark-panel-icon';
        favicon.src = `chrome://favicon/${node.url}`;
        favicon.onerror = () => { favicon.src = getGenericFaviconDataUrl(); };
        
        // Title
        const title = document.createElement('span');
        title.className = 'bookmark-panel-title';
        title.textContent = node.title || 'Untitled';
        
        bookmarkItem.appendChild(favicon);
        bookmarkItem.appendChild(title);
        
        // Click handler
        bookmarkItem.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: node.url, active: true });
        });
        
        parentElement.appendChild(bookmarkItem);
    } else if (node.children) {
        // It's a folder
        const folderContainer = document.createElement('div');
        folderContainer.className = 'bookmark-panel-folder';
        folderContainer.style.marginLeft = `${depth * 16}px`;
        
        // Folder header
        const folderHeader = document.createElement('div');
        folderHeader.className = 'bookmark-panel-folder-header';
        
        // Toggle icon
        const toggle = document.createElement('div');
        toggle.className = 'bookmark-panel-folder-toggle';
        toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>`;
        
        // Folder icon
        const folderIconWrapper = document.createElement('div');
        folderIconWrapper.style.width = '16px';
        folderIconWrapper.style.height = '16px';
        folderIconWrapper.style.flexShrink = '0';
        folderIconWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="bookmark-panel-folder-icon"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
        
        // Folder name
        const folderName = document.createElement('span');
        folderName.className = 'bookmark-panel-folder-name';
        folderName.textContent = node.title || 'Unnamed Folder';
        
        folderHeader.appendChild(toggle);
        folderHeader.appendChild(folderIconWrapper);
        folderHeader.appendChild(folderName);
        
        // Children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'bookmark-panel-folder-children';
        
        // Render children
        node.children.forEach(child => {
            renderBookmarkNode(child, childrenContainer, depth + 1);
        });
        
        // Toggle functionality
        folderHeader.addEventListener('click', () => {
            const isCollapsed = childrenContainer.classList.toggle('collapsed');
            toggle.classList.toggle('collapsed', isCollapsed);
        });
        
        folderContainer.appendChild(folderHeader);
        folderContainer.appendChild(childrenContainer);
        parentElement.appendChild(folderContainer);
    }
}

// Load and display bookmarks
async function loadBookmarks(groupId) {
    console.log('Loading bookmarks for tabGroup:', groupId);
    
    const bookmarksList = document.querySelector(`[data-group-id="${groupId}"] .bookmarks-list`);
    if (!bookmarksList) {
        console.error('Bookmarks list not found for tabGroup:', groupId);
        return;
    }
    
    try {
        // Get all bookmarks from Chrome
        const bookmarkTree = await chrome.bookmarks.getTree();
        
        // Clear existing bookmarks
        bookmarksList.innerHTML = '';
        
        let bookmarkCount = 0;
        
        // Recursively process bookmark tree
        function processBookmarkNode(node, parentElement, depth = 0) {
            // Skip the root nodes we don't want to show (like "Other Bookmarks", etc.)
            const excludedTitles = ['Bookmarks Bar', 'Other Bookmarks', 'Mobile Bookmarks'];
            
            if (node.children) {
                // This is a folder
                const shouldShowFolder = depth > 0 && !excludedTitles.includes(node.title);
                
                if (shouldShowFolder && node.title) {
                    // Create folder container
                    const folderContainer = document.createElement('div');
                    folderContainer.className = 'bookmark-folder-container';
                    
                    // Create folder header
                    const folderHeader = document.createElement('div');
                    folderHeader.className = 'bookmark-folder';
                    folderHeader.innerHTML = `
                        <svg class="bookmark-folder-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                        <svg class="bookmark-folder-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                            <path d="M0 96C0 60.7 28.7 32 64 32l132.1 0c19.1 0 37.4 7.6 50.9 21.1L289.9 96 448 96c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96z"/>
                        </svg>
                        <span class="bookmark-folder-title">${node.title}</span>
                    `;
                    
                    // Create folder content container
                    const folderContent = document.createElement('div');
                    folderContent.className = 'bookmark-folder-content'; // Start collapsed
                    
                    // Apply blue color to bookmark folder lines
                    folderContent.style.setProperty('--group-line-color', '#60A5FA');
                    
                    // Add click handler to toggle folder
                    const toggle = folderHeader.querySelector('.bookmark-folder-toggle');
                    toggle.classList.add('collapsed'); // Start with collapsed chevron
                    
                    folderHeader.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isExpanded = folderContent.classList.toggle('expanded');
                        toggle.classList.toggle('collapsed', !isExpanded);
                    });
                    
                    folderContainer.appendChild(folderHeader);
                    folderContainer.appendChild(folderContent);
                    parentElement.appendChild(folderContainer);
                    
                    // Process children into the folder content
                    node.children.forEach(child => processBookmarkNode(child, folderContent, depth + 1));
                } else {
                    // For root level folders, process children directly without showing the folder itself
                    node.children.forEach(child => processBookmarkNode(child, parentElement, depth + 1));
                }
            } else if (node.url) {
                // This is a bookmark
                const bookmarkItem = document.createElement('div');
                bookmarkItem.className = 'bookmark-item';
                bookmarkItem.title = node.url;
                bookmarkItem.dataset.url = node.url; // Store URL for duplicate detection
                
                const favicon = document.createElement('img');
                favicon.className = 'bookmark-favicon';
                favicon.src = Utils.getFaviconUrl(node.url, "96");
                favicon.onerror = () => {
                    favicon.src = 'assets/default_icon.png';
                };
                
                const title = document.createElement('div');
                title.className = 'bookmark-title';
                title.textContent = node.title || node.url;
                
                bookmarkItem.appendChild(favicon);
                bookmarkItem.appendChild(title);
                
                // Click to open bookmark
                bookmarkItem.addEventListener('click', () => {
                    chrome.tabs.create({ url: node.url, active: true });
                });
                
                // Right-click context menu
                bookmarkItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showBookmarkContextMenu(e.pageX, e.pageY, node);
                });
                
                parentElement.appendChild(bookmarkItem);
                bookmarkCount++;
            }
        }
        
        // Start processing from root
        bookmarkTree.forEach(root => {
            root.children?.forEach(child => processBookmarkNode(child, bookmarksList, 0));
        });
        
        // Show message if no bookmarks found
        if (bookmarkCount === 0) {
            const noBookmarksMsg = document.createElement('div');
            noBookmarksMsg.className = 'no-bookmarks-message';
            noBookmarksMsg.textContent = 'No bookmarks found. Add bookmarks in Chrome to see them here.';
            bookmarksList.appendChild(noBookmarksMsg);
        }
        
        console.log(`Loaded ${bookmarkCount} bookmarks for tabGroup:`, groupId);
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        bookmarksList.innerHTML = '<div class="no-bookmarks-message">Error loading bookmarks</div>';
    }
}

// Show context menu for bookmarks
function showBookmarkContextMenu(x, y, bookmark) {
    // Remove any existing context menus
    const existingMenu = document.getElementById('bookmark-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const contextMenu = document.createElement('div');
    contextMenu.id = 'bookmark-context-menu';
    contextMenu.className = 'context-menu';
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    
    // Open in new tab
    const openNewTab = document.createElement('div');
    openNewTab.className = 'context-menu-item';
    openNewTab.textContent = 'Open in New Tab';
    openNewTab.addEventListener('click', () => {
        chrome.tabs.create({ url: bookmark.url, active: true });
        contextMenu.remove();
    });
    contextMenu.appendChild(openNewTab);
    
    // Open in background tab
    const openBackground = document.createElement('div');
    openBackground.className = 'context-menu-item';
    openBackground.textContent = 'Open in Background Tab';
    openBackground.addEventListener('click', () => {
        chrome.tabs.create({ url: bookmark.url, active: false });
        contextMenu.remove();
    });
    contextMenu.appendChild(openBackground);
    
    // Copy URL
    const copyUrl = document.createElement('div');
    copyUrl.className = 'context-menu-item';
    copyUrl.textContent = 'Copy URL';
    copyUrl.addEventListener('click', () => {
        navigator.clipboard.writeText(bookmark.url);
        contextMenu.remove();
    });
    contextMenu.appendChild(copyUrl);
    
    document.body.appendChild(contextMenu);
    
    // Close context menu when clicking outside
    const closeContextMenu = (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.remove();
            document.removeEventListener('click', closeContextMenu, { capture: true });
        }
    };
    document.addEventListener('click', closeContextMenu, { capture: true });
}

// Global Search Functionality
function setupGlobalSearch() {
    const searchInput = document.getElementById('globalSearch');
    const searchClear = document.getElementById('searchClear');
    
    if (!searchInput || !searchClear) {
        console.error('❌ Search elements not found!');
        return;
    }
    
    // Function to focus search input
    const focusSearchInput = () => {
        console.log('🎯 Focusing search input...');
        if (!searchInput) {
            console.error('❌ Search input element not found!');
            return;
        }
        searchInput.focus();
        searchInput.select();
        console.log('✅ Search input focused, active element:', document.activeElement);
    };
    
    console.log('🔧 Setting up global search...');
    
    // Check flag immediately on load (in case sidebar was already open)
    chrome.storage.local.get(['cmdKPressed', 'cmdKTimestamp'], (result) => {
        console.log('📦 Initial storage check:', result);
        if (result.cmdKPressed) {
            const age = Date.now() - (result.cmdKTimestamp || 0);
            console.log('⏰ Flag age:', age, 'ms');
            if (age < 2000) {
                console.log('🚀 Initial Cmd+K flag check - focusing search');
                focusSearchInput();
            }
            chrome.storage.local.set({ cmdKPressed: false });
        }
    });
    
    // Listen for Cmd+K flag in storage (primary method)
    chrome.storage.onChanged.addListener((changes, areaName) => {
        console.log('💾 Storage changed:', areaName, changes);
        if (areaName === 'local' && changes.cmdKPressed?.newValue === true) {
            console.log('🔔 Cmd+K flag detected in storage!');
            focusSearchInput();
            // Clear the flag
            chrome.storage.local.set({ cmdKPressed: false });
        }
    });
    
    // Also check flag on visibility change
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            console.log('👀 Sidebar became visible - checking for Cmd+K flag');
            chrome.storage.local.get(['cmdKPressed', 'cmdKTimestamp'], (result) => {
                if (result.cmdKPressed) {
                    // Check if flag is recent (within last 2 seconds)
                    const age = Date.now() - (result.cmdKTimestamp || 0);
                    if (age < 2000) {
                        console.log('✨ Recent Cmd+K detected - focusing search');
                        focusSearchInput();
                    }
                    // Clear the flag
                    chrome.storage.local.set({ cmdKPressed: false });
                }
            });
        }
    });
    
    // Listen for messages as backup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('📬 Sidebar received message:', message);
        if (message.action === 'focusSidebarSearch') {
            console.log('📨 Received focusSidebarSearch message - focusing input');
            focusSearchInput();
        }
    });
    
    // Poll for the flag every 200ms as a final fallback
    console.log('🔄 Starting polling mechanism for Cmd+K flag');
    let pollInterval = setInterval(() => {
        chrome.storage.local.get(['cmdKPressed', 'cmdKTimestamp'], (result) => {
            if (result.cmdKPressed) {
                const age = Date.now() - (result.cmdKTimestamp || 0);
                console.log('⚡ Cmd+K flag detected via polling, age:', age, 'ms');
                if (age < 2000) {
                    console.log('✨ Polling detected recent Cmd+K - focusing search');
                    focusSearchInput();
                }
                chrome.storage.local.set({ cmdKPressed: false });
            }
        });
    }, 200);
    
    let searchTimeout = null;
    
    // Handle search input
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Show/hide clear button
        searchClear.style.display = query ? 'block' : 'none';
        
        // Debounce search
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(query);
        }, 300);
    });
    
    // Handle clear button
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        performSearch('');
        searchInput.focus();
    });
    
    // Handle keyboard shortcuts
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchClear.style.display = 'none';
            performSearch('');
            searchInput.blur();
        }
    });
    
    // Global keyboard shortcuts to focus search
    const focusSearch = () => {
        if (searchInput) {
            setTimeout(() => {
                searchInput.focus();
                searchInput.select();
            }, 0);
        }
    };
    
    // Robust keyboard shortcut handler
    const handleShortcut = (e) => {
        const isK = e.key.toLowerCase() === 'k';
        const isF = e.key.toLowerCase() === 'f';
        const hasModifier = e.metaKey || e.ctrlKey;
        
        // Cmd+K or Ctrl+K (primary shortcut)
        if (hasModifier && isK) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            focusSearch();
            return false;
        }
        
        // Cmd+F or Ctrl+F (alternative shortcut)
        if (hasModifier && isF) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            focusSearch();
            return false;
        }
    };
    
    // Add listeners at multiple levels for maximum compatibility
    document.addEventListener('keydown', handleShortcut, true);
    window.addEventListener('keydown', handleShortcut, true);
    document.body.addEventListener('keydown', handleShortcut, true);
}

function performSearch(query) {
    const lowerQuery = query.toLowerCase();
    
    // If empty query, show all tabs and bookmarks
    if (!query) {
        showAllTabsAndBookmarks();
        return;
    }
    
    // Search through all tabs in all tabGroups
    document.querySelectorAll('.space').forEach(tabGroupElement => {
        let tabGroupHasMatches = false;
        
        // Search temporary tabs in list view
        const tempTabs = tabGroupElement.querySelectorAll('.temporary-tabs .tab');
        
        tempTabs.forEach(tabElement => {
            const titleEl = tabElement.querySelector('.tab-title-display');
            const domainEl = tabElement.querySelector('.tab-domain-display');
            const title = titleEl?.textContent?.toLowerCase() || '';
            const domain = domainEl?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery) || domain.includes(lowerQuery);
            
            tabElement.style.display = matches ? '' : 'none';
            if (matches) tabGroupHasMatches = true;
        });
        
        // Search temporary tabs in tree view
        const tempTreeTabs = tabGroupElement.querySelectorAll('.tabs-tree-container .tree-tab-item');
        tempTreeTabs.forEach(tabElement => {
            const title = tabElement.querySelector('.tree-tab-title')?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery);
            
            tabElement.style.display = matches ? '' : 'none';
            if (matches) tabGroupHasMatches = true;
        });
        
        // Pinned tabs section removed - no longer searching pinned tabs
        
        // Search folders
        const folders = tabGroupElement.querySelectorAll('.folder');
        folders.forEach(folderElement => {
            const folderName = folderElement.querySelector('.folder-name, .folder-title')?.textContent?.toLowerCase() || '';
            const folderTabs = folderElement.querySelectorAll('.tab');
            let folderHasMatches = folderName.includes(lowerQuery);
            
            folderTabs.forEach(tabElement => {
                const title = tabElement.querySelector('.tab-title-display')?.textContent?.toLowerCase() || '';
                const domain = tabElement.querySelector('.tab-domain-display')?.textContent?.toLowerCase() || '';
                const matches = title.includes(lowerQuery) || domain.includes(lowerQuery);
                
                tabElement.style.display = matches ? '' : 'none';
                if (matches) {
                    folderHasMatches = true;
                    tabGroupHasMatches = true;
                }
            });
            
            // Show/hide folder based on matches
            folderElement.style.display = folderHasMatches ? '' : 'none';
            
            // Expand folder if it has matches
            if (folderHasMatches && query) {
                const folderContent = folderElement.querySelector('.folder-content');
                const folderToggle = folderElement.querySelector('.folder-toggle');
                if (folderContent && folderToggle) {
                    folderContent.classList.remove('collapsed');
                    folderToggle.classList.remove('collapsed');
                }
            }
        });
        
        // Search tree view groups (for both temporary tabs and bookmarks)
        const treeGroups = tabGroupElement.querySelectorAll('.tree-domain-group, .list-tab-group');
        
        treeGroups.forEach(groupElement => {
            const groupName = groupElement.querySelector('.tree-domain-name, .list-tab-group-name')?.textContent?.toLowerCase() || '';
            const groupTabs = groupElement.querySelectorAll('.tree-tab-item, .tab');
            let groupHasMatches = groupName.includes(lowerQuery);
            
            groupTabs.forEach(tabElement => {
                // Check both tree view and list view tab selectors
                const treeTitle = tabElement.querySelector('.tree-tab-title')?.textContent?.toLowerCase() || '';
                const listTitle = tabElement.querySelector('.tab-title-display')?.textContent?.toLowerCase() || '';
                
                // Extract domain from URL data attribute
                const url = tabElement.dataset.url || '';
                let domain = '';
                try {
                    if (url) {
                        domain = new URL(url).hostname.toLowerCase();
                    }
                } catch (e) {
                    domain = '';
                }
                
                const title = treeTitle || listTitle;
                const matches = title.includes(lowerQuery) || domain.includes(lowerQuery) || url.toLowerCase().includes(lowerQuery);
                
                tabElement.style.display = matches ? '' : 'none';
                if (matches) {
                    groupHasMatches = true;
                    tabGroupHasMatches = true;
                }
            });
            
            groupElement.style.display = groupHasMatches ? '' : 'none';
            
            // Expand group if it has matches
            if (groupHasMatches && query) {
                const groupTabsContainer = groupElement.querySelector('.tree-domain-tabs, .list-tab-group-tabs');
                const expandIcon = groupElement.querySelector('.tree-expand-icon, .list-expand-icon');
                if (groupTabsContainer && expandIcon) {
                    groupTabsContainer.classList.add('expanded');
                    expandIcon.classList.add('expanded');
                }
            }
        });
        
        // Search bookmarks
        const bookmarkItems = tabGroupElement.querySelectorAll('.bookmark-item');
        bookmarkItems.forEach(bookmarkElement => {
            const title = bookmarkElement.querySelector('.bookmark-title')?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery);
            
            bookmarkElement.style.display = matches ? '' : 'none';
            if (matches) tabGroupHasMatches = true;
        });
        
        // Search bookmark folders
        const bookmarkFolders = tabGroupElement.querySelectorAll('.bookmark-folder-container');
        bookmarkFolders.forEach(folderElement => {
            const folderName = folderElement.querySelector('.bookmark-folder-title')?.textContent?.toLowerCase() || '';
            const folderBookmarks = folderElement.querySelectorAll('.bookmark-item');
            let folderHasMatches = folderName.includes(lowerQuery);
            
            folderBookmarks.forEach(bookmarkElement => {
                const title = bookmarkElement.querySelector('.bookmark-title')?.textContent?.toLowerCase() || '';
                const matches = title.includes(lowerQuery);
                
                bookmarkElement.style.display = matches ? '' : 'none';
                if (matches) {
                    folderHasMatches = true;
                    tabGroupHasMatches = true;
                }
            });
            
            folderElement.style.display = folderHasMatches ? '' : 'none';
            
            // Expand bookmark folder if it has matches
            if (folderHasMatches && query) {
                const folderContent = folderElement.querySelector('.bookmark-folder-content');
                if (folderContent) {
                    folderContent.classList.add('expanded');
                }
            }
        });
        
        // Show/hide tabGroup based on whether it has matches
        // Note: We don't hide the tabGroup itself, just its content
        if (!tabGroupHasMatches) {
            tabGroupElement.querySelector('.tab-group-content')?.classList.add('no-search-results');
        } else {
            tabGroupElement.querySelector('.tab-group-content')?.classList.remove('no-search-results');
        }
    });
    
    // Always expand bookmarks section when searching
    if (query) {
        document.querySelectorAll('.bookmarks-content').forEach(section => {
            section.classList.remove('collapsed');
        });
        document.querySelectorAll('.bookmarks-toggle').forEach(toggle => {
            toggle.classList.remove('collapsed');
        });
    }
}

function showAllTabsAndBookmarks() {
    // Show all tabs
    document.querySelectorAll('.tab, .tree-tab-item, .bookmark-item, .folder, .tree-domain-group, .bookmark-folder-container').forEach(element => {
        element.style.display = '';
    });
    
    // Remove search result states
    document.querySelectorAll('.tab-group-content').forEach(content => {
        content.classList.remove('no-search-results');
    });
}

// Setup settings panel functionality
function setupSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsCloseBtn = document.getElementById('settingsCloseBtn');
    const themeToggle = document.getElementById('themeToggle');
    const themeValue = document.getElementById('themeValue');
    const settingsTreeViewToggle = document.getElementById('settingsTreeViewToggle');
    const settingsExpandAll = document.getElementById('settingsExpandAll');
    const settingsCollapseAll = document.getElementById('settingsCollapseAll');
    
    if (!settingsBtn || !settingsPanel) {
        console.error('❌ Settings elements not found!');
        return;
    }
    
    // Load saved theme preference
    chrome.storage.local.get(['theme'], (result) => {
        const isDark = result.theme === 'dark';
        themeToggle.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        themeValue.textContent = isDark ? 'Dark' : 'Light';
    });
    
    // Load tree view state
    settingsTreeViewToggle.checked = isTreeViewMode;
    
    // Load hide duplicates state
    const settingsHideDuplicatesToggle = document.getElementById('settingsHideDuplicatesToggle');
    chrome.storage.local.get(['hideDuplicates'], (result) => {
        hideDuplicates = result.hideDuplicates === true;
        if (settingsHideDuplicatesToggle) {
            settingsHideDuplicatesToggle.checked = hideDuplicates;
        }
        // Update toolbar button state
        updateHideDuplicatesButton();
    });
    
    // Load 2-level hierarchy state
    const settingsTreeHierarchyToggle = document.getElementById('settingsTreeHierarchyToggle');
    chrome.storage.local.get(['twoLevelHierarchy'], (result) => {
        twoLevelHierarchy = result.twoLevelHierarchy === true;
        if (settingsTreeHierarchyToggle) {
            settingsTreeHierarchyToggle.checked = twoLevelHierarchy;
        }
    });
    
    // Toggle settings panel
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsPanel.classList.toggle('visible');
    });
    
    // Close settings panel
    settingsCloseBtn.addEventListener('click', () => {
        settingsPanel.classList.remove('visible');
    });
    
    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            settingsPanel.classList.remove('visible');
        }
    });
    
    // Theme toggle
    themeToggle.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.classList.toggle('dark-mode', isDark);
        themeValue.textContent = isDark ? 'Dark' : 'Light';
        chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
    });
    
    // Tree view toggle
    settingsTreeViewToggle.addEventListener('change', (e) => {
        isTreeViewMode = e.target.checked;
        chrome.storage.local.set({ treeViewMode: isTreeViewMode });
        
        // Toggle tree view for active tabGroup
        if (activeGroupId) {
            const tabGroupElement = document.querySelector(`[data-group-id="${activeGroupId}"]`);
            if (tabGroupElement) {
                const listView = tabGroupElement.querySelector('.tabs-container.list-view');
                const treeView = tabGroupElement.querySelector('.tabs-tree-container');
                
                if (listView && treeView) {
                    if (isTreeViewMode) {
                        listView.style.display = 'none';
                        treeView.style.display = 'block';
                        treeView.classList.remove('collapsed');
                        renderTreeView(activeGroupId);
                    } else {
                        listView.style.display = 'flex';
                        treeView.style.display = 'none';
                    }
                }
            }
        }
    });
    
    // Hide duplicates toggle
    if (settingsHideDuplicatesToggle) {
        settingsHideDuplicatesToggle.addEventListener('change', (e) => {
            hideDuplicates = e.target.checked;
            chrome.storage.local.set({ hideDuplicates: hideDuplicates });
            updateHideDuplicatesButton();
            filterDuplicates();
        });
    }
    
    // 2-level hierarchy toggle
    if (settingsTreeHierarchyToggle) {
        settingsTreeHierarchyToggle.addEventListener('change', (e) => {
            twoLevelHierarchy = e.target.checked;
            chrome.storage.local.set({ twoLevelHierarchy: twoLevelHierarchy });
            // Re-render tree view if currently in tree view mode
            if (isTreeViewMode && activeGroupId) {
                renderTreeView(activeGroupId);
                renderBookmarksTreeView(activeGroupId);
            }
        });
    }
    
    // Expand all
    settingsExpandAll.addEventListener('click', () => {
        expandAll();
        settingsPanel.classList.remove('visible');
    });
    
    // Collapse all
    settingsCollapseAll.addEventListener('click', () => {
        collapseAll();
        settingsPanel.classList.remove('visible');
    });
    
    // Size and compactness controls
    const iconSizeSlider = document.getElementById('iconSizeSlider');
    const iconSizeValue = document.getElementById('iconSizeValue');
    const textSizeSlider = document.getElementById('textSizeSlider');
    const textSizeValue = document.getElementById('textSizeValue');
    const compactnessSlider = document.getElementById('compactnessSlider');
    const compactnessValue = document.getElementById('compactnessValue');
    
    // Load saved sizing preferences
    chrome.storage.local.get(['iconSize', 'textSize', 'compactness'], (result) => {
        const iconSize = result.iconSize || 16;
        const textSize = result.textSize || 12.5;
        const compactness = result.compactness || 2;
        
        iconSizeSlider.value = iconSize;
        textSizeSlider.value = textSize;
        compactnessSlider.value = compactness;
        
        updateSizeValues(iconSize, textSize, compactness);
        applySizing(iconSize, textSize, compactness);
    });
    
    // Icon size slider
    iconSizeSlider.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        iconSizeValue.textContent = `${size}px`;
        applySizing(size, parseFloat(textSizeSlider.value), parseInt(compactnessSlider.value));
        chrome.storage.local.set({ iconSize: size });
    });
    
    // Text size slider
    textSizeSlider.addEventListener('input', (e) => {
        const size = parseFloat(e.target.value);
        textSizeValue.textContent = `${size}px`;
        applySizing(parseInt(iconSizeSlider.value), size, parseInt(compactnessSlider.value));
        chrome.storage.local.set({ textSize: size });
    });
    
    // Compactness slider
    compactnessSlider.addEventListener('input', (e) => {
        const compactness = parseInt(e.target.value);
        const labels = ['Max', 'High', 'Normal', 'Low', 'Min'];
        compactnessValue.textContent = labels[compactness / 2];
        applySizing(parseInt(iconSizeSlider.value), parseFloat(textSizeSlider.value), compactness);
        chrome.storage.local.set({ compactness: compactness });
    });
}

// Update size value displays
function updateSizeValues(iconSize, textSize, compactness) {
    const iconSizeValue = document.getElementById('iconSizeValue');
    const textSizeValue = document.getElementById('textSizeValue');
    const compactnessValue = document.getElementById('compactnessValue');
    
    if (iconSizeValue) iconSizeValue.textContent = `${iconSize}px`;
    if (textSizeValue) textSizeValue.textContent = `${textSize}px`;
    
    if (compactnessValue) {
        const labels = ['Max', 'High', 'Normal', 'Low', 'Min'];
        compactnessValue.textContent = labels[compactness / 2];
    }
}

// Apply sizing to CSS variables
function applySizing(iconSize, textSize, compactness) {
    const root = document.documentElement;
    
    // Set icon and text size
    root.style.setProperty('--icon-size', `${iconSize}px`);
    root.style.setProperty('--text-size', `${textSize}px`);
    
    // Calculate padding based on compactness (0 = most compact, 8 = least compact)
    const paddingVertical = compactness;
    const paddingHorizontal = compactness * 2;
    const itemGap = Math.max(0, compactness - 2);
    
    root.style.setProperty('--item-padding-vertical', `${paddingVertical}px`);
    root.style.setProperty('--item-padding-horizontal', `${paddingHorizontal}px`);
    root.style.setProperty('--item-gap', `${itemGap}px`);
}

// Expand all folders and groups
function expandAll() {
    // Expand all folders
    document.querySelectorAll('.folder-toggle.collapsed').forEach(toggle => {
        toggle.click();
    });
    
    // Expand all tree domain groups
    document.querySelectorAll('.tree-expand-icon:not(.expanded)').forEach(icon => {
        icon.parentElement.click();
    });
    
    // Expand all list groups
    document.querySelectorAll('.list-expand-icon:not(.expanded)').forEach(icon => {
        icon.parentElement.click();
    });
    
    // Expand all bookmark folders
    document.querySelectorAll('.bookmark-folder-toggle.collapsed').forEach(toggle => {
        toggle.parentElement.click();
    });
    
    // Expand bookmarks section if collapsed
    const bookmarksToggle = document.querySelector('.bookmarks-toggle.collapsed');
    if (bookmarksToggle) {
        bookmarksToggle.click();
    }
}

// Collapse all folders and groups
function collapseAll() {
    // Collapse all folders
    document.querySelectorAll('.folder-toggle:not(.collapsed)').forEach(toggle => {
        toggle.click();
    });
    
    // Collapse all tree domain groups
    document.querySelectorAll('.tree-expand-icon.expanded').forEach(icon => {
        icon.parentElement.click();
    });
    
    // Collapse all list groups
    document.querySelectorAll('.list-expand-icon.expanded').forEach(icon => {
        icon.parentElement.click();
    });
    
    // Collapse all bookmark folders
    document.querySelectorAll('.bookmark-folder-toggle:not(.collapsed)').forEach(toggle => {
        toggle.parentElement.click();
    });
}

// Update the hide duplicates button state
function updateHideDuplicatesButton() {
    const hideDuplicatesBtn = document.getElementById('hideDuplicatesBtn');
    if (hideDuplicatesBtn) {
        if (hideDuplicates) {
            hideDuplicatesBtn.classList.add('active');
            hideDuplicatesBtn.title = 'Show Duplicates';
        } else {
            hideDuplicatesBtn.classList.remove('active');
            hideDuplicatesBtn.title = 'Hide Duplicates';
        }
    }
}

// Filter duplicate tabs and bookmarks
function filterDuplicates() {
    if (!hideDuplicates) {
        // Show all tabs and bookmarks
        document.querySelectorAll('.tab[data-is-duplicate], .tree-tab-item[data-is-duplicate], .bookmark-item[data-is-duplicate]').forEach(element => {
            element.style.display = '';
            element.removeAttribute('data-is-duplicate');
        });
        return;
    }
    
    // Track seen URLs
    const seenUrls = new Set();
    
    // Process all tabs (both list view and tree view)
    const allTabs = [
        ...document.querySelectorAll('.tab'),
        ...document.querySelectorAll('.tree-tab-item')
    ];
    
    allTabs.forEach(tabElement => {
        const url = tabElement.dataset.url || tabElement.querySelector('[data-url]')?.dataset.url;
        
        if (url) {
            if (seenUrls.has(url)) {
                // This is a duplicate, hide it
                tabElement.style.display = 'none';
                tabElement.setAttribute('data-is-duplicate', 'true');
            } else {
                // First occurrence, show it and add to seen URLs
                tabElement.style.display = '';
                tabElement.removeAttribute('data-is-duplicate');
                seenUrls.add(url);
            }
        }
    });
    
    // Process bookmarks
    document.querySelectorAll('.bookmark-item').forEach(bookmarkElement => {
        const url = bookmarkElement.dataset.url;
        
        if (url) {
            if (seenUrls.has(url)) {
                // This is a duplicate (already exists as tab or earlier bookmark), hide it
                bookmarkElement.style.display = 'none';
                bookmarkElement.setAttribute('data-is-duplicate', 'true');
            } else {
                // First occurrence, show it
                bookmarkElement.style.display = '';
                bookmarkElement.removeAttribute('data-is-duplicate');
                seenUrls.add(url);
            }
        }
    });
    
    // Update group counts if in tree view
    updateGroupCounts();
}

// Update group counts after filtering
function updateGroupCounts() {
    // Update tree view domain group counts
    document.querySelectorAll('.tree-domain-group').forEach(group => {
        const visibleTabs = group.querySelectorAll('.tree-tab-item:not([style*="display: none"])').length;
        const countElement = group.querySelector('.tree-domain-count');
        if (countElement) {
            countElement.textContent = visibleTabs;
        }
        
        // Hide group if no visible tabs
        if (visibleTabs === 0) {
            group.style.display = 'none';
        } else {
            group.style.display = '';
        }
    });
    
    // Update list view group counts
    document.querySelectorAll('.list-tab-group').forEach(group => {
        const visibleTabs = group.querySelectorAll('.tab:not([style*="display: none"])').length;
        const countElement = group.querySelector('.list-tab-group-count');
        if (countElement) {
            countElement.textContent = visibleTabs;
        }
        
        // Hide group if no visible tabs
        if (visibleTabs === 0) {
            group.style.display = 'none';
        } else {
            group.style.display = '';
        }
    });
}

// Initialize the sidebar when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();

    // Add Chrome tab event listeners
    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        handleTabUpdate(tabId, changeInfo, tab);
    });
    chrome.tabs.onRemoved.addListener(handleTabRemove);
    // chrome.tabs.onMoved.addListener(handleTabMove);
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        await handleTabActivated(activeInfo);
        // Update active state in favorites (debounced, lightweight)
        updateFavoritesActiveState();
    });
    
    // Listen for favorites changes from context menu
    window.addEventListener('favoritesChanged', async () => {
        console.log('📢 Favorites changed event received');
        await loadFavorites();
    });
    
    // Listen for storage changes from other windows (prevent loop)
    let isUpdatingFromStorage = false;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.favorites && !isUpdatingFromStorage) {
            isUpdatingFromStorage = true;
            console.log('📢 Favorites changed in storage from another window');
            favorites = changes.favorites.newValue || [];
            renderFavoritesDebounced().finally(() => {
                isUpdatingFromStorage = false;
            });
        }
    });

    // Setup global search functionality
    setupGlobalSearch();
    
    // Setup settings panel
    setupSettings();
    
    // Setup toolbar buttons
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            expandAll();
        });
    }
    
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            collapseAll();
        });
    }
    
    // Setup hide duplicates button
    const hideDuplicatesBtn = document.getElementById('hideDuplicatesBtn');
    if (hideDuplicatesBtn) {
        hideDuplicatesBtn.addEventListener('click', () => {
            hideDuplicates = !hideDuplicates;
            chrome.storage.local.set({ hideDuplicates: hideDuplicates });
            updateHideDuplicatesButton();
            
            // Update settings toggle to match
            const settingsHideDuplicatesToggle = document.getElementById('settingsHideDuplicatesToggle');
            if (settingsHideDuplicatesToggle) {
                settingsHideDuplicatesToggle.checked = hideDuplicates;
            }
            
            filterDuplicates();
        });
    }
    
    // Setup favorites toggle
    const favoritesToggle = document.querySelector('.favorites-toggle');
    const favoritesContent = document.querySelector('.favorites-content');
    
    if (favoritesToggle && favoritesContent) {
        favoritesToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = favoritesContent.classList.toggle('collapsed');
            favoritesToggle.classList.toggle('collapsed', isCollapsed);
            
            // Save state
            chrome.storage.local.set({ favoritesSectionCollapsed: isCollapsed });
        });
        
        // Restore collapsed state
        chrome.storage.local.get('favoritesSectionCollapsed', (result) => {
            if (result.favoritesSectionCollapsed) {
                favoritesContent.classList.add('collapsed');
                favoritesToggle.classList.add('collapsed');
            }
        });
    }
    
    // Setup favorites settings button
    const favoritesSettingsBtn = document.getElementById('favoritesSettingsBtn');
    if (favoritesSettingsBtn) {
        favoritesSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavoritesSettingsPanel();
        });
    }
    
    // Setup favorites settings close button
    const favoritesSettingsCloseBtn = document.getElementById('favoritesSettingsCloseBtn');
    if (favoritesSettingsCloseBtn) {
        favoritesSettingsCloseBtn.addEventListener('click', () => {
            toggleFavoritesSettingsPanel();
        });
    }
    
    // Close favorites settings panel when clicking outside
    const favoritesSettingsPanel = document.getElementById('favoritesSettingsPanel');
    if (favoritesSettingsPanel) {
        document.addEventListener('click', (e) => {
            if (favoritesSettingsPanel.classList.contains('visible') &&
                !favoritesSettingsPanel.contains(e.target) &&
                favoritesSettingsBtn &&
                !favoritesSettingsBtn.contains(e.target)) {
                favoritesSettingsPanel.classList.remove('visible');
            }
        });
    }
    
    // Setup bookmarks section header click
    const bookmarksSectionHeader = document.getElementById('bookmarksSectionHeader');
    const bookmarksSettingsBtn = document.getElementById('bookmarksSettingsBtn');
    
    if (bookmarksSectionHeader) {
        bookmarksSectionHeader.addEventListener('click', (e) => {
            // Don't trigger if clicking the button
            if (!bookmarksSettingsBtn || !bookmarksSettingsBtn.contains(e.target)) {
                toggleBookmarksPanel();
            }
        });
    }
    
    if (bookmarksSettingsBtn) {
        bookmarksSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBookmarksPanel();
        });
    }
    
    // Setup bookmarks panel close button
    const bookmarksPanelCloseBtn = document.getElementById('bookmarksPanelCloseBtn');
    if (bookmarksPanelCloseBtn) {
        bookmarksPanelCloseBtn.addEventListener('click', () => {
            toggleBookmarksPanel();
        });
    }
    
    // Close bookmarks panel when clicking outside
    const bookmarksPanel = document.getElementById('bookmarksPanel');
    const sidebarContainer = document.getElementById('sidebar-container');
    if (bookmarksPanel && sidebarContainer) {
        document.addEventListener('click', (e) => {
            if (bookmarksPanel.classList.contains('visible') &&
                !bookmarksPanel.contains(e.target) &&
                bookmarksSectionHeader &&
                !bookmarksSectionHeader.contains(e.target)) {
                bookmarksPanel.classList.remove('visible');
                sidebarContainer.classList.remove('panel-open');
            }
        });
    }

    // --- Tab Group Switching with Trackpad Swipe ---
    let isSwiping = false;
    let swipeTimeout = null;
    const swipeThreshold = 25; // Min horizontal movement to trigger a swipe

    document.getElementById('sidebar-container').addEventListener('wheel', async (event) => {
        // Ignore vertical scrolling or if a swipe is already being processed
        if (Math.abs(event.deltaX) < Math.abs(event.deltaY) || isSwiping) {
            return;
        }

        if (Math.abs(event.deltaX) > swipeThreshold) {
            isSwiping = true;
            event.preventDefault(); // Stop browser from navigating back/forward

            const currentIndex = tabGroups.findIndex(s => s.id === activeGroupId);
            if (currentIndex === -1) {
                isSwiping = false;
                return;
            }

            let nextIndex;
            // deltaX > 0 means swiping right (finger moves right, content moves left) -> previous tabGroup
            if (event.deltaX < 0) {
                nextIndex = (currentIndex - 1 + tabGroups.length) % tabGroups.length;
            } else {
                // deltaX < 0 means swiping left (finger moves left, content moves right) -> next tabGroup
                nextIndex = (currentIndex + 1) % tabGroups.length;
            }
            
            const nextTabGroup = tabGroups[nextIndex];
            if (nextTabGroup) {
                await setActiveTabGroup(nextTabGroup.id);
            }

            // Cooldown to prevent re-triggering during the same gesture
            clearTimeout(swipeTimeout);
            swipeTimeout = setTimeout(() => {
                isSwiping = false;
            }, 400); // 400ms cooldown
        }
    }, { passive: false }); // 'passive: false' is required to use preventDefault()
});

async function initSidebar() {
    console.log('🎬 initSidebar starting...');
    
    // Initialize DOM elements now that DOM is ready
    tabGroupsList = document.getElementById('tabGroupsList');
    tabGroupSwitcher = document.getElementById('tabGroupSwitcher');
    addTabGroupBtn = document.getElementById('addTabGroupBtn');
    newTabBtn = document.getElementById('newTabBtn');
    tabGroupTemplate = document.getElementById('tabGroupTemplate');
    
    console.log('✅ DOM elements initialized:', {
        tabGroupsList: !!tabGroupsList,
        tabGroupSwitcher: !!tabGroupSwitcher,
        tabGroupTemplate: !!tabGroupTemplate
    });
    
    let settings = await Utils.getSettings();
    if (settings.defaultTabGroupName) {
        defaultTabGroupName = settings.defaultTabGroupName;
    }
    try {
        currentWindow = await chrome.windows.getCurrent({populate: false});
        console.log('🎬 Current window:', currentWindow.id);

        let tabGroups = await chrome.tabGroups.query({});
        let allTabs = await chrome.tabs.query({currentWindow: true});

        // Check for duplicates
        await LocalStorage.mergeDuplicateTabGroupFolders();

        // Create bookmarks folder for tabGroups if it doesn't exist
        const tabGroupsFolder = await LocalStorage.getOrCreateArcifyFolder();
        const subFolders = await chrome.bookmarks.getChildren(tabGroupsFolder.id);
        if (tabGroups.length === 0) {
            let currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];

            if (currentTabs.length == 0) {
                await chrome.tabs.create({ active: true });
                allTabs = await chrome.tabs.query({});
                currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];
            }

            // Create single unified tabGroup with all tabs
            const unifiedTabGroup = {
                id: 'unified',
                uuid: Utils.generateUUID(),
                name: 'All Tabs',
                color: 'blue',
                tabGroupBookmarks: [],
                temporaryTabs: currentTabs.map(tab => tab.id),
            };

            // Create bookmark folder for unified tabGroup
            const bookmarkFolder = subFolders.find(f => !f.url && f.title == 'All Tabs');
            if (!bookmarkFolder) {
                await chrome.bookmarks.create({
                    parentId: tabGroupsFolder.id,
                    title: 'All Tabs'
                });
            }

            tabGroups = [unifiedTabGroup];
            saveTabGroups();
            
            // Make sure tabGroups list is visible
            const tabGroupsList = document.getElementById('tabGroupsList');
            if (tabGroupsList) {
                tabGroupsList.style.display = 'block';
                console.log('✅ Spaces list made visible');
            }
            
            createTabGroupElement(unifiedTabGroup);
            await setActiveTabGroup(unifiedTabGroup.id);
            
            // Hide tabGroup switcher in unified view
            const tabGroupSwitcherContainer = document.querySelector('.space-switcher-container');
            if (tabGroupSwitcherContainer) {
                tabGroupSwitcherContainer.style.display = 'none';
            }
        } else {
            // Don't force ungrouped tabs into a group - let them remain ungrouped
            // They will show up in the "Ungrouped Tabs" section
            
            // Create a single unified tabGroup that contains all tabs
            // Collect all tab IDs and bookmarked tabs
            let allTabIds = allTabs.filter(tab => !tab.pinned).map(tab => tab.id);
            let allTabGroupBookmarks = [];
            
            // Process bookmarks from all folders
            const mainFolder = await chrome.bookmarks.getSubTree(tabGroupsFolder.id);
            for (const bookmarkFolder of mainFolder[0].children || []) {
                if (!bookmarkFolder.url) {
                    const bookmarkedIds = await Utils.processBookmarkFolder(bookmarkFolder, -1);
                    allTabGroupBookmarks.push(...bookmarkedIds.filter(id => id !== null));
                }
            }
            
            // Create single unified tabGroup
            const unifiedTabGroup = {
                id: 'unified',
                uuid: Utils.generateUUID(),
                name: 'All Tabs',
                color: 'blue',
                tabGroupBookmarks: allTabGroupBookmarks,
                temporaryTabs: allTabIds.filter(id => !allTabGroupBookmarks.includes(id))
            };
            
            // Create bookmark folder for unified tabGroup if it doesn't exist
            const bookmarkFolder = mainFolder[0].children?.find(f => !f.url && f.title == 'All Tabs');
            if (!bookmarkFolder) {
                await chrome.bookmarks.create({
                    parentId: tabGroupsFolder.id,
                    title: 'All Tabs'
                });
            }
            
            tabGroups = [unifiedTabGroup];
            
            // Make sure tabGroups list is visible
            const tabGroupsList = document.getElementById('tabGroupsList');
            if (tabGroupsList) {
                tabGroupsList.style.display = 'block';
                console.log('✅ Spaces list made visible');
            }
            
            createTabGroupElement(unifiedTabGroup);
            console.log("initial save", tabGroups);
            saveTabGroups();

            // Set the unified tabGroup as active
            await setActiveTabGroup(unifiedTabGroup.id);
            
            // Update UI if needed
            // (pinned favicons removed)
            
            // Hide tabGroup switcher in unified view
            const tabGroupSwitcherContainer = document.querySelector('.space-switcher-container');
            if (tabGroupSwitcherContainer) {
                tabGroupSwitcherContainer.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error initializing sidebar:', error);
    }

    // Setup DOM elements (optional - may not exist in unified view)
    try {
        setupDOMElements(createNewTabGroup, createNewTab);
    } catch (error) {
        console.error('Error setting up DOM elements (non-critical):', error);
        // This is non-critical - the sidebar should still work
    }
    
    // Load favorites
    await loadFavorites();
    
    console.log('✅ Sidebar initialization complete');
}

function createTabGroupElement(tabGroup) {
    console.log('🚀 Creating tabGroup element for:', tabGroup.id);
    
    // Make sure tabGroupsList is visible first
    const tabGroupsList = document.getElementById('tabGroupsList');
    if (tabGroupsList) {
        tabGroupsList.style.display = 'block';
        console.log('✅ Spaces list made visible in createTabGroupElement');
    } else {
        console.error('❌ tabGroupsList not found!');
    }
    
    console.log('🚀 tabGroupTemplate exists:', !!tabGroupTemplate);
    const tabGroupElement = tabGroupTemplate.content.cloneNode(true);
    const sidebarContainer = document.getElementById('sidebar-container');
    const tabGroupContainer = tabGroupElement.querySelector('.space');
    console.log('🚀 tabGroupContainer found:', !!tabGroupContainer);
    tabGroupContainer.dataset.groupId = tabGroup.id;
    tabGroupContainer.style.display = 'block'; // Always show in unified view
    tabGroupContainer.dataset.tabGroupUuid = tabGroup.id;
    console.log('🚀 Tab Group container display set to:', tabGroupContainer.style.display);

    // Set tabGroup background color based on the tab group color
    sidebarContainer.style.setProperty('--group-bg-color', `var(--chrome-${tabGroup.color}-color, rgba(255, 255, 255, 0.1))`);
    sidebarContainer.style.setProperty('--group-bg-color-dark', `var(--chrome-${tabGroup.color}-color-dark, rgba(255, 255, 255, 0.1))`);

    // Set up color select
    const colorSelect = tabGroupElement.querySelector('#tabGroupColorSelect');
    if (colorSelect) {
        colorSelect.value = tabGroup.color;
        colorSelect.addEventListener('change', async () => {
            const newColor = colorSelect.value;
            tabGroup.color = newColor;

            // Update tab group color (skip in unified view)
            if (tabGroup.id !== 'unified') {
                await chrome.tabGroups.update(parseInt(tabGroup.id), { color: newColor });
            }

            // Update tabGroup background color
            sidebarContainer.style.setProperty('--group-bg-color', `var(--chrome-${newColor}-color, rgba(255, 255, 255, 0.1))`);
            sidebarContainer.style.setProperty('--group-bg-color-dark', `var(--chrome-${newColor}-color-dark, rgba(255, 255, 255, 0.1))`);

            saveTabGroups();
            await updateTabGroupSwitcher();
        });
    }

    // Handle color swatch clicks
    const tabGroupOptionColorSwatch = tabGroupElement.querySelector('#tabGroupOptionColorSwatch');
    if (tabGroupOptionColorSwatch && colorSelect) {
        tabGroupOptionColorSwatch.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-swatch')) {
                const colorPicker = e.target.closest('.color-picker-grid');
                const color = e.target.dataset.color;

                // Update selected swatch
                colorPicker.querySelectorAll('.color-swatch').forEach(swatch => {
                    swatch.classList.remove('selected');
                });
                e.target.classList.add('selected');

                // Update hidden select value
                colorSelect.value = color;

                // Trigger change event on select
                const event = new Event('change');
                colorSelect.dispatchEvent(event);
            }
        });
    }

    // Set up tabGroup name input
    const nameInput = tabGroupElement.querySelector('.space-name');
    if (nameInput) {
        nameInput.value = tabGroup.name;
        nameInput.addEventListener('change', async () => {
            // Update bookmark folder name
            const oldName = tabGroup.name;
            const oldFolder = await LocalStorage.getOrCreateTabGroupFolder(oldName);
            await chrome.bookmarks.update(oldFolder.id, { title: nameInput.value });

            const tabGroups = await chrome.tabGroups.query({});
            const tabGroupForGroup = tabGroups.find(group => group.id === tabGroup.id);
            console.log("updating tabGroupForGroup", tabGroupForGroup);
            if (tabGroupForGroup) {
                await chrome.tabGroups.update(tabGroupForGroup.id, {title: nameInput.value, color: 'grey'});
            }

            tabGroup.name = nameInput.value;
            saveTabGroups();
            await updateTabGroupSwitcher();
        });
    }

    // Set up clean tabs button
    const cleanBtn = tabGroupElement.querySelector('.clean-tabs-btn');
    if (cleanBtn) {
        cleanBtn.addEventListener('click', () => cleanTemporaryTabs(tabGroup.id));
    }

    // Set up options menu
    const newFolderBtn = tabGroupElement.querySelector('.new-folder-btn');
    const deleteTabGroupBtn = tabGroupElement.querySelector('.delete-space-btn');

    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', () => {
            createNewFolder(tabGroupContainer);
        });
    }

    if (deleteTabGroupBtn) {
        deleteTabGroupBtn.addEventListener('click', () => {
            if (confirm('Delete this tabGroup and close all its tabs?')) {
                deleteTabGroup(tabGroup.id);
            }
        });
    }

    const popup = tabGroupElement.querySelector('.archived-tabs-popup');
    const archiveButton = tabGroupElement.querySelector('.sidebar-button');
    const tabGroupContent = tabGroupElement.querySelector('.tab-group-content');

    if (archiveButton && popup && tabGroupContent) {
        archiveButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing immediately if clicking outside logic exists
            tabGroupContent.classList.toggle('hidden');
            const isVisible = popup.style.opacity == 1;
            if (isVisible) {
                popup.classList.toggle('visible');
            } else {
                showArchivedTabsPopup(tabGroup.id); // Populate and show
                popup.classList.toggle('visible');
            }
        });
    }

    // Add to DOM FIRST
    console.log('📍 About to append to tabGroupsList:', !!tabGroupsList);
    tabGroupsList.appendChild(tabGroupElement);
    console.log('📍 Appended to DOM');
    
    // IMPORTANT: After appendChild, tabGroupElement (DocumentFragment) is empty!
    // We must query from the DOM using the tabGroup ID
    const tabGroupContainerInDOM = document.querySelector(`[data-group-id="${tabGroup.id}"]`);
    console.log('📍 Tab Group in DOM found:', !!tabGroupContainerInDOM);
    
    if (!tabGroupContainerInDOM) {
        console.error('❌ Tab Group container not found in DOM! Tab Group ID:', tabGroup.id);
        return;
    }
    
    // NOW get the containers from the DOM (not from the fragment)
    const tempContainer = tabGroupContainerInDOM.querySelector('[data-tab-type="temporary"]');

    // Set up drag and drop
    setupDragAndDrop(tempContainer);

    // Load tabs (async - runs in background) - AFTER containers are available
    loadTabs(tabGroup, tempContainer).catch(err => {
        console.error('Error in loadTabs:', err);
    });
    
    // Pinned section completely removed
    
    // Set up bookmarks section toggle
    const bookmarksToggle = document.querySelector(`[data-group-id="${space.id}"] .bookmarks-toggle`);
    const bookmarksContent = document.querySelector(`[data-group-id="${space.id}"] .bookmarks-content`);
    
    console.log('Setting up bookmarks toggle for tabGroup:', tabGroup.id, 'Toggle found:', !!bookmarksToggle, 'Content found:', !!bookmarksContent);
    
    if (bookmarksToggle && bookmarksContent) {
        // Load saved collapsed state from localStorage, default to collapsed (true)
        chrome.storage.local.get(['bookmarksSectionCollapsed'], (result) => {
            const collapsedTabGroups = result.bookmarksSectionCollapsed || {};
            const isCollapsed = collapsedTabGroups[space.id] !== undefined ? collapsedTabGroups[space.id] : true; // Default collapsed
            
            console.log('Loading bookmarks collapsed state for tabGroup:', tabGroup.id, 'isCollapsed:', isCollapsed);
            
            // Also apply to tree view container
            const bookmarksTreeContainer = document.querySelector(`[data-group-id="${space.id}"] .bookmarks-tree-container`);
            
            if (isCollapsed) {
                bookmarksToggle.classList.add('collapsed');
                bookmarksContent.classList.add('collapsed');
                if (bookmarksTreeContainer) bookmarksTreeContainer.classList.add('collapsed');
            } else {
                bookmarksToggle.classList.remove('collapsed');
                bookmarksContent.classList.remove('collapsed');
                if (bookmarksTreeContainer) bookmarksTreeContainer.classList.remove('collapsed');
            }
        });

        bookmarksToggle.addEventListener('click', (e) => {
            console.log('Bookmarks toggle clicked!', tabGroup.id);
            e.preventDefault();
            e.stopPropagation();
            
            const isCollapsed = bookmarksToggle.classList.toggle('collapsed');
            bookmarksContent.classList.toggle('collapsed');
            
            // Also toggle tree view container if it exists
            const bookmarksTreeContainer = document.querySelector(`[data-group-id="${space.id}"] .bookmarks-tree-container`);
            if (bookmarksTreeContainer) {
                bookmarksTreeContainer.classList.toggle('collapsed');
            }
            
            console.log('Bookmarks toggled to:', isCollapsed);
            
            // Save collapsed state to localStorage
            chrome.storage.local.get(['bookmarksSectionCollapsed'], (result) => {
                const collapsedTabGroups = result.bookmarksSectionCollapsed || {};
                collapsedTabGroups[space.id] = isCollapsed;
                chrome.storage.local.set({ bookmarksSectionCollapsed: collapsedTabGroups });
                console.log('Saved bookmarks collapsed state:', collapsedTabGroups);
            });
        });
        
        // Load and display bookmarks
        loadBookmarks(tabGroup.id);
    } else {
        console.error('Could not find bookmarks toggle or content for tabGroup:', tabGroup.id);
    }
    
    // Setup view mode toggle for this tabGroup (optional)
    const viewModeBtn = tabGroupContainerInDOM.querySelector('.view-mode-toggle');
    
    if (viewModeBtn) {
        console.log('Setting up view mode toggle for tabGroup:', tabGroup.id);
        viewModeBtn.addEventListener('click', async (e) => {
            console.log('View mode button clicked for tabGroup:', tabGroup.id);
            e.preventDefault();
            e.stopPropagation();
            await toggleTreeView(tabGroup.id);
        });
    }
    
    // Restore tree view state if it was previously enabled
    restoreTreeViewState(tabGroup.id);
}

async function restoreTreeViewState(groupId) {
    try {
        const result = await chrome.storage.local.get('treeViewStates');
        if (result.treeViewStates) {
            treeViewStates = result.treeViewStates;
            
            // If this tabGroup was in tree view mode, restore it
            if (treeViewStates[groupId]) {
                const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
                if (!tabGroupElement) return;
                
                const listContainer = tabGroupElement.querySelector('.tabs-container[data-tab-type="temporary"]');
                const treeContainer = tabGroupElement.querySelector('#tabsTreeContainer');
                const viewModeBtn = tabGroupElement.querySelector('.view-mode-toggle');
                
                if (listContainer && treeContainer && viewModeBtn) {
                    const listIcon = viewModeBtn.querySelector('.list-icon');
                    const treeIcon = viewModeBtn.querySelector('.tree-icon');
                    
                    listContainer.style.display = 'none';
                    treeContainer.style.display = 'block';
                    if (listIcon) listIcon.style.display = 'none';
                    if (treeIcon) treeIcon.style.display = 'block';
                    
                    // Only set isTreeViewMode and render if this is the active tabGroup
                    if (groupId === activeGroupId) {
                        isTreeViewMode = true;
                        await renderTreeView(groupId);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error restoring tree view state:', error);
    }
}

// Tree View Functions
function debouncedTreeViewRender(groupId, delay = 300) {
    if (treeViewRenderTimeout) {
        clearTimeout(treeViewRenderTimeout);
    }
    treeViewRenderTimeout = setTimeout(() => {
        renderTreeView(groupId);
    }, delay);
}

function groupTabsByDomain(tabs) {
    const groups = new Map();
    
    tabs.forEach(tab => {
        try {
            const url = new URL(tab.url);
            const domain = url.hostname || 'Unknown';
            
            if (!groups.has(domain)) {
                groups.set(domain, {
                    domain: domain,
                    tabs: [],
                    favicon: Utils.getFaviconUrl(tab.url)
                });
            }
            
            groups.get(domain).tabs.push(tab);
        } catch (error) {
            // Invalid URL, group under 'Unknown'
            if (!groups.has('Unknown')) {
                groups.set('Unknown', {
                    domain: 'Unknown',
                    tabs: [],
                    favicon: 'assets/default_icon.png'
                });
            }
            groups.get('Unknown').tabs.push(tab);
        }
    });
    
    // Sort groups by tab count (descending)
    return Array.from(groups.values()).sort((a, b) => b.tabs.length - a.tabs.length);
}

// Group tabs by domain and path segment for 2-level hierarchy
function groupTabsByDomainAndPath(tabs) {
    const groups = new Map();
    
    tabs.forEach(tab => {
        try {
            const url = new URL(tab.url);
            const domain = url.hostname || 'Unknown';
            const pathSegments = url.pathname.split('/').filter(s => s.length > 0);
            const subGroup = pathSegments.length > 0 ? pathSegments[0] : '(root)';
            
            // Create domain group if it doesn't exist
            if (!groups.has(domain)) {
                groups.set(domain, {
                    domain: domain,
                    favicon: Utils.getFaviconUrl(tab.url),
                    subGroups: new Map(),
                    isParent: true
                });
            }
            
            const domainGroup = groups.get(domain);
            
            // Create subgroup if it doesn't exist
            if (!domainGroup.subGroups.has(subGroup)) {
                domainGroup.subGroups.set(subGroup, {
                    name: subGroup,
                    tabs: [],
                    favicon: Utils.getFaviconUrl(tab.url)
                });
            }
            
            domainGroup.subGroups.get(subGroup).tabs.push(tab);
        } catch (error) {
            // Invalid URL, group under 'Unknown'
            if (!groups.has('Unknown')) {
                groups.set('Unknown', {
                    domain: 'Unknown',
                    favicon: 'assets/default_icon.png',
                    subGroups: new Map(),
                    isParent: true
                });
            }
            
            const unknownGroup = groups.get('Unknown');
            if (!unknownGroup.subGroups.has('(unknown)')) {
                unknownGroup.subGroups.set('(unknown)', {
                    name: '(unknown)',
                    tabs: [],
                    favicon: 'assets/default_icon.png'
                });
            }
            unknownGroup.subGroups.get('(unknown)').tabs.push(tab);
        }
    });
    
    // Convert subGroups Maps to arrays and sort
    const result = Array.from(groups.values()).map(group => {
        const subGroupsArray = Array.from(group.subGroups.values())
            .sort((a, b) => b.tabs.length - a.tabs.length);
        
        // Calculate total tabs count for the domain
        const totalTabs = subGroupsArray.reduce((sum, sg) => sum + sg.tabs.length, 0);
        
        return {
            ...group,
            subGroups: subGroupsArray,
            totalTabs: totalTabs
        };
    });
    
    // Sort groups by total tab count (descending)
    return result.sort((a, b) => b.totalTabs - a.totalTabs);
}

async function groupTabsByTabGroups(tabs) {
    const groups = new Map();
    const tabGroups = await chrome.tabGroups.query({ windowId: currentWindow.id });
    
    // Create a map of groupId to group info
    const groupInfoMap = new Map();
    tabGroups.forEach(group => {
        groupInfoMap.set(group.id, {
            id: group.id,
            title: group.title || 'Unnamed Group',
            color: group.color,
            collapsed: group.collapsed
        });
    });
    
    tabs.forEach(tab => {
        const groupId = tab.groupId;
        const groupKey = groupId === -1 ? 'ungrouped' : groupId;
        
        if (!groups.has(groupKey)) {
            const groupInfo = groupInfoMap.get(groupId);
            groups.set(groupKey, {
                groupId: groupId,
                groupName: groupId === -1 ? 'Ungrouped Tabs' : (groupInfo?.title || 'Unnamed Group'),
                groupColor: groupId === -1 ? 'grey' : (groupInfo?.color || 'grey'),
                tabs: [],
                favicon: 'assets/default_icon.png'
            });
        }
        
        groups.get(groupKey).tabs.push(tab);
    });
    
    // Sort groups: ungrouped tabs first, then grouped tabs by tab count
    return Array.from(groups.values()).sort((a, b) => {
        // Put ungrouped tabs first
        if (a.groupId === -1) return -1;
        if (b.groupId === -1) return 1;
        return b.tabs.length - a.tabs.length;
    });
}

async function renderTreeView(groupId) {
    console.log('=== renderTreeView START ===', groupId);
    try {
        const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        console.log('Space element found:', !!tabGroupElement);
        if (!tabGroupElement) return;
        
        const treeContainer = tabGroupElement.querySelector('#tabsTreeContainer');
        console.log('Tree container found:', !!treeContainer);
        if (!treeContainer) return;
        
        // Clear existing content
        treeContainer.innerHTML = '';
        console.log('Tree container cleared');
        
        // Get all temporary tabs for this tabGroup
        const tabGroup = tabGroups.find(s => s.id === groupId);
        console.log('Space found:', !!space, 'Space:', tabGroup);
        if (!tabGroup) return;
        
        // Get all tabs in the current window (not by groupId since we're in unified view)
        const tabs = await chrome.tabs.query({ currentWindow: true });
        console.log('All tabs in window:', tabs.length);
        
        const temporaryTabs = tabs.filter(tab => tabGroup.temporaryTabs.includes(tab.id));
        console.log('Temporary tabs:', temporaryTabs.length, temporaryTabs.map(t => ({ id: t.id, title: t.title })));
        
        if (temporaryTabs.length === 0) {
            treeContainer.innerHTML = '<div class="tab-placeholder">No temporary tabs</div>';
            console.log('No temporary tabs, showing placeholder');
            return;
        }
        
        // Group tabs by domain or domain+path depending on setting
        if (twoLevelHierarchy) {
            const groups = groupTabsByDomainAndPath(temporaryTabs);
            console.log('Grouped tabs by domain and path (2-level):', groups.length, 'groups');
            
            // Render each domain group with subgroups
            for (const group of groups) {
                console.log('Rendering 2-level domain group:', group.domain);
                const groupElement = await createTwoLevelDomainGroupElement(group, groupId);
                if (groupElement && treeContainer.isConnected) {
                    treeContainer.appendChild(groupElement);
                    console.log('2-level domain group element appended:', group.domain);
                }
            }
        } else {
            // Original single-level grouping
            const groups = groupTabsByDomain(temporaryTabs);
            console.log('Grouped tabs by domain:', groups.length, 'groups', groups.map(g => `${g.domain} (${g.tabs.length})`));
            
            // Render each domain group
            for (const group of groups) {
                console.log('Rendering domain group:', group.domain);
                const groupElement = await createDomainGroupElement(group, groupId);
                if (groupElement && treeContainer.isConnected) {
                    treeContainer.appendChild(groupElement);
                    console.log('Domain group element appended:', group.domain);
                }
            }
        }
        console.log('=== renderTreeView END ===');
        
        // Apply duplicate filtering if enabled
        if (hideDuplicates) {
            setTimeout(() => filterDuplicates(), 100);
        }
    } catch (error) {
        console.error('Error rendering tree view:', error);
    }
}

// Render bookmarks in tree view (grouped by domain)
async function renderBookmarksTreeView(groupId) {
    console.log('=== renderBookmarksTreeView START ===', groupId);
    try {
        const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        if (!tabGroupElement) {
            console.error('Space element not found for:', groupId);
            return;
        }
        
        const bookmarksTreeContainer = tabGroupElement.querySelector('.bookmarks-tree-container');
        if (!bookmarksTreeContainer) {
            console.error('Bookmarks tree container not found');
            return;
        }
        
        // Clear existing tree view
        bookmarksTreeContainer.innerHTML = '';
        
        // Get all bookmarks from Chrome
        const bookmarkTree = await chrome.bookmarks.getTree();
        const allBookmarks = [];
        
        // Recursively collect all bookmarks
        function collectBookmarks(node) {
            if (node.url) {
                allBookmarks.push({
                    title: node.title,
                    url: node.url
                });
            }
            if (node.children) {
                node.children.forEach(child => collectBookmarks(child));
            }
        }
        
        bookmarkTree.forEach(root => {
            root.children?.forEach(child => collectBookmarks(child));
        });
        
        if (allBookmarks.length === 0) {
            console.log('No bookmarks to display in tree view');
            return;
        }
        
        // Convert bookmarks to tab-like objects for grouping
        const bookmarkTabs = allBookmarks.map(bookmark => {
            const favicon = Utils.getFaviconUrl(bookmark.url);
            return {
                id: null,
                title: bookmark.title,
                url: bookmark.url,
                favIconUrl: favicon,
                isBookmark: true
            };
        });
        
        // Group bookmarks by domain or domain+path depending on setting
        if (twoLevelHierarchy) {
            const groups = groupTabsByDomainAndPath(bookmarkTabs);
            
            // Create 2-level domain group elements
            for (const group of groups) {
                const groupElement = await createTwoLevelDomainGroupElement(group, groupId, true);
                bookmarksTreeContainer.appendChild(groupElement);
            }
        } else {
            // Original single-level grouping
            const domainGroups = {};
            
            for (const bookmark of allBookmarks) {
                let domain = 'Unknown';
                try {
                    const url = new URL(bookmark.url);
                    domain = url.hostname || 'Unknown';
                } catch (error) {
                    domain = 'Unknown';
                }
                const favicon = Utils.getFaviconUrl(bookmark.url);
                
                if (!domainGroups[domain]) {
                    domainGroups[domain] = {
                        domain: domain,
                        favicon: favicon,
                        tabs: []
                    };
                }
                
                // Create a tab-like object for the bookmark
                domainGroups[domain].tabs.push({
                    id: null,
                    title: bookmark.title,
                    url: bookmark.url,
                    favIconUrl: favicon,
                    isBookmark: true
                });
            }
            
            // Convert to array and sort
            const groups = Object.values(domainGroups).sort((a, b) => 
                b.tabs.length - a.tabs.length
            );
            
            // Create domain group elements
            for (const group of groups) {
                const groupElement = await createDomainGroupElement(group, groupId, true);
                bookmarksTreeContainer.appendChild(groupElement);
            }
        }
        
        console.log('=== renderBookmarksTreeView END ===');
        
        // Apply duplicate filtering if enabled
        if (hideDuplicates) {
            setTimeout(() => filterDuplicates(), 100);
        }
    } catch (error) {
        console.error('Error rendering bookmarks tree view:', error);
    }
}

async function createDomainGroupElement(group, groupId, isBookmark = false) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tree-domain-group';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'tree-domain-header';
    
    // Expand icon
    const expandIcon = document.createElement('div');
    expandIcon.className = 'tree-expand-icon expanded';
    expandIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    
    // Domain icon (favicon)
    const domainIcon = document.createElement('img');
    domainIcon.className = 'tree-domain-icon';
    domainIcon.src = group.favicon;
    domainIcon.onerror = () => { domainIcon.src = 'assets/default_icon.png'; };
    
    // Domain name
    const domainName = document.createElement('div');
    domainName.className = 'tree-domain-name';
    domainName.textContent = group.domain;
    
    // Tab count
    const tabCount = document.createElement('div');
    tabCount.className = 'tree-domain-count';
    tabCount.textContent = group.tabs.length.toString();
    
    header.appendChild(expandIcon);
    header.appendChild(domainIcon);
    header.appendChild(domainName);
    header.appendChild(tabCount);
    
    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tree-domain-tabs expanded';
    
    // Apply a default color to make vertical lines visible
    // Use a neutral color for domain-grouped items (bookmarks)
    tabsContainer.style.setProperty('--group-line-color', 'var(--border-color)');
    
    // Create tab elements (needs to be async)
    for (const tab of group.tabs) {
        const tabElement = await createTreeTabElement(tab, groupId, isBookmark);
        tabsContainer.appendChild(tabElement);
    }
    
    // Toggle expand/collapse
    header.addEventListener('click', () => {
        const isExpanded = tabsContainer.classList.contains('expanded');
        if (isExpanded) {
            tabsContainer.classList.remove('expanded');
            expandIcon.classList.remove('expanded');
        } else {
            tabsContainer.classList.add('expanded');
            expandIcon.classList.add('expanded');
        }
    });
    
    groupDiv.appendChild(header);
    groupDiv.appendChild(tabsContainer);
    
    return groupDiv;
}

// Create a 2-level domain group element (domain -> path segment -> tabs)
async function createTwoLevelDomainGroupElement(group, groupId, isBookmark = false) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tree-domain-group two-level';
    
    // Create header for the domain (Level 1)
    const header = document.createElement('div');
    header.className = 'tree-domain-header';
    
    // Expand icon for domain
    const expandIcon = document.createElement('div');
    expandIcon.className = 'tree-expand-icon expanded';
    expandIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    
    // Domain icon (favicon)
    const domainIcon = document.createElement('img');
    domainIcon.className = 'tree-domain-icon';
    domainIcon.src = group.favicon;
    domainIcon.onerror = () => { domainIcon.src = 'assets/default_icon.png'; };
    
    // Domain name
    const domainName = document.createElement('div');
    domainName.className = 'tree-domain-name';
    domainName.textContent = group.domain;
    
    // Total tab count for domain
    const tabCount = document.createElement('div');
    tabCount.className = 'tree-domain-count';
    tabCount.textContent = group.totalTabs.toString();
    
    header.appendChild(expandIcon);
    header.appendChild(domainIcon);
    header.appendChild(domainName);
    header.appendChild(tabCount);
    
    // Create container for subgroups (Level 2)
    const subGroupsContainer = document.createElement('div');
    subGroupsContainer.className = 'tree-subgroups-container expanded';
    
    // Create each subgroup
    for (const subGroup of group.subGroups) {
        const subGroupDiv = document.createElement('div');
        subGroupDiv.className = 'tree-subgroup';
        
        // Subgroup header
        const subGroupHeader = document.createElement('div');
        subGroupHeader.className = 'tree-subgroup-header';
        
        // Expand icon for subgroup
        const subExpandIcon = document.createElement('div');
        subExpandIcon.className = 'tree-expand-icon expanded';
        subExpandIcon.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
        
        // Subgroup icon
        const subGroupIcon = document.createElement('img');
        subGroupIcon.className = 'tree-subgroup-icon';
        subGroupIcon.src = subGroup.favicon;
        subGroupIcon.onerror = () => { subGroupIcon.src = 'assets/default_icon.png'; };
        
        // Subgroup name
        const subGroupName = document.createElement('div');
        subGroupName.className = 'tree-subgroup-name';
        subGroupName.textContent = subGroup.name;
        
        // Subgroup tab count
        const subTabCount = document.createElement('div');
        subTabCount.className = 'tree-subgroup-count';
        subTabCount.textContent = subGroup.tabs.length.toString();
        
        subGroupHeader.appendChild(subExpandIcon);
        subGroupHeader.appendChild(subGroupIcon);
        subGroupHeader.appendChild(subGroupName);
        subGroupHeader.appendChild(subTabCount);
        
        // Create tabs container for subgroup
        const subTabsContainer = document.createElement('div');
        subTabsContainer.className = 'tree-subgroup-tabs expanded';
        subTabsContainer.style.setProperty('--group-line-color', 'var(--border-color)');
        
        // Create tab elements
        for (const tab of subGroup.tabs) {
            const tabElement = await createTreeTabElement(tab, groupId, isBookmark);
            subTabsContainer.appendChild(tabElement);
        }
        
        // Toggle expand/collapse for subgroup
        subGroupHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = subTabsContainer.classList.contains('expanded');
            if (isExpanded) {
                subTabsContainer.classList.remove('expanded');
                subExpandIcon.classList.remove('expanded');
            } else {
                subTabsContainer.classList.add('expanded');
                subExpandIcon.classList.add('expanded');
            }
        });
        
        subGroupDiv.appendChild(subGroupHeader);
        subGroupDiv.appendChild(subTabsContainer);
        subGroupsContainer.appendChild(subGroupDiv);
    }
    
    // Toggle expand/collapse for domain
    header.addEventListener('click', () => {
        const isExpanded = subGroupsContainer.classList.contains('expanded');
        if (isExpanded) {
            subGroupsContainer.classList.remove('expanded');
            expandIcon.classList.remove('expanded');
        } else {
            subGroupsContainer.classList.add('expanded');
            expandIcon.classList.add('expanded');
        }
    });
    
    groupDiv.appendChild(header);
    groupDiv.appendChild(subGroupsContainer);
    
    return groupDiv;
}

async function createTreeTabElement(tab, groupId, isBookmark = false) {
    const tabDiv = document.createElement('div');
    tabDiv.className = 'tree-tab-item';
    
    // Always store URL for search functionality
    tabDiv.dataset.url = tab.url;
    
    if (isBookmark || !tab.id) {
        // Bookmark-only item
        tabDiv.classList.add('inactive', 'bookmark-only');
    } else {
        tabDiv.dataset.tabId = tab.id;
        if (tab.active) {
            tabDiv.classList.add('active');
        }
    }
    
    // Favicon
    const favicon = document.createElement('img');
    favicon.className = 'tree-tab-favicon';
    favicon.src = Utils.getFaviconUrl(tab.url);
    favicon.onerror = () => { 
        favicon.src = tab.favIconUrl; 
        favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; }; 
    };
    
    // Title - check for overrides
    const title = document.createElement('div');
    title.className = 'tree-tab-title';
    
    if (!isBookmark && tab.id) {
    try {
        const overrides = await Utils.getTabNameOverrides();
        const override = overrides[tab.id];
        title.textContent = override ? override.name : tab.title;
    } catch (error) {
        // If tab no longer exists, just use the current title
            title.textContent = tab.title;
        }
    } else {
        // Bookmark
        title.textContent = tab.title;
    }
    
    // Close button (or remove button for bookmarks)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tree-tab-close';
    closeBtn.innerHTML = isBookmark ? '−' : '×';
    closeBtn.title = isBookmark ? 'Remove bookmark' : 'Close tab';
    closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isBookmark) {
            // For bookmarks, open in new tab
            chrome.tabs.create({ url: tab.url, active: false });
        } else {
        try {
            await chrome.tabs.remove(tab.id);
        } catch (error) {
            // Tab might already be closed, silently ignore
            console.log('Tab already closed:', tab.id);
            }
        }
    });
    
    // Click to activate tab or open bookmark
    tabDiv.addEventListener('click', async () => {
        if (isBookmark || !tab.id) {
            // Open bookmark
            chrome.tabs.create({ url: tab.url, active: true });
        } else {
        try {
            // Remove active class from all tree tabs
            document.querySelectorAll('.tree-tab-item').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tabDiv.classList.add('active');
            await chrome.tabs.update(tab.id, { active: true });
        } catch (error) {
            // Tab might no longer exist
            console.log('Cannot activate tab:', tab.id, error.message);
            tabDiv.remove();
            }
        }
    });
    
    // Middle-click to close tab
    tabDiv.addEventListener('mousedown', async (e) => {
        if (e.button === 1) { // Middle mouse button
            e.preventDefault();
            try {
                await chrome.tabs.remove(tab.id);
            } catch (error) {
                // Tab might already be closed
                console.log('Tab already closed:', tab.id);
            }
        }
    });
    
    // Context menu support
    tabDiv.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        try {
            const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
            const allBookmarkTabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            
            // Find the tab's actual groupId
            const tabGroupId = tab.groupId === -1 ? groupId : tab.groupId;
            const tabGroup = tabGroups.find(s => s.id === tabGroupId);
            const isPinned = tabGroup?.tabGroupBookmarks.includes(tab.id);
            
            // Get the list view tab element for closeTab function
            const listTabElement = document.querySelector(`[data-tab-id="${tab.id}"]`);
            
            showTabContextMenu(e.pageX, e.pageY, tab, isPinned, false, listTabElement, closeTab, tabGroups, moveTabToTabGroup, setActiveTabGroup, allBookmarkTabGroupFolders, createTabGroupFromInactive);
        } catch (error) {
            console.log('Error showing context menu for tab:', tab.id, error.message);
        }
    });
    
    tabDiv.appendChild(favicon);
    tabDiv.appendChild(title);
    tabDiv.appendChild(closeBtn);
    
    return tabDiv;
}

// Render all tabGroups as collapsible tab groups
// Deprecated - now using refreshTemporaryTabsList for unified view
async function renderAllTabGroupsAsTabGroups() {
    // This function is no longer used in unified view
    // Tab groups are now rendered via refreshTemporaryTabsList
    console.log('renderAllTabGroupsAsTabGroups is deprecated - using refreshTemporaryTabsList instead');
}

// Refresh temporary tabs list with tab groups
async function refreshTemporaryTabsList(groupId) {
    const tabGroup = tabGroups.find(s => s.id === groupId);
    if (!tabGroup) return;
    
    const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
    if (!tabGroupElement) return;
    
    const tempContainer = tabGroupElement.querySelector('[data-tab-type="temporary"]');
    if (!tempContainer) return;
    
    // Clear existing content
    tempContainer.innerHTML = '';
    
    // Get ALL tabs in current window (not just from one tabGroup)
    const allWindowTabs = await chrome.tabs.query({ currentWindow: true });
    const temporaryTabObjects = [];
    
    // Get bookmarked tab URLs to exclude them (from bookmarks section)
    const bookmarksContainer = tabGroupElement.querySelector('.bookmarks-content .bookmarks-list');
    const bookmarkedTabURLs = Array.from(bookmarksContainer?.querySelectorAll('.bookmark-item[data-url]') || [])
        .map(el => el.dataset.url);
    
    for (const tab of allWindowTabs) {
        // Skip pinned tabs and bookmarked tabs
        if (!tab.pinned && !bookmarkedTabURLs.includes(tab.url)) {
            temporaryTabObjects.push(tab);
        }
    }
    
    // Group and render tabs by Chrome tab groups
    if (temporaryTabObjects.length > 0) {
        const tabGroups = await groupTabsByTabGroups(temporaryTabObjects);
        
        for (const group of tabGroups) {
            // Render ungrouped tabs directly without group wrapper
            if (group.groupId === -1) {
                for (const tab of group.tabs) {
                    const tabElement = await createTabElement(tab);
                    tempContainer.appendChild(tabElement);
                }
            } else {
                // Render grouped tabs with group wrapper
                const groupElement = await createListTabGroupElement(group, groupId);
                tempContainer.appendChild(groupElement);
            }
        }
    }
    
    // Apply duplicate filtering if enabled
    if (hideDuplicates) {
        setTimeout(() => filterDuplicates(), 100);
    }
}

// List View Tab Group Element
async function createListTabGroupElement(group, groupId) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'list-tab-group';
    groupDiv.dataset.groupId = group.groupId;
    
    // Create header
    const header = document.createElement('div');
    header.className = 'list-tab-group-header';
    
    // Add color indicator bar
    if (group.groupColor && group.groupId !== -1) {
        header.style.borderLeft = `3px solid var(--tab-group-${group.groupColor})`;
        header.style.paddingLeft = '5px';
    }
    
    // Expand icon
    const expandIcon = document.createElement('div');
    expandIcon.className = 'list-expand-icon expanded';
    expandIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    
    // Group name
    const groupName = document.createElement('div');
    groupName.className = 'list-tab-group-name';
    groupName.textContent = group.groupName;
    
    // Tab count
    const tabCount = document.createElement('div');
    tabCount.className = 'list-tab-group-count';
    tabCount.textContent = group.tabs.length.toString();
    
    header.appendChild(expandIcon);
    header.appendChild(groupName);
    header.appendChild(tabCount);
    
    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'list-tab-group-tabs expanded';
    
    // Apply group color to tabs container for vertical line
    if (group.groupColor && group.groupId !== -1) {
        tabsContainer.style.setProperty('--group-line-color', `var(--tab-group-${group.groupColor})`);
    }
    
    // Create tab elements
    for (const tab of group.tabs) {
        const tabElement = await createTabElement(tab);
        tabsContainer.appendChild(tabElement);
    }
    
    // Toggle expand/collapse
    header.addEventListener('click', () => {
        const isExpanded = tabsContainer.classList.contains('expanded');
        if (isExpanded) {
            tabsContainer.classList.remove('expanded');
            expandIcon.classList.remove('expanded');
        } else {
            tabsContainer.classList.add('expanded');
            expandIcon.classList.add('expanded');
        }
    });
    
    groupDiv.appendChild(header);
    groupDiv.appendChild(tabsContainer);
    
    return groupDiv;
}

// Export toggleTreeView to window so it can be called from toolbar
window.toggleTreeView = async function toggleTreeView(groupId) {
    console.log('toggleTreeView called for tabGroup:', groupId);
    
    const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
    if (!tabGroupElement) {
        console.error('Space element not found for tabGroup:', groupId);
        return;
    }
    
    const tempListContainer = tabGroupElement.querySelector('.tabs-container[data-tab-type="temporary"]');
    const tempTreeContainer = tabGroupElement.querySelector('#tabsTreeContainer');
    const bookmarksListContainer = tabGroupElement.querySelector('.bookmarks-content.list-view');
    const bookmarksTreeContainer = tabGroupElement.querySelector('.bookmarks-tree-container');
    const viewModeBtn = tabGroupElement.querySelector('.view-mode-toggle');
    
    console.log('Elements found:', { tempListContainer, tempTreeContainer, bookmarksListContainer, bookmarksTreeContainer, viewModeBtn });
    
    if (!tempListContainer || !tempTreeContainer) {
        console.error('Missing required elements');
        return;
    }
    
    const listIcon = viewModeBtn?.querySelector('.list-icon');
    const treeIcon = viewModeBtn?.querySelector('.tree-icon');
    
    if (tempListContainer.style.display === 'none') {
        // Switch to list view for all sections
        console.log('Switching to list view');
        tempListContainer.style.display = 'flex';
        tempTreeContainer.style.display = 'none';
        if (bookmarksListContainer) bookmarksListContainer.style.display = 'block';
        if (bookmarksTreeContainer) bookmarksTreeContainer.style.display = 'none';
        if (listIcon) listIcon.style.display = 'block';
        if (treeIcon) treeIcon.style.display = 'none';
        isTreeViewMode = false;
        treeViewStates[groupId] = false;
    } else {
        // Switch to tree view for all sections
        console.log('Switching to tree view');
        tempListContainer.style.display = 'none';
        tempTreeContainer.style.display = 'block';
        if (bookmarksListContainer) bookmarksListContainer.style.display = 'none';
        if (bookmarksTreeContainer) bookmarksTreeContainer.style.display = 'block';
        if (listIcon) listIcon.style.display = 'none';
        if (treeIcon) treeIcon.style.display = 'block';
        isTreeViewMode = true;
        treeViewStates[groupId] = true;
        
        // Render tree view for bookmarks and temporary tabs
        console.log('Rendering tree view for bookmarks and temporary tabs in tabGroup:', groupId);
        await renderTreeView(groupId);
        await renderBookmarksTreeView(groupId);
        console.log('Tree view render complete');
    }
    
    // Save tree view states to storage
    console.log('Saving tree view state:', treeViewStates);
    chrome.storage.local.set({ treeViewStates });
}

async function updateTabGroupSwitcher() {
    // In unified view, tabGroup switcher is not used
    if (!tabGroupSwitcher) return;
    
    console.log('Updating tabGroup switcher...');
    tabGroupSwitcher.innerHTML = '';

    // --- Drag and Drop State ---
    let draggedButton = null;

    // --- Add listeners to the container ---
    tabGroupSwitcher.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        const currentlyDragged = document.querySelector('.dragging-switcher');
        if (!currentlyDragged) return; // Don't do anything if not dragging a switcher button

        const afterElement = getDragAfterElementSwitcher(tabGroupSwitcher, e.clientX);

        // Remove placeholder classes from all buttons first
        const buttons = tabGroupSwitcher.querySelectorAll('button');
        buttons.forEach(button => {
            button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
        });

        // Add placeholder class to the appropriate element
        if (afterElement) {
            // Add margin *before* the element we'd insert before
            afterElement.classList.add('drag-over-placeholder-before');
        } else {
            // If afterElement is null, we are dropping at the end.
            // Add margin *after* the last non-dragging element.
            const lastElement = tabGroupSwitcher.querySelector('button:not(.dragging-switcher):last-of-type');
            if (lastElement) {
                 lastElement.classList.add('drag-over-placeholder-after');
            }
        }

        // --- Remove this block ---
        // We no longer move the element during dragover, rely on CSS placeholders
        /*
        if (currentlyDragged) {
            if (afterElement == null) {
                tabGroupSwitcher.appendChild(currentlyDragged);
            } else {
                tabGroupSwitcher.insertBefore(currentlyDragged, afterElement);
            }
        }
        */
       // --- End of removed block ---
    });

    tabGroupSwitcher.addEventListener('dragleave', (e) => {
        // Simple cleanup: remove placeholders if the mouse leaves the container area
        // More robust check might involve relatedTarget, but this is often sufficient
        if (e.target === tabGroupSwitcher) {
             const buttons = tabGroupSwitcher.querySelectorAll('button');
             buttons.forEach(button => {
                 button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
             });
        }
    });

    tabGroupSwitcher.addEventListener('drop', async (e) => {
        e.preventDefault();

         // Ensure placeholders are removed after drop
         const buttons = tabGroupSwitcher.querySelectorAll('button');
         buttons.forEach(button => {
             button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
         });

        if (draggedButton) {
            const targetElement = e.target.closest('button'); // Find the button dropped onto or near
            const draggedGroupId = parseInt(draggedButton.dataset.groupId);
            let targetGroupId = targetElement ? parseInt(targetElement.dataset.groupId) : null;

            // Find original index
            const originalIndex = tabGroups.findIndex(s => s.id === draggedGroupId);
            if (originalIndex === -1) return; // Should not happen

            const draggedTabGroup = tabGroups[originalIndex];

            // Remove from original position
            tabGroups.splice(originalIndex, 1);

            // Find new index
            let newIndex;
            if (targetGroupId) {
                const targetIndex = tabGroups.findIndex(s => s.id === targetGroupId);
                 // Determine if dropping before or after the target based on drop position relative to target center
                 const targetRect = targetElement.getBoundingClientRect();
                 const dropX = e.clientX; // *** Use clientX ***
                 if (dropX < targetRect.left + targetRect.width / 2) { // *** Use left and width ***
                     newIndex = targetIndex; // Insert before target
                 } else {
                     newIndex = targetIndex + 1; // Insert after target
                 }

            } else {
                 // If dropped not on a specific button (e.g., empty area), append to end
                 newIndex = tabGroups.length;
            }

            // Insert at new position
            // Ensure newIndex is within bounds (can happen if calculation is slightly off at edges)
            // newIndex = Math.max(0, Math.min(newIndex, tabGroups.length));
            console.log("droppedat", newIndex);

            if (newIndex < 0) {
                newIndex = 0;
            } else if (newIndex > tabGroups.length) {
                newIndex = tabGroups.length;
            }
            console.log("set", newIndex);

            tabGroups.splice(newIndex, 0, draggedTabGroup);

            // Save and re-render
            saveTabGroups();
            await updateTabGroupSwitcher(); // Re-render to reflect new order and clean up listeners
        }
        draggedButton = null; // Reset dragged item
    });


    tabGroups.forEach(space => {
        const button = document.createElement('button');
        button.textContent = tabGroup.name;
        button.dataset.groupId = tabGroup.id; // Store tabGroup ID
        button.classList.toggle('active', tabGroup.id === activeGroupId);
        button.draggable = true; // Make the button draggable

        button.addEventListener('click', async () => {
            if (button.classList.contains('dragging-switcher')) return;

            console.log("clicked for active", tabGroup);
            await setActiveTabGroup(tabGroup.id);
        });

        // --- Drag Event Listeners for Buttons ---
        button.addEventListener('dragstart', (e) => {
            draggedButton = button; // Store the button being dragged
            // Use a specific class to avoid conflicts with tab dragging
            setTimeout(() => button.classList.add('dragging-switcher'), 0);
            e.dataTransfer.effectAllowed = 'move';
            // Optional: Set drag data if needed elsewhere, though not strictly necessary for reordering within the same list
            // e.dataTransfer.setData('text/plain', tabGroup.id);
        });

        button.addEventListener('dragend', () => {
            // Clean up placeholders and dragging class on drag end (cancel/drop outside)
            const buttons = tabGroupSwitcher.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
            });
            if (draggedButton) { // Check if draggedButton is still set
                draggedButton.classList.remove('dragging-switcher');
            }
            draggedButton = null; // Ensure reset here too
        });

        tabGroupSwitcher.appendChild(button);
    });

    // Inactive tabGroup from bookmarks
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    tabGroupFolders.forEach(tabGroupFolder => {
        if(tabGroups.find(space => tabGroup.name == tabGroupFolder.title)) {
            return;
        } else {
            const button = document.createElement('button');
            button.textContent = tabGroupFolder.title;
            button.addEventListener('click', async () => {
                const newTab = await ChromeHelper.createNewTab();
                await createTabGroupFromInactive(tabGroupFolder.title, newTab);
            });
            tabGroupSwitcher.appendChild(button);
        }
    });

    // const tabGroupFolder = tabGroupFolders.find(f => f.title === tabGroup.name);

}

function getDragAfterElementSwitcher(container, x) {
    const draggableElements = [...container.querySelectorAll('button:not(.dragging-switcher)')]; // Select only non-dragging buttons

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        // *** Calculate offset based on X axis (left and width) ***
        const offset = x - box.left - box.width / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging), .folder:not(.dragging)')]

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child }
        } else {
            return closest
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element
}

async function setActiveTabGroup(groupId, updateTab = true) {
    console.log('Setting active tabGroup:', groupId);

    // Update global state
    activeGroupId = groupId;
    
    // Update tree view mode based on this tabGroup's state
    isTreeViewMode = treeViewStates[groupId] || false;

    // Centralize logic in our new helper function
    await activateTabGroupInDOM(groupId, tabGroups, updateTabGroupSwitcher);

    // In unified view, we don't need to manage Chrome tab group collapse states
    // All tab groups are shown as collapsible sections within the Tabs area
    
    // Apply duplicate filtering if enabled
    if (hideDuplicates) {
        setTimeout(() => filterDuplicates(), 200);
    }
}

async function createTabGroupFromInactive(groupName, tabToMove) {
    console.log(`Creating inactive tabGroup "${groupName}" with tab:`, tabToMove);
    isCreatingTabGroup = true;
    try {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const tabGroupFolder = tabGroupFolders.find(f => f.title === groupName);

        if (!tabGroupFolder) {
            console.error(`Bookmark folder for inactive tabGroup "${groupName}" not found.`);
            return;
        }

        const groupColor = await Utils.getTabGroupColor(groupName);
        const groupId = await ChromeHelper.createNewTabGroup(tabToMove, groupName, groupColor);
        const tabGroupBookmarks = await Utils.processBookmarkFolder(tabGroupFolder, groupId);

        const tabGroup = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: groupName,
            color: groupColor,
            tabGroupBookmarks: tabGroupBookmarks,
            temporaryTabs: [tabToMove.id],
            lastTab: tabToMove.id,
        };

        // Remove the moved tab from its old tabGroup
        const oldTabGroup = tabGroups.find(s => 
            s.temporaryTabs.includes(tabToMove.id) || s.tabGroupBookmarks.includes(tabToMove.id)
        );
        if (oldTabGroup) {
            oldTabGroup.temporaryTabs = oldTabGroup.temporaryTabs.filter(id => id !== tabToMove.id);
            oldTabGroup.tabGroupBookmarks = oldTabGroup.tabGroupBookmarks.filter(id => id !== tabToMove.id);
        }
        
        // Remove the tab's DOM element from the old tabGroup's UI
        const tabElementToRemove = document.querySelector(`[data-tab-id="${tabToMove.id}"]`);
        if (tabElementToRemove) {
            tabElementToRemove.remove();
        }

        tabGroups.push(tabGroup);
        saveTabGroups();
        createTabGroupElement(tabGroup);
        await setActiveTabGroup(tabGroup.id);
        updateTabGroupSwitcher();
    } catch (error) {
        console.error(`Error creating tabGroup from inactive bookmark:`, error);
    } finally {
        isCreatingTabGroup = false;
    }
}

function saveTabGroups() {
    console.log('Saving tabGroups to storage...', tabGroups);
    chrome.storage.local.set({ tabGroups }, () => {
        console.log('Spaces saved successfully');
    });
}

// moveTabToPinned removed - pinned section removed completely

async function moveTabToTemp(tabGroup, tab) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    const tabGroupFolder = tabGroupFolders.find(f => f.title === tabGroup.name);

    if (tabGroupFolder) {
        await Utils.searchAndRemoveBookmark(tabGroupFolder.id, tab.url);
    }

    // Move tab from bookmarks to temporary tabs in tabGroup data
    tabGroup.tabGroupBookmarks = tabGroup.tabGroupBookmarks.filter(id => id !== tab.id);
    if (!space.temporaryTabs.includes(tab.id)) {
        tabGroup.temporaryTabs.push(tab.id);
    }

    saveTabGroups();
}

async function setupDragAndDrop(tempContainer) {
    console.log('Setting up drag and drop handlers...');
    [tempContainer].forEach(container => {
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging');
            if (draggingElement) {
                const targetFolder = e.target.closest('.folder-content');
                const targetContainer = targetFolder || container;

                // Get the element we're dragging over
                const afterElement = getDragAfterElement(targetContainer, e.clientY);
                if (afterElement) {
                    targetContainer.insertBefore(draggingElement, afterElement);
                } else {
                    targetContainer.appendChild(draggingElement);
                }

                // Handle tab being moved to folder
                if (container.classList.contains('folder-content') && draggingElement.dataset.tabId && !isDraggingTab) {
                    console.log("Tab dragged to folder");
                    isDraggingTab = true;
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.get(tabId, async (tab) => {
                        const groupId = container.closest('.space').dataset.groupId;
                        const tabGroup = tabGroups.find(s => s.id === parseInt(groupId));

                        if (space && tab) {
                            // Move tab from temporary to folder in tabGroup data
                            tabGroup.temporaryTabs = tabGroup.temporaryTabs.filter(id => id !== tabId);
                            if (!space.tabGroupBookmarks.includes(tabId)) {
                                tabGroup.tabGroupBookmarks.push(tabId);
                            }

                            // Determine the target folder or container
                            const targetFolderContent = draggingElement.closest('.folder-content');
                            const targetFolder = targetFolderContent ? targetFolderContent.closest('.folder') : null;

                            // Add to bookmarks if URL doesn't exist
                            const tabGroupFolder = await LocalStorage.getOrCreateTabGroupFolder(tabGroup.name);
                            if (tabGroupFolder) {
                                let parentId = tabGroupFolder.id;
                                if (targetFolder) {
                                    console.log("moving into a folder");
                                    const folderElement = targetFolder.closest('.folder');
                                    const folderName = folderElement.querySelector('.folder-name').value;
                                    const existingFolders = await chrome.bookmarks.getChildren(tabGroupFolder.id);
                                    let folder = existingFolders.find(f => f.title === folderName);
                                    if (!folder) {
                                        folder = await chrome.bookmarks.create({
                                            parentId: tabGroupFolder.id,
                                            title: folderName
                                        });
                                    }
                                    parentId = folder.id;

                                    // Check if bookmark already exists in the target folder
                                    const existingBookmarks = await chrome.bookmarks.getChildren(parentId);
                                    if (existingBookmarks.some(b => b.url === tab.url)) {
                                        console.log('Bookmark already exists in folder:', folderName);
                                        isDraggingTab = false;
                                        return;
                                    }

                                    // Find and remove the bookmark from its original location
                                    await Utils.searchAndRemoveBookmark(tabGroupFolder.id, tab.url);

                                    // Create the bookmark in the new location
                                    await chrome.bookmarks.create({
                                        parentId: parentId,
                                        title: tab.title,
                                        url: tab.url
                                    });

                                    // hide placeholder
                                    const placeHolderElement = folderElement.querySelector('.tab-placeholder');
                                    if (placeHolderElement) {
                                        console.log("hiding from", folderElement);
                                        placeHolderElement.classList.add('hidden');
                                    }
                                }
                                // moveTabToPinned call removed - pinned section removed
                            }

                            saveTabGroups();
                        }
                        isDraggingTab = false;
                    });
                } else if (container.dataset.tabType === 'temporary' && draggingElement.dataset.tabId && !isDraggingTab) {
                    console.log("Tab dragged to temporary section");
                    isDraggingTab = true;
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.get(tabId, async (tab) => {
                        const tabGroup = tabGroups.find(s => s.id === parseInt(activeGroupId));

                        if (space && tab) {
                            // Remove tab from bookmarks if it exists
                            moveTabToTemp(tabGroup, tab);
                        }
                        isDraggingTab = false;
                    });
                }
                // Pinned favicon dragging removed
            }
        });
    });
}

async function createNewFolder(tabGroupElement) {
    const bookmarksContainer = tabGroupElement.querySelector('.bookmarks-content .bookmarks-list');
    const folderTemplate = document.getElementById('folderTemplate');
    const newFolder = folderTemplate.content.cloneNode(true);
    const folderElement = newFolder.querySelector('.folder');
    const folderHeader = folderElement.querySelector('.folder-header');
    const folderTitle = folderElement.querySelector('.folder-title');
    const folderNameInput = folderElement.querySelector('.folder-name');
    const folderIcon = folderElement.querySelector('.folder-icon');
    const folderToggle = folderElement.querySelector('.folder-toggle');
    const folderContent = folderElement.querySelector('.folder-content');

    // Apply color to folder content for visible lines
    folderContent.style.setProperty('--group-line-color', 'var(--border-color)');

    // Open new folder by default
    folderElement.classList.toggle('collapsed');
    folderContent.classList.toggle('collapsed');
    folderToggle.classList.toggle('collapsed');

    folderHeader.addEventListener('click', () => {
        folderElement.classList.toggle('collapsed');
        folderContent.classList.toggle('collapsed');
        folderToggle.classList.toggle('collapsed');
        folderIcon.innerHTML = folderElement.classList.contains('collapsed') ? FOLDER_CLOSED_ICON : FOLDER_OPEN_ICON;
    });

    // Set up folder name input
    folderNameInput.addEventListener('change', async () => {
        const groupName = tabGroupElement.querySelector('.space-name').value;
        const tabGroupFolder = await LocalStorage.getOrCreateTabGroupFolder(groupName);
        const existingFolders = await chrome.bookmarks.getChildren(tabGroupFolder.id);
        const folder = existingFolders.find(f => f.title === folderNameInput.value);
        if (!folder) {
            await chrome.bookmarks.create({
                parentId: tabGroupFolder.id,
                title: folderNameInput.value
            });
            folderNameInput.classList.toggle('hidden');
            folderTitle.innerHTML = folderNameInput.value;
            folderTitle.classList.toggle('hidden');
        }
    });

    // Add the new folder to the bookmarks container
    bookmarksContainer.appendChild(folderElement);
    folderNameInput.focus();
}

async function loadTabs(tabGroup, tempContainer) {
    console.log('Loading tabs for tabGroup:', tabGroup.id);

    try {
        const tabs = await chrome.tabs.query({});

        // Get bookmarked tab URLs to exclude them
        const tabGroupElement = document.querySelector(`[data-group-id="${space.id}"]`);
        const bookmarksContainer = tabGroupElement?.querySelector('.bookmarks-content .bookmarks-list');
        const bookmarkedTabURLs = Array.from(bookmarksContainer?.querySelectorAll('.bookmark-item[data-url]') || [])
            .map(el => el.dataset.url);

        // Load ALL tabs grouped by Chrome tab groups
        const allWindowTabs = await chrome.tabs.query({ currentWindow: true });
        console.log('📊 loadTabs: Found', allWindowTabs.length, 'total tabs in window');
        const temporaryTabObjects = [];
        
        for (const tab of allWindowTabs) {
            // Skip pinned tabs and bookmarked tabs
            if (!tab.pinned && !bookmarkedTabURLs.includes(tab.url)) {
                temporaryTabObjects.push(tab);
            }
        }
        
        console.log('📊 loadTabs: After filtering:', temporaryTabObjects.length, 'temporary tabs');
        console.log('📊 loadTabs: Container exists?', !!tempContainer);
        
        // Group tabs by Chrome tab groups
        if (temporaryTabObjects.length > 0) {
            const tabGroups = await groupTabsByTabGroups(temporaryTabObjects);
            console.log('📊 loadTabs: Grouped into', tabGroups.length, 'tab groups');
            
            // Render each tab group
            for (const group of tabGroups) {
                console.log('📊 loadTabs: Rendering group:', group.groupName, 'with', group.tabs.length, 'tabs');
                
                // Render ungrouped tabs directly without group wrapper
                if (group.groupId === -1) {
                    for (const tab of group.tabs) {
                        const tabElement = await createTabElement(tab);
                        tempContainer.appendChild(tabElement);
                    }
                } else {
                    // Render grouped tabs with group wrapper
                    const groupElement = await createListTabGroupElement(group, tabGroup.id);
                    tempContainer.appendChild(groupElement);
                }
            }
            console.log('📊 loadTabs: All groups appended to container');
        } else {
            console.warn('⚠️ loadTabs: No temporary tabs to display!');
        }
    } catch (error) {
        console.error('Error loading tabs:', error);
    }
}

async function closeTab(tabElement, tab, isPinned = false, isBookmarkOnly = false) {
    console.log('Closing tab:', tab, tabElement, isPinned, isBookmarkOnly);

    if (isBookmarkOnly) {
        // Remove from bookmarks
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const activeTabGroup = tabGroups.find(s => s.id === activeGroupId);

        const tabGroupFolder = tabGroupFolders.find(f => f.title === activeTabGroup.name);
        console.log("tabGroupFolder", tabGroupFolder);
        if (tabGroupFolder) {
            await Utils.searchAndRemoveBookmark(tabGroupFolder.id, tab.url, {
                removeTabElement: true,
                tabElement: tabElement,
                logRemoval: true
            });
        }

        return;
    }

    // In unified view, skip the "prevent closing last tab in group" check
    // since we're not managing Chrome tab groups as tabGroups
    if (activeGroupId !== 'unified') {
        // If last tab is closed, create a new empty tab to prevent tab group from closing
        const tabsInGroup = await chrome.tabs.query({ groupId: parseInt(activeGroupId) });
        console.log("tabsInGroup", tabsInGroup);
        if (tabsInGroup.length < 2) {
            console.log("creating new tab");
            await createNewTab(async () => {
                closeTab(tabElement, tab, isPinned, isBookmarkOnly);
            });
            return;
        }
    }
    const activeTabGroup = tabGroups.find(s => s.id === activeGroupId);
    console.log("activeTabGroup", activeTabGroup);
    const isCurrentlyPinned = activeTabGroup?.tabGroupBookmarks.includes(tab.id);
    const isCurrentlyTemporary= activeTabGroup?.temporaryTabs.includes(tab.id);
    console.log("isCurrentlyPinned", isCurrentlyPinned, "isCurrentlyTemporary", isCurrentlyTemporary, "isPinned", isPinned);
    if (isCurrentlyPinned || (isPinned && !isCurrentlyTemporary)) {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

        const tabGroupFolder = tabGroupFolders.find(f => f.title === activeTabGroup.name);
        console.log("tabGroupFolder", tabGroupFolder);
        if (tabGroupFolder) {
            console.log("tab", tab);

            // For actual tabs, check overrides
            const overrides = await Utils.getTabNameOverrides();
            const override = overrides[tab.id];
            const displayTitle = override ? override.name : tab.title;

            const bookmarkTab = {
                id: null,
                title: displayTitle,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                groupName: tab.groupName
            };
            const inactiveTabElement = await createTabElement(bookmarkTab, true, true);
            tabElement.replaceWith(inactiveTabElement);

            chrome.tabs.remove(tab.id);
            return;
        }
    } else {
        chrome.tabs.remove(tab.id);
        // Remove the tab element from the DOM
        tabElement.remove();
    }
}

async function createTabElement(tab, isPinned = false, isBookmarkOnly = false) {
    console.log('Creating tab element:', tab.id, 'IsBookmarkOnly:', isBookmarkOnly);
    const tabElement = document.createElement('div');
    tabElement.classList.add('tab');
    
    // Always store URL for search functionality
    tabElement.dataset.url = tab.url;
    
    if (isBookmarkOnly) {
        tabElement.classList.add('inactive', 'bookmark-only'); // Add specific class for styling
    } else {
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true;
        if (tab.active) {
            tabElement.classList.add('active');
        }
    }

    const favicon = document.createElement('img');
    favicon.src = Utils.getFaviconUrl(tab.url);
    favicon.classList.add('tab-favicon');
    favicon.onerror = () => { 
        favicon.src = tab.favIconUrl; 
        favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; }; // Fallback favicon
    }; // Fallback favicon

    // --- Renaming Elements ---
    const tabDetails = document.createElement('div');
    tabDetails.className = 'tab-details';

    const titleDisplay = document.createElement('span');
    titleDisplay.className = 'tab-title-display';

    const domainDisplay = document.createElement('span');
    domainDisplay.className = 'tab-domain-display';
    domainDisplay.style.display = 'none'; // Hide initially

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'tab-title-input';
    titleInput.style.display = 'none'; // Hide initially
    titleInput.spellcheck = false; // Optional: disable spellcheck

    tabDetails.appendChild(titleDisplay);
    tabDetails.appendChild(domainDisplay);
    tabDetails.appendChild(titleInput);
    // --- End Renaming Elements ---

    const actionButton = document.createElement('button');
    actionButton.classList.add(isBookmarkOnly ? 'tab-remove' : 'tab-close'); // Use 'tab-remove' for bookmarks
    actionButton.innerHTML = isBookmarkOnly ? '−' : '×'; // Use minus for remove, times for close
    actionButton.title = isBookmarkOnly ? 'Remove Bookmark' : 'Close Tab';
    actionButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const activeTabGroup = tabGroups.find(s => s.id === activeGroupId);
        console.log("activeTabGroup", activeTabGroup);
        const isCurrentlyPinned = activeTabGroup?.tabGroupBookmarks.includes(tab.id);
        closeTab(tabElement, tab, isCurrentlyPinned, isBookmarkOnly);
    });

    tabElement.appendChild(favicon);
    tabElement.appendChild(tabDetails); // Add the details container
    tabElement.appendChild(actionButton);

    // --- Function to update display based on overrides ---
    const updateDisplay = async () => {
        // For bookmark-only elements, just display the stored title
        if (isBookmarkOnly) {
            titleDisplay.textContent = tab.title || 'Bookmark'; // Use stored title
            titleDisplay.style.display = 'inline';
            titleInput.style.display = 'none';
            domainDisplay.style.display = 'none';
            return;
        }

        // For actual tabs, check overrides
        const overrides = await Utils.getTabNameOverrides();
        const override = overrides[tab.id];
        let displayTitle = tab.title; // Default to actual tab title
        let displayDomain = null;

        titleInput.value = tab.title; // Default input value is current tab title

        if (override) {
            displayTitle = override.name;
            titleInput.value = override.name; // Set input value to override name
            try {
                // Check if current domain differs from original override domain
                const currentDomain = new URL(tab.url).hostname;
                if (override.originalDomain && currentDomain !== override.originalDomain) {
                    displayDomain = currentDomain;
                }
            } catch (e) {
                console.warn("Error parsing URL for domain check:", tab.url, e);
            }
        }

        titleDisplay.textContent = displayTitle;
        if (displayDomain) {
            domainDisplay.textContent = displayDomain;
            domainDisplay.style.display = 'block';
        } else {
            domainDisplay.style.display = 'none';
        }

        // Ensure correct elements are visible
        titleDisplay.style.display = 'inline'; // Or 'block' if needed
        titleInput.style.display = 'none';
    };

    // --- Event Listeners for Editing (Only for actual tabs) ---
    if (!isBookmarkOnly) {
        tabDetails.addEventListener('dblclick', (e) => {
            // Prevent dblclick on favicon or close button from triggering rename
            if (e.target === favicon || e.target === actionButton) return;

            titleDisplay.style.display = 'none';
            domainDisplay.style.display = 'none'; // Hide domain while editing
            titleInput.style.display = 'inline-block'; // Or 'block'
            titleInput.select(); // Select text for easy replacement
            titleInput.focus(); // Focus the input
        });

        const saveOrCancelEdit = async (save) => {
            if (save) {
                const newName = titleInput.value.trim();
                try {
                    // Fetch the latest tab info in case the title changed naturally
                    const currentTabInfo = await chrome.tabs.get(tab.id);
                    const originalTitle = currentTabInfo.title;
                    const activeTabGroup = tabGroups.find(s => s.id === activeGroupId);

                    if (newName && newName !== originalTitle) {
                        await Utils.setTabNameOverride(tab.id, tab.url, newName);
                        if (isPinned) {
                            await Utils.updateBookmarkTitleIfNeeded(tab, activeTabGroup, newName);
                        }
                    } else {
                        // If name is empty or same as original, remove override
                        await Utils.removeTabNameOverride(tab.id);
                        if (isPinned) {
                            await Utils.updateBookmarkTitleIfNeeded(tab, activeTabGroup, originalTitle);
                        }
                    }
                } catch (error) {
                    console.error("Error getting tab info or saving override:", error);
                    // Handle cases where the tab might have been closed during edit
                }
            }
            // Update display regardless of save/cancel to show correct state
            // Need to fetch tab again in case URL changed during edit? Unlikely but possible.
            try {
                 const potentiallyUpdatedTab = await chrome.tabs.get(tab.id);
                 tab.title = potentiallyUpdatedTab.title; // Update local tab object title
                 tab.url = potentiallyUpdatedTab.url; // Update local tab object url
            } catch(e) {
                console.log("Tab likely closed during edit, cannot update display.");
                // If tab closed, the element will be removed by handleTabRemove anyway
                return;
            }
            await updateDisplay();
        };

        titleInput.addEventListener('blur', () => saveOrCancelEdit(true));
        titleInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent potential form submission if wrapped
                await saveOrCancelEdit(true);
                titleInput.blur(); // Explicitly blur to hide input
            } else if (e.key === 'Escape') {
                await saveOrCancelEdit(false); // Cancel reverts input visually via updateDisplay
                titleInput.blur(); // Explicitly blur to hide input
            }
        });
    }

    // --- Initial Display ---
    await updateDisplay(); // Call initially to set the correct title/domain

    // --- Click Handler ---
    tabElement.addEventListener('click', async (e) => {
        // Don't activate tab when clicking input or close button
        if (e.target === titleInput || e.target === actionButton) return;

        // Remove active class from all tabs and favicons
        document.querySelectorAll('.tab.active').forEach(t => t.classList.remove('active'));
        // Pinned favicon active class removed

        let chromeTab = null;
        try {
            chromeTab = await chrome.tabs.get(tab.id);
        } catch(e) {
            console.log("Tab likely closed during archival.", e, tab);
        }

        if (isBookmarkOnly || !chromeTab) {
            console.log('Opening bookmark:', tab);
            isOpeningBookmark = true; // Set flag
            try {
                // Find the tabGroup this bookmark belongs to (assuming it's the active one for simplicity)
                const tabGroup = tabGroups.find(s => s.id === activeGroupId);
                if (!tabGroup) {
                    console.error("Cannot open bookmark: Active tabGroup not found.");
                    isOpeningBookmark = false;
                    return;
                }

                // Create new tab with bookmark URL in the active group
                const newTab = await chrome.tabs.create({
                    url: tab.url,
                    active: true, // Make it active immediately
                    windowId: currentWindow.id // Ensure it opens in the current window
                });

                // If bookmark has a custom name, set tab name override
                if (tab.title && newTab.title !== tab.title) {
                    await Utils.setTabNameOverride(newTab.id, tab.url, tab.title);
                }

                // Replace tab element
                const bookmarkTab = {
                    id: newTab.id,
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                    groupName: tab.groupName
                };
                const activeBookmark = await createTabElement(bookmarkTab, true, false);
                activeBookmark.classList.add('active');
                tabElement.replaceWith(activeBookmark);

                // In unified view, don't force tabs into groups based on tabGroup ID
                if (activeGroupId !== 'unified') {
                    // Immediately group the new tab
                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: parseInt(activeGroupId) });
                }

                if (isPinned) {
                    const tabGroup = tabGroups.find(s => s.name === tab.groupName);
                    if (tabGroup) {
                        tabGroup.tabGroupBookmarks.push(newTab.id);
                        saveTabGroups();
                    }
                }

                saveTabGroups(); // Save updated tabGroup state

                // Replace the bookmark-only element with a real tab element
                activateTabInDOM(newTab.id); // Visually activate

            } catch (error) {
                console.error("Error opening bookmark:", error);
            } finally {
                isOpeningBookmark = false; // Reset flag
            }
        } else {
            // It's a regular tab, just activate it
            tabElement.classList.add('active');
            chrome.tabs.update(tab.id, { active: true });
            // Store last active tab for the tabGroup
            const tabGroup = tabGroups.find(s => s.id === tab.groupId);
            if (tabGroup) {
                tabGroup.lastTab = tab.id;
                saveTabGroups();
            }
        }
    });

    // Close tab on middle click
    tabElement.addEventListener('mousedown', (event) => {
        if (event.button === MouseButton.MIDDLE) {
            event.preventDefault(); // Prevent default middle-click actions (like autoscroll)
            closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        }
    });

    if (!isBookmarkOnly) {
        tabElement.addEventListener('dragstart', () => {
            tabElement.classList.add('dragging');
        });

        tabElement.addEventListener('dragend', () => {
            tabElement.classList.remove('dragging');
        });
    }

    // --- Context Menu ---
    tabElement.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const allBookmarkTabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        showTabContextMenu(e.pageX, e.pageY, tab, isPinned, isBookmarkOnly, tabElement, closeTab, tabGroups, moveTabToTabGroup, setActiveTabGroup, allBookmarkTabGroupFolders, createTabGroupFromInactive);
    });


    return tabElement;
}

function createNewTab(callback = () => {}) {
    console.log('Creating new tab...');
    
    // Get the currently active tab to check if it's in a group
    chrome.tabs.query({ active: true, currentWindow: true }, async (activeTabs) => {
        const activeTab = activeTabs[0];
        const activeTabGroupId = activeTab?.groupId;
        
        // Create new tab
        chrome.tabs.create({ active: true }, async (newTab) => {
            console.log('Created new tab:', newTab.id, 'Active tab group:', activeTabGroupId);
            
            // If the active tab is in a group (not -1), add the new tab to that group
            if (activeTabGroupId && activeTabGroupId !== -1) {
                try {
                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: activeTabGroupId });
                    console.log('Added new tab to group:', activeTabGroupId);
                } catch (err) {
                    console.log('Could not add tab to group:', err);
                }
            }
            // Otherwise, leave the tab ungrouped (groupId will be -1)
            
            const tabGroup = tabGroups.find(s => s.id === activeGroupId);
            if (tabGroup) {
                tabGroup.temporaryTabs.push(newTab.id);
                saveTabGroups();
                if(callback) {
                    callback();
                }
            }
        });
    });
}

async function createNewTabGroup() {
    console.log('Creating new tabGroup... Button clicked');
    isCreatingTabGroup = true;
    try {
        const tabGroupNameInput = document.getElementById('newTabGroupName');
        const tabGroupColorSelect = document.getElementById('groupColor');
        const groupName = tabGroupNameInput.value.trim();
        const groupColor = tabGroupColorSelect.value;

        if (!groupName || tabGroups.some(space => tabGroup.name.toLowerCase() === groupName.toLowerCase())) {
            const errorPopup = document.createElement('div');
            errorPopup.className = 'error-popup';
            errorPopup.textContent = 'A tabGroup with this name already exists';
            const inputContainer = document.getElementById('addTabGroupInputContainer');
            inputContainer.appendChild(errorPopup);

            // Remove the error message after 3 seconds
            setTimeout(() => {
                errorPopup.remove();
            }, 3000);
            return;
        }
        const newTab = await ChromeHelper.createNewTab();
        const groupId = await ChromeHelper.createNewTabGroup(newTab, groupName, groupColor);

        const tabGroup = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: groupName,
            color: groupColor,
            tabGroupBookmarks: [],
            temporaryTabs: [newTab.id]
        };

        // Create bookmark folder for new tabGroup
        await LocalStorage.getOrCreateTabGroupFolder(tabGroup.name);

        tabGroups.push(tabGroup);
        console.log('New tabGroup created:', { groupId: tabGroup.id, groupName: tabGroup.name, groupColor: tabGroup.color });

        createTabGroupElement(tabGroup);
        await updateTabGroupSwitcher();
        await setActiveTabGroup(tabGroup.id);
        saveTabGroups();

        isCreatingTabGroup = false;
        // Reset the tabGroup creation UI and show tabGroup switcher
        const addTabGroupBtn = document.getElementById('addTabGroupBtn');
        const inputContainer = document.getElementById('addTabGroupInputContainer');
        const tabGroupSwitcher = document.getElementById('tabGroupSwitcher');
        addTabGroupBtn.classList.remove('active');
        inputContainer.classList.remove('visible');
        tabGroupSwitcher.style.opacity = '1';
        tabGroupSwitcher.style.visibility = 'visible';
    } catch (error) {
        console.error('Error creating new tabGroup:', error);
    }
}

function cleanTemporaryTabs(groupId) {
    console.log('Cleaning temporary tabs for tabGroup:', groupId);
    const tabGroup = tabGroups.find(s => s.id === groupId);
    if (tabGroup) {
        console.log("space.temporaryTabs", tabGroup.temporaryTabs);

        // iterate through temporary tabs and remove them with index
        tabGroup.temporaryTabs.forEach((tabId, index) => {
            if (index == tabGroup.temporaryTabs.length - 1) {
                createNewTab();
            }
            chrome.tabs.remove(tabId);
        });

        tabGroup.temporaryTabs = [];
        saveTabGroups();
    }
}

function handleTabCreated(tab) {
    if (isCreatingTabGroup || isOpeningBookmark) {
        console.log('Skipping tab creation handler - tabGroup is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab created:', tab);
        // Don't force new tabs into any group - they'll stay in their opener's group or be ungrouped
        const tabGroup = tabGroups.find(s => s.id === activeGroupId);

        if (tabGroup) {
            // Just track the tab, don't move it to any group
            if (!space.temporaryTabs.includes(tab.id)) {
                tabGroup.temporaryTabs.push(tab.id);
                saveTabGroups();
            }
            
            // Refresh the temporary tabs list to show the new tab
            await refreshTemporaryTabsList(activeGroupId);
            
            // Update tree view if in tree view mode (debounced)
            if (isTreeViewMode) {
                debouncedTreeViewRender(activeGroupId);
            }
        }
    });
}


function handleTabUpdate(tabId, changeInfo, tab) {
    if (isOpeningBookmark) {
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }
        console.log('Tab updated:', tabId, changeInfo, tabGroups);

        // Update tab element if it exists
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            // Update Favicon if URL changed
            if (changeInfo.url || changeInfo.favIconUrl) {
                const img = tabElement.querySelector('img');
                if (img) {
                    img.src = tab.favIconUrl;
                    img.onerror = () => { 
                        img.src = tab.favIconUrl; 
                        img.onerror = () => { img.src = 'assets/default_icon.png'; }; // Fallback favicon
                    };
                }
            }

            const titleDisplay = tabElement.querySelector('.tab-title-display');
            const domainDisplay = tabElement.querySelector('.tab-domain-display');
            const titleInput = tabElement.querySelector('.tab-title-input'); // Get input element
            let displayTitle = tab.title; // Use potentially new title

            if (changeInfo.pinned !== undefined) {
                if (changeInfo.pinned) {
                    // Find which tabGroup this tab belongs to
                    const tabGroupWithTab = tabGroups.find(space =>
                        tabGroup.tabGroupBookmarks.includes(tabId) ||
                        tabGroup.temporaryTabs.includes(tabId)
                    );
                    
                    // If tab was in a tabGroup and was bookmarked, remove it from bookmarks
                    if (tabGroupWithTab && tabGroupWithTab.tabGroupBookmarks.includes(tabId)) {
                        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
                        const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
                        const tabGroupFolder = tabGroupFolders.find(f => f.title === tabGroupWithTab.name);
                        
                        if (tabGroupFolder) {
                            await Utils.searchAndRemoveBookmark(tabGroupFolder.id, tab.url);
                        }
                    }
                    
                    // Remove tab from all tabGroups data when it becomes pinned
                    tabGroups.forEach(space => {
                        tabGroup.tabGroupBookmarks = tabGroup.tabGroupBookmarks.filter(id => id !== tabId);
                        tabGroup.temporaryTabs = tabGroup.temporaryTabs.filter(id => id !== tabId);
                    });
                    saveTabGroups();
                    tabElement.remove(); // Remove from tabGroup
                    return;
                } else {
                    moveTabToTabGroup(tabId, activeGroupId, false /* pinned */);
                }
            }
            
            // Only proceed if the element is still connected to the DOM
            if (!tabElement.isConnected) {
                return;
            }
            
            if (titleDisplay && domainDisplay && titleInput) { // Check if elements exist
                // Don't update if the input field is currently focused
                if (document.activeElement !== titleInput) {
                   const overrides = await Utils.getTabNameOverrides();
                   console.log('changeInfo', changeInfo);
                   console.log('overrides', overrides);
                   console.log('tab.url', tab.url); // Log the tab URL her
                   const override = overrides[tabId]; // Use potentially new URL
                   console.log('override', override); // Log the override object here
                   let displayDomain = null;

                   // Re-check if elements still exist after async operation
                   if (!tabElement.isConnected || !titleDisplay || !domainDisplay || !titleInput) {
                       return;
                   }

                   if (override) {
                       displayTitle = override.name;
                       try {
                           const currentDomain = new URL(tab.url).hostname;
                           if (currentDomain !== override.originalDomain) {
                               displayDomain = currentDomain;
                           }
                       } catch (e) { /* Ignore invalid URLs */ }
                   } else {
                        titleDisplay.textContent = displayTitle;
                   }
                   if (displayDomain) {
                       domainDisplay.textContent = displayDomain;
                       domainDisplay.style.display = 'block';
                   } else {
                       domainDisplay.style.display = 'none';
                   }
                   // Update input value only if not focused (might overwrite user typing)
                   titleInput.value = override ? override.name : tab.title;
               }
           }

            // Check if element is still connected before URL updates
            if (changeInfo.url && tabElement.isConnected) {
                const faviconElement = tabElement.querySelector('.tab-favicon');
                if (faviconElement) {
                    faviconElement.src = Utils.getFaviconUrl(changeInfo.url);
                }
                // Update bookmark URL (bookmarks section logic would go here if needed)
            }
            // Update active state when tab's active state changes
            if (changeInfo.active !== undefined && changeInfo.active) {
                activateTabInDOM(tabId);
            }
            
            // If tab's groupId changed, refresh the unified view
            if (changeInfo.groupId !== undefined) {
                await renderAllTabGroupsAsTabGroups();
            }
        }
        
        // Update tree view if in tree view mode (debounced) - now shows all groups
        if (isTreeViewMode) {
            debouncedTreeViewRender(activeGroupId);
        }
    });
}

async function handleTabRemove(tabId) {
    try {
        console.log('Tab removed:', tabId);
        
        // Get tab element before removing it
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        
        // Remove from tree view if present
        const treeTabElement = document.querySelector(`.tree-tab-item[data-tab-id="${tabId}"]`);
        if (treeTabElement) {
            treeTabElement.remove();
        }
        
        if (!tabElement) {
            // Tab element not in list view, but still clean up data
            tabGroups.forEach(space => {
                tabGroup.tabGroupBookmarks = tabGroup.tabGroupBookmarks.filter(id => id !== tabId);
                tabGroup.temporaryTabs = tabGroup.temporaryTabs.filter(id => id !== tabId);
            });
            saveTabGroups();
            return;
        }
        
        const activeTabGroup = tabGroups.find(s => s.id === activeGroupId);
        const isPinned = activeTabGroup?.tabGroupBookmarks.includes(tabId) || false;

        // Remove tab from tabGroups
        tabGroups.forEach(space => {
            tabGroup.tabGroupBookmarks = tabGroup.tabGroupBookmarks.filter(id => id !== tabId);
            tabGroup.temporaryTabs = tabGroup.temporaryTabs.filter(id => id !== tabId);
        });

        // Remove the tab element from the DOM
        tabElement.remove();

        if (!isPinned) {
            // Refresh the unified view to show updated tab counts
            await renderAllTabGroupsAsTabGroups();
        }

        saveTabGroups();
        
        // Update tree view if in tree view mode (immediate for removals)
        if (isTreeViewMode) {
            debouncedTreeViewRender(activeGroupId, 100);
        }
    } catch (error) {
        console.error('Error in handleTabRemove:', error);
    }
}

// handleTabMove function removed - the listener is disabled (see line 471)

function handleTabActivated(activeInfo) {
    if (isCreatingTabGroup) {
        console.log('Skipping tab creation handler - tabGroup is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (activeInfo.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab activated:', activeInfo);
        // Find which tabGroup contains this tab
        const tabGroupWithTab = tabGroups.find(space =>
            tabGroup.tabGroupBookmarks.includes(activeInfo.tabId) ||
            tabGroup.temporaryTabs.includes(activeInfo.tabId)
        );
        console.log("found tabGroup", tabGroupWithTab);

        if (tabGroupWithTab) {
            tabGroupWithTab.lastTab = activeInfo.tabId;
            saveTabGroups();
            console.log("lasttab tabGroup", tabGroups);
        }

        if (tabGroupWithTab && tabGroupWithTab.id !== activeGroupId) {
            // Switch to the tabGroup containing the tab
            await activateTabGroupInDOM(tabGroupWithTab.id, tabGroups, updateTabGroupSwitcher);
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current tabGroup
            activateTabInDOM(activeInfo.tabId);
        }
        
        // Update tree view if in tree view mode
        if (isTreeViewMode) {
            // Update active state in tree view
            document.querySelectorAll('.tree-tab-item').forEach(t => t.classList.remove('active'));
            const treeTab = document.querySelector(`.tree-tab-item[data-tab-id="${activeInfo.tabId}"]`);
            if (treeTab) {
                treeTab.classList.add('active');
            }
        }
    });
}

async function deleteTabGroup(groupId) {
    console.log('Deleting tabGroup:', groupId);
    const tabGroup = tabGroups.find(s => s.id === groupId);
    if (tabGroup) {
        // Close all tabs in the tabGroup
        [...space.tabGroupBookmarks, ...space.temporaryTabs].forEach(tabId => {
            chrome.tabs.remove(tabId);
        });

        // Remove tabGroup from array
        tabGroups = tabGroups.filter(s => s.id !== groupId);

        // Remove tabGroup element from DOM
        const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        if (tabGroupElement) {
            tabGroupElement.remove();
        }

        // If this was the active tabGroup, switch to another tabGroup
        if (activeGroupId === groupId && tabGroups.length > 0) {
            await setActiveTabGroup(tabGroups[0].id);
        }

        // Delete bookmark folder for this tabGroup
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const tabGroupFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const tabGroupFolder = tabGroupFolders.find(f => f.title === tabGroup.name);
        await chrome.bookmarks.removeTree(tabGroupFolder.id);

        // Save changes
        saveTabGroups();
        await updateTabGroupSwitcher();
    }
}

////////////////////////////////////////////////////////////////
// -- Helper Functions
////////////////////////////////////////////////////////////////

async function moveTabToTabGroup(tabId, groupId, pinned = false, openerTabId = null) {
    // Remove tab from its original tabGroup data first
    const sourceTabGroup = tabGroups.find(s => 
        s.temporaryTabs.includes(tabId) || s.tabGroupBookmarks.includes(tabId)
    );
    if (sourceTabGroup && sourceTabGroup.id !== groupId) {
        sourceTabGroup.temporaryTabs = sourceTabGroup.temporaryTabs.filter(id => id !== tabId);
        sourceTabGroup.tabGroupBookmarks = sourceTabGroup.tabGroupBookmarks.filter(id => id !== tabId);
    }
    
    // 1. Find the target tabGroup
    const tabGroup = tabGroups.find(s => s.id === groupId);
    if (!tabGroup) {
        console.warn(`Space with ID ${groupId} not found.`);
        return;
    }

    // 2. In unified view, we don't move tabs between Chrome tab groups
    // Tabs stay in their original Chrome tab groups and we just update our tracking

    // 3. Update local tabGroup data
    // Remove tab from both arrays just in case
    tabGroup.tabGroupBookmarks = tabGroup.tabGroupBookmarks.filter(id => id !== tabId);
    tabGroup.temporaryTabs = tabGroup.temporaryTabs.filter(id => id !== tabId);

    if (pinned) {
        tabGroup.tabGroupBookmarks.push(tabId);
    } else {
        tabGroup.temporaryTabs.push(tabId);
    }

    // 4. Update the UI (remove tab element from old section, create it in new section)
    // Remove any existing DOM element for this tab
    const oldTabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    oldTabElement?.remove();

    // Add a fresh tab element if needed
    const tabGroupElement = document.querySelector(`[data-group-id="${groupId}"]`);
    if (tabGroupElement) {
        if (pinned) {
            // For bookmarked tabs, add to bookmarks section
            const container = tabGroupElement.querySelector('.bookmarks-content .bookmarks-list');
            if (container) {
                const chromeTab = await chrome.tabs.get(tabId);
                // Create bookmark item instead of tab element
                const bookmarkItem = document.createElement('div');
                bookmarkItem.className = 'bookmark-item';
                bookmarkItem.dataset.url = chromeTab.url;
                bookmarkItem.innerHTML = `
                    <img class="bookmark-favicon" src="${Utils.getFaviconUrl(chromeTab.url)}" alt="">
                    <span class="bookmark-title">${chromeTab.title}</span>
                `;
                bookmarkItem.addEventListener('click', () => {
                    chrome.tabs.create({ url: chromeTab.url });
                });
                container.appendChild(bookmarkItem);
            }
        } else {
            // For temporary tabs, refresh the list to maintain tab group grouping
            await refreshTemporaryTabsList(groupId);
        }
    }

    // 5. Save the updated tabGroups to storage
    saveTabGroups();
}
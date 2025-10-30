import { ChromeHelper } from './chromeHelper.js';
import { FOLDER_CLOSED_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
import { setupDOMElements, showSpaceNameInput, activateTabInDOM, activateSpaceInDOM, showTabContextMenu, showArchivedTabsPopup } from './domManager.js';

// Constants
const MouseButton = {
    LEFT: 0,
    MIDDLE: 1,
    RIGHT: 2
};

// DOM Elements - These will be initialized after DOM is ready
let spacesList = null;
let spaceSwitcher = null;
let addSpaceBtn = null;
let newTabBtn = null;
let spaceTemplate = null;

// Global state
let spaces = [];
let activeSpaceId = null;
let isCreatingSpace = false;
let isOpeningBookmark = false;
let isDraggingTab = false;
let currentWindow = null;
let defaultSpaceName = 'Home';
let isTreeViewMode = false;
let treeViewStates = {}; // Store tree view state per space
let treeViewRenderTimeout = null; // Debounce tree view renders
let favorites = []; // Store favorite tabs
let hideDuplicates = false; // Hide duplicate tabs and bookmarks
let twoLevelHierarchy = false; // Enable 2-level hierarchy in tree view

// Helper function to update bookmark for a tab
async function updateBookmarkForTab(tab, bookmarkTitle) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

    for (const spaceFolder of spaceFolders) {
        const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
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

// Helper function to get reliable favicon URL
function getReliableFaviconUrl(url, tabFavIconUrl = null) {
    try {
        // Parse the URL
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        
        // Skip invalid URLs
        if (!hostname || hostname === 'localhost' || hostname.startsWith('127.0.0.1')) {
            console.warn('⚠️ Invalid hostname for favicon:', hostname);
            return getGenericFaviconDataUrl();
        }
        
        // First, try to use the tab's favicon if it's valid and HTTP(S)
        if (tabFavIconUrl && 
            !tabFavIconUrl.includes('chrome://') && 
            !tabFavIconUrl.includes('chrome-extension://') &&
            (tabFavIconUrl.startsWith('http://') || tabFavIconUrl.startsWith('https://'))) {
            console.log('✅ Using tab favicon for:', hostname);
            return tabFavIconUrl;
        }
        
        // Always use Google's favicon service as reliable fallback
        const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
        console.log('🌐 Using Google favicon service for:', hostname);
        return googleFaviconUrl;
    } catch (error) {
        console.error('❌ Error parsing URL for favicon:', url, error);
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
        const result = await chrome.storage.local.get(['favorites', 'favoritesLastSaved']);
        favorites = result.favorites || [];
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
        
        // Show empty message if no favorites
        if (favorites.length === 0) {
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
        for (const favorite of favorites) {
            const favoriteItem = createFavoriteElement(favorite, activeTabUrl);
            favoritesList.appendChild(favoriteItem);
        }
        
        console.log('✅ Rendered', favorites.length, 'favorites');
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
    
    // Favicon
    const favicon = document.createElement('img');
    favicon.className = 'favorite-favicon';
    favicon.src = getReliableFaviconUrl(favorite.url, favorite.favIconUrl);
    favicon.alt = favorite.title;
    
    // Error handling for favicon - use generic globe icon as final fallback
    let errorHandled = false;
    favicon.onerror = () => {
        if (!errorHandled) {
            errorHandled = true;
            console.warn('⚠️ Favicon failed to load for:', favorite.url, 'Using generic icon');
            favicon.src = getGenericFaviconDataUrl();
        }
    };
    
    // Title (shown on hover)
    const title = document.createElement('div');
    title.className = 'favorite-title';
    title.textContent = favorite.title;
    title.title = `${favorite.title}\n${favorite.url}`;
    
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'favorite-remove';
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
    
    // Click handler - open or switch to tab
    favoriteItem.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const tabs = await chrome.tabs.query({});
            const existingTab = tabs.find(t => t.url === favorite.url);
            
            if (existingTab) {
                // Switch to existing tab
                await chrome.tabs.update(existingTab.id, { active: true });
                await chrome.windows.update(existingTab.windowId, { focused: true });
            } else {
                // Create new tab
                await chrome.tabs.create({ url: favorite.url, active: true });
            }
        } catch (error) {
            console.error('❌ Error opening favorite:', error);
        }
    });
    
    // Assemble the favorite item
    favoriteItem.appendChild(favicon);
    favoriteItem.appendChild(title);
    favoriteItem.appendChild(removeBtn);
    
    return favoriteItem;
}

// Pinned favicons function removed - using Chrome's native pinned tabs in favorites bar

// Load and display bookmarks
async function loadBookmarks(spaceId) {
    console.log('Loading bookmarks for space:', spaceId);
    
    const bookmarksList = document.querySelector(`[data-space-id="${spaceId}"] .bookmarks-list`);
    if (!bookmarksList) {
        console.error('Bookmarks list not found for space:', spaceId);
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
        
        console.log(`Loaded ${bookmarkCount} bookmarks for space:`, spaceId);
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
    
    // Search through all tabs in all spaces
    document.querySelectorAll('.space').forEach(spaceElement => {
        let spaceHasMatches = false;
        
        // Search temporary tabs in list view
        const tempTabs = spaceElement.querySelectorAll('.temporary-tabs .tab');
        
        tempTabs.forEach(tabElement => {
            const titleEl = tabElement.querySelector('.tab-title-display');
            const domainEl = tabElement.querySelector('.tab-domain-display');
            const title = titleEl?.textContent?.toLowerCase() || '';
            const domain = domainEl?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery) || domain.includes(lowerQuery);
            
            tabElement.style.display = matches ? '' : 'none';
            if (matches) spaceHasMatches = true;
        });
        
        // Search temporary tabs in tree view
        const tempTreeTabs = spaceElement.querySelectorAll('.tabs-tree-container .tree-tab-item');
        tempTreeTabs.forEach(tabElement => {
            const title = tabElement.querySelector('.tree-tab-title')?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery);
            
            tabElement.style.display = matches ? '' : 'none';
            if (matches) spaceHasMatches = true;
        });
        
        // Pinned tabs section removed - no longer searching pinned tabs
        
        // Search folders
        const folders = spaceElement.querySelectorAll('.folder');
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
                    spaceHasMatches = true;
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
        const treeGroups = spaceElement.querySelectorAll('.tree-domain-group, .list-tab-group');
        
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
                    spaceHasMatches = true;
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
        const bookmarkItems = spaceElement.querySelectorAll('.bookmark-item');
        bookmarkItems.forEach(bookmarkElement => {
            const title = bookmarkElement.querySelector('.bookmark-title')?.textContent?.toLowerCase() || '';
            const matches = title.includes(lowerQuery);
            
            bookmarkElement.style.display = matches ? '' : 'none';
            if (matches) spaceHasMatches = true;
        });
        
        // Search bookmark folders
        const bookmarkFolders = spaceElement.querySelectorAll('.bookmark-folder-container');
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
                    spaceHasMatches = true;
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
        
        // Show/hide space based on whether it has matches
        // Note: We don't hide the space itself, just its content
        if (!spaceHasMatches) {
            spaceElement.querySelector('.space-content')?.classList.add('no-search-results');
        } else {
            spaceElement.querySelector('.space-content')?.classList.remove('no-search-results');
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
    document.querySelectorAll('.space-content').forEach(content => {
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
        
        // Toggle tree view for active space
        if (activeSpaceId) {
            const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
            if (spaceElement) {
                const listView = spaceElement.querySelector('.tabs-container.list-view');
                const treeView = spaceElement.querySelector('.tabs-tree-container');
                
                if (listView && treeView) {
                    if (isTreeViewMode) {
                        listView.style.display = 'none';
                        treeView.style.display = 'block';
                        treeView.classList.remove('collapsed');
                        renderTreeView(activeSpaceId);
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
            if (isTreeViewMode && activeSpaceId) {
                renderTreeView(activeSpaceId);
                renderBookmarksTreeView(activeSpaceId);
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

    // --- Space Switching with Trackpad Swipe ---
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

            const currentIndex = spaces.findIndex(s => s.id === activeSpaceId);
            if (currentIndex === -1) {
                isSwiping = false;
                return;
            }

            let nextIndex;
            // deltaX > 0 means swiping right (finger moves right, content moves left) -> previous space
            if (event.deltaX < 0) {
                nextIndex = (currentIndex - 1 + spaces.length) % spaces.length;
            } else {
                // deltaX < 0 means swiping left (finger moves left, content moves right) -> next space
                nextIndex = (currentIndex + 1) % spaces.length;
            }
            
            const nextSpace = spaces[nextIndex];
            if (nextSpace) {
                await setActiveSpace(nextSpace.id);
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
    spacesList = document.getElementById('spacesList');
    spaceSwitcher = document.getElementById('spaceSwitcher');
    addSpaceBtn = document.getElementById('addSpaceBtn');
    newTabBtn = document.getElementById('newTabBtn');
    spaceTemplate = document.getElementById('spaceTemplate');
    
    console.log('✅ DOM elements initialized:', {
        spacesList: !!spacesList,
        spaceSwitcher: !!spaceSwitcher,
        spaceTemplate: !!spaceTemplate
    });
    
    let settings = await Utils.getSettings();
    if (settings.defaultSpaceName) {
        defaultSpaceName = settings.defaultSpaceName;
    }
    try {
        currentWindow = await chrome.windows.getCurrent({populate: false});
        console.log('🎬 Current window:', currentWindow.id);

        let tabGroups = await chrome.tabGroups.query({});
        let allTabs = await chrome.tabs.query({currentWindow: true});

        // Check for duplicates
        await LocalStorage.mergeDuplicateSpaceFolders();

        // Create bookmarks folder for spaces if it doesn't exist
        const spacesFolder = await LocalStorage.getOrCreateArcifyFolder();
        const subFolders = await chrome.bookmarks.getChildren(spacesFolder.id);
        if (tabGroups.length === 0) {
            let currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];

            if (currentTabs.length == 0) {
                await chrome.tabs.create({ active: true });
                allTabs = await chrome.tabs.query({});
                currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];
            }

            // Create single unified space with all tabs
            const unifiedSpace = {
                id: 'unified',
                uuid: Utils.generateUUID(),
                name: 'All Tabs',
                color: 'blue',
                spaceBookmarks: [],
                temporaryTabs: currentTabs.map(tab => tab.id),
            };

            // Create bookmark folder for unified space
            const bookmarkFolder = subFolders.find(f => !f.url && f.title == 'All Tabs');
            if (!bookmarkFolder) {
                await chrome.bookmarks.create({
                    parentId: spacesFolder.id,
                    title: 'All Tabs'
                });
            }

            spaces = [unifiedSpace];
            saveSpaces();
            
            // Make sure spaces list is visible
            const spacesList = document.getElementById('spacesList');
            if (spacesList) {
                spacesList.style.display = 'block';
                console.log('✅ Spaces list made visible');
            }
            
            createSpaceElement(unifiedSpace);
            await setActiveSpace(unifiedSpace.id);
            
            // Hide space switcher in unified view
            const spaceSwitcherContainer = document.querySelector('.space-switcher-container');
            if (spaceSwitcherContainer) {
                spaceSwitcherContainer.style.display = 'none';
            }
        } else {
            // Don't force ungrouped tabs into a group - let them remain ungrouped
            // They will show up in the "Ungrouped Tabs" section
            
            // Create a single unified space that contains all tabs
            // Collect all tab IDs and bookmarked tabs
            let allTabIds = allTabs.filter(tab => !tab.pinned).map(tab => tab.id);
            let allSpaceBookmarks = [];
            
            // Process bookmarks from all folders
            const mainFolder = await chrome.bookmarks.getSubTree(spacesFolder.id);
            for (const bookmarkFolder of mainFolder[0].children || []) {
                if (!bookmarkFolder.url) {
                    const bookmarkedIds = await Utils.processBookmarkFolder(bookmarkFolder, -1);
                    allSpaceBookmarks.push(...bookmarkedIds.filter(id => id !== null));
                }
            }
            
            // Create single unified space
            const unifiedSpace = {
                id: 'unified',
                uuid: Utils.generateUUID(),
                name: 'All Tabs',
                color: 'blue',
                spaceBookmarks: allSpaceBookmarks,
                temporaryTabs: allTabIds.filter(id => !allSpaceBookmarks.includes(id))
            };
            
            // Create bookmark folder for unified space if it doesn't exist
            const bookmarkFolder = mainFolder[0].children?.find(f => !f.url && f.title == 'All Tabs');
            if (!bookmarkFolder) {
                await chrome.bookmarks.create({
                    parentId: spacesFolder.id,
                    title: 'All Tabs'
                });
            }
            
            spaces = [unifiedSpace];
            
            // Make sure spaces list is visible
            const spacesList = document.getElementById('spacesList');
            if (spacesList) {
                spacesList.style.display = 'block';
                console.log('✅ Spaces list made visible');
            }
            
            createSpaceElement(unifiedSpace);
            console.log("initial save", spaces);
            saveSpaces();

            // Set the unified space as active
            await setActiveSpace(unifiedSpace.id);
            
            // Update UI if needed
            // (pinned favicons removed)
            
            // Hide space switcher in unified view
            const spaceSwitcherContainer = document.querySelector('.space-switcher-container');
            if (spaceSwitcherContainer) {
                spaceSwitcherContainer.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error initializing sidebar:', error);
    }

    // Setup DOM elements (optional - may not exist in unified view)
    try {
        setupDOMElements(createNewSpace, createNewTab);
    } catch (error) {
        console.error('Error setting up DOM elements (non-critical):', error);
        // This is non-critical - the sidebar should still work
    }
    
    // Load favorites
    await loadFavorites();
    
    console.log('✅ Sidebar initialization complete');
}

function createSpaceElement(space) {
    console.log('🚀 Creating space element for:', space.id);
    
    // Make sure spacesList is visible first
    const spacesList = document.getElementById('spacesList');
    if (spacesList) {
        spacesList.style.display = 'block';
        console.log('✅ Spaces list made visible in createSpaceElement');
    } else {
        console.error('❌ spacesList not found!');
    }
    
    console.log('🚀 spaceTemplate exists:', !!spaceTemplate);
    const spaceElement = spaceTemplate.content.cloneNode(true);
    const sidebarContainer = document.getElementById('sidebar-container');
    const spaceContainer = spaceElement.querySelector('.space');
    console.log('🚀 spaceContainer found:', !!spaceContainer);
    spaceContainer.dataset.spaceId = space.id;
    spaceContainer.style.display = 'block'; // Always show in unified view
    spaceContainer.dataset.spaceUuid = space.id;
    console.log('🚀 Space container display set to:', spaceContainer.style.display);

    // Set space background color based on the tab group color
    sidebarContainer.style.setProperty('--space-bg-color', `var(--chrome-${space.color}-color, rgba(255, 255, 255, 0.1))`);
    sidebarContainer.style.setProperty('--space-bg-color-dark', `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`);

    // Set up color select
    const colorSelect = spaceElement.querySelector('#spaceColorSelect');
    if (colorSelect) {
        colorSelect.value = space.color;
        colorSelect.addEventListener('change', async () => {
            const newColor = colorSelect.value;
            space.color = newColor;

            // Update tab group color (skip in unified view)
            if (space.id !== 'unified') {
                await chrome.tabGroups.update(parseInt(space.id), { color: newColor });
            }

            // Update space background color
            sidebarContainer.style.setProperty('--space-bg-color', `var(--chrome-${newColor}-color, rgba(255, 255, 255, 0.1))`);
            sidebarContainer.style.setProperty('--space-bg-color-dark', `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`);

            saveSpaces();
            await updateSpaceSwitcher();
        });
    }

    // Handle color swatch clicks
    const spaceOptionColorSwatch = spaceElement.querySelector('#spaceOptionColorSwatch');
    if (spaceOptionColorSwatch && colorSelect) {
        spaceOptionColorSwatch.addEventListener('click', (e) => {
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

    // Set up space name input
    const nameInput = spaceElement.querySelector('.space-name');
    if (nameInput) {
        nameInput.value = space.name;
        nameInput.addEventListener('change', async () => {
            // Update bookmark folder name
            const oldName = space.name;
            const oldFolder = await LocalStorage.getOrCreateSpaceFolder(oldName);
            await chrome.bookmarks.update(oldFolder.id, { title: nameInput.value });

            const tabGroups = await chrome.tabGroups.query({});
            const tabGroupForSpace = tabGroups.find(group => group.id === space.id);
            console.log("updating tabGroupForSpace", tabGroupForSpace);
            if (tabGroupForSpace) {
                await chrome.tabGroups.update(tabGroupForSpace.id, {title: nameInput.value, color: 'grey'});
            }

            space.name = nameInput.value;
            saveSpaces();
            await updateSpaceSwitcher();
        });
    }

    // Set up clean tabs button
    const cleanBtn = spaceElement.querySelector('.clean-tabs-btn');
    if (cleanBtn) {
        cleanBtn.addEventListener('click', () => cleanTemporaryTabs(space.id));
    }

    // Set up options menu
    const newFolderBtn = spaceElement.querySelector('.new-folder-btn');
    const deleteSpaceBtn = spaceElement.querySelector('.delete-space-btn');

    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', () => {
            createNewFolder(spaceContainer);
        });
    }

    if (deleteSpaceBtn) {
        deleteSpaceBtn.addEventListener('click', () => {
            if (confirm('Delete this space and close all its tabs?')) {
                deleteSpace(space.id);
            }
        });
    }

    const popup = spaceElement.querySelector('.archived-tabs-popup');
    const archiveButton = spaceElement.querySelector('.sidebar-button');
    const spaceContent = spaceElement.querySelector('.space-content');

    if (archiveButton && popup && spaceContent) {
        archiveButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing immediately if clicking outside logic exists
            spaceContent.classList.toggle('hidden');
            const isVisible = popup.style.opacity == 1;
            if (isVisible) {
                popup.classList.toggle('visible');
            } else {
                showArchivedTabsPopup(space.id); // Populate and show
                popup.classList.toggle('visible');
            }
        });
    }

    // Add to DOM FIRST
    console.log('📍 About to append to spacesList:', !!spacesList);
    spacesList.appendChild(spaceElement);
    console.log('📍 Appended to DOM');
    
    // IMPORTANT: After appendChild, spaceElement (DocumentFragment) is empty!
    // We must query from the DOM using the space ID
    const spaceContainerInDOM = document.querySelector(`[data-space-id="${space.id}"]`);
    console.log('📍 Space in DOM found:', !!spaceContainerInDOM);
    
    if (!spaceContainerInDOM) {
        console.error('❌ Space container not found in DOM! Space ID:', space.id);
        return;
    }
    
    // NOW get the containers from the DOM (not from the fragment)
    const tempContainer = spaceContainerInDOM.querySelector('[data-tab-type="temporary"]');
    
    console.log('🔍 Containers found:', {
        tempContainer: !!tempContainer,
        spaceId: space.id,
        tempContainerClass: tempContainer?.className
    });

    // Set up drag and drop
    setupDragAndDrop(tempContainer);

    // Load tabs (async - runs in background) - AFTER containers are available
    loadTabs(space, tempContainer).catch(err => {
        console.error('Error in loadTabs:', err);
    });
    
    // Pinned section completely removed
    
    // Set up bookmarks section toggle
    const bookmarksToggle = document.querySelector(`[data-space-id="${space.id}"] .bookmarks-toggle`);
    const bookmarksContent = document.querySelector(`[data-space-id="${space.id}"] .bookmarks-content`);
    
    console.log('Setting up bookmarks toggle for space:', space.id, 'Toggle found:', !!bookmarksToggle, 'Content found:', !!bookmarksContent);
    
    if (bookmarksToggle && bookmarksContent) {
        // Load saved collapsed state from localStorage, default to collapsed (true)
        chrome.storage.local.get(['bookmarksSectionCollapsed'], (result) => {
            const collapsedSpaces = result.bookmarksSectionCollapsed || {};
            const isCollapsed = collapsedSpaces[space.id] !== undefined ? collapsedSpaces[space.id] : true; // Default collapsed
            
            console.log('Loading bookmarks collapsed state for space:', space.id, 'isCollapsed:', isCollapsed);
            
            // Also apply to tree view container
            const bookmarksTreeContainer = document.querySelector(`[data-space-id="${space.id}"] .bookmarks-tree-container`);
            
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
            console.log('Bookmarks toggle clicked!', space.id);
            e.preventDefault();
            e.stopPropagation();
            
            const isCollapsed = bookmarksToggle.classList.toggle('collapsed');
            bookmarksContent.classList.toggle('collapsed');
            
            // Also toggle tree view container if it exists
            const bookmarksTreeContainer = document.querySelector(`[data-space-id="${space.id}"] .bookmarks-tree-container`);
            if (bookmarksTreeContainer) {
                bookmarksTreeContainer.classList.toggle('collapsed');
            }
            
            console.log('Bookmarks toggled to:', isCollapsed);
            
            // Save collapsed state to localStorage
            chrome.storage.local.get(['bookmarksSectionCollapsed'], (result) => {
                const collapsedSpaces = result.bookmarksSectionCollapsed || {};
                collapsedSpaces[space.id] = isCollapsed;
                chrome.storage.local.set({ bookmarksSectionCollapsed: collapsedSpaces });
                console.log('Saved bookmarks collapsed state:', collapsedSpaces);
            });
        });
        
        // Load and display bookmarks
        loadBookmarks(space.id);
    } else {
        console.error('Could not find bookmarks toggle or content for space:', space.id);
    }
    
    // Setup view mode toggle for this space (optional)
    const viewModeBtn = spaceContainerInDOM.querySelector('.view-mode-toggle');
    
    if (viewModeBtn) {
        console.log('Setting up view mode toggle for space:', space.id);
        viewModeBtn.addEventListener('click', async (e) => {
            console.log('View mode button clicked for space:', space.id);
            e.preventDefault();
            e.stopPropagation();
            await toggleTreeView(space.id);
        });
    }
    
    // Restore tree view state if it was previously enabled
    restoreTreeViewState(space.id);
}

async function restoreTreeViewState(spaceId) {
    try {
        const result = await chrome.storage.local.get('treeViewStates');
        if (result.treeViewStates) {
            treeViewStates = result.treeViewStates;
            
            // If this space was in tree view mode, restore it
            if (treeViewStates[spaceId]) {
                const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
                if (!spaceElement) return;
                
                const listContainer = spaceElement.querySelector('.tabs-container[data-tab-type="temporary"]');
                const treeContainer = spaceElement.querySelector('#tabsTreeContainer');
                const viewModeBtn = spaceElement.querySelector('.view-mode-toggle');
                
                if (listContainer && treeContainer && viewModeBtn) {
                    const listIcon = viewModeBtn.querySelector('.list-icon');
                    const treeIcon = viewModeBtn.querySelector('.tree-icon');
                    
                    listContainer.style.display = 'none';
                    treeContainer.style.display = 'block';
                    if (listIcon) listIcon.style.display = 'none';
                    if (treeIcon) treeIcon.style.display = 'block';
                    
                    // Only set isTreeViewMode and render if this is the active space
                    if (spaceId === activeSpaceId) {
                        isTreeViewMode = true;
                        await renderTreeView(spaceId);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error restoring tree view state:', error);
    }
}

// Tree View Functions
function debouncedTreeViewRender(spaceId, delay = 300) {
    if (treeViewRenderTimeout) {
        clearTimeout(treeViewRenderTimeout);
    }
    treeViewRenderTimeout = setTimeout(() => {
        renderTreeView(spaceId);
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

async function renderTreeView(spaceId) {
    console.log('=== renderTreeView START ===', spaceId);
    try {
        const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
        console.log('Space element found:', !!spaceElement);
        if (!spaceElement) return;
        
        const treeContainer = spaceElement.querySelector('#tabsTreeContainer');
        console.log('Tree container found:', !!treeContainer);
        if (!treeContainer) return;
        
        // Clear existing content
        treeContainer.innerHTML = '';
        console.log('Tree container cleared');
        
        // Get all temporary tabs for this space
        const space = spaces.find(s => s.id === spaceId);
        console.log('Space found:', !!space, 'Space:', space);
        if (!space) return;
        
        // Get all tabs in the current window (not by groupId since we're in unified view)
        const tabs = await chrome.tabs.query({ currentWindow: true });
        console.log('All tabs in window:', tabs.length);
        
        const temporaryTabs = tabs.filter(tab => space.temporaryTabs.includes(tab.id));
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
                const groupElement = await createTwoLevelDomainGroupElement(group, spaceId);
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
                const groupElement = await createDomainGroupElement(group, spaceId);
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
async function renderBookmarksTreeView(spaceId) {
    console.log('=== renderBookmarksTreeView START ===', spaceId);
    try {
        const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
        if (!spaceElement) {
            console.error('Space element not found for:', spaceId);
            return;
        }
        
        const bookmarksTreeContainer = spaceElement.querySelector('.bookmarks-tree-container');
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
                const groupElement = await createTwoLevelDomainGroupElement(group, spaceId, true);
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
                const groupElement = await createDomainGroupElement(group, spaceId, true);
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

async function createDomainGroupElement(group, spaceId, isBookmark = false) {
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
        const tabElement = await createTreeTabElement(tab, spaceId, isBookmark);
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
async function createTwoLevelDomainGroupElement(group, spaceId, isBookmark = false) {
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
            const tabElement = await createTreeTabElement(tab, spaceId, isBookmark);
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

async function createTabGroupElement(group, spaceId) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tree-domain-group';
    groupDiv.dataset.groupId = group.groupId;
    
    // Create header
    const header = document.createElement('div');
    header.className = 'tree-domain-header';
    
    // Apply group color as left border indicator
    if (group.groupColor && group.groupColor !== 'grey') {
        header.style.borderLeft = `3px solid var(--chrome-${group.groupColor}-color, rgba(255, 255, 255, 0.3))`;
        header.style.paddingLeft = '5px';
    }
    
    // Expand icon
    const expandIcon = document.createElement('div');
    expandIcon.className = 'tree-expand-icon expanded';
    expandIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    
    // Group icon (folder icon or colored circle)
    const groupIcon = document.createElement('div');
    groupIcon.className = 'tree-domain-icon';
    groupIcon.style.width = '16px';
    groupIcon.style.height = '16px';
    groupIcon.style.borderRadius = '50%';
    groupIcon.style.backgroundColor = `var(--chrome-${group.groupColor}-color, #999)`;
    groupIcon.style.flexShrink = '0';
    
    // Group name
    const groupName = document.createElement('div');
    groupName.className = 'tree-domain-name';
    groupName.textContent = group.groupName;
    groupName.style.fontWeight = 'bold';
    
    // Tab count
    const tabCount = document.createElement('div');
    tabCount.className = 'tree-domain-count';
    tabCount.textContent = group.tabs.length.toString();
    
    header.appendChild(expandIcon);
    header.appendChild(groupIcon);
    header.appendChild(groupName);
    header.appendChild(tabCount);
    
    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tree-domain-tabs expanded';
    
    // Apply group color to tabs container for vertical line
    if (group.groupColor && group.groupColor !== 'grey') {
        tabsContainer.style.setProperty('--group-line-color', `var(--chrome-${group.groupColor}-color)`);
    }
    
    // Create tab elements
    for (const tab of group.tabs) {
        const tabElement = await createTreeTabElement(tab, group.groupId);
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

async function createTreeTabElement(tab, spaceId, isBookmark = false) {
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
            const allBookmarkSpaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            
            // Find the tab's actual groupId
            const tabGroupId = tab.groupId === -1 ? spaceId : tab.groupId;
            const space = spaces.find(s => s.id === tabGroupId);
            const isPinned = space?.spaceBookmarks.includes(tab.id);
            
            // Get the list view tab element for closeTab function
            const listTabElement = document.querySelector(`[data-tab-id="${tab.id}"]`);
            
            showTabContextMenu(e.pageX, e.pageY, tab, isPinned, false, listTabElement, closeTab, spaces, moveTabToSpace, setActiveSpace, allBookmarkSpaceFolders, createSpaceFromInactive);
        } catch (error) {
            console.log('Error showing context menu for tab:', tab.id, error.message);
        }
    });
    
    tabDiv.appendChild(favicon);
    tabDiv.appendChild(title);
    tabDiv.appendChild(closeBtn);
    
    return tabDiv;
}

// Render all spaces as collapsible tab groups
// Deprecated - now using refreshTemporaryTabsList for unified view
async function renderAllSpacesAsTabGroups() {
    // This function is no longer used in unified view
    // Tab groups are now rendered via refreshTemporaryTabsList
    console.log('renderAllSpacesAsTabGroups is deprecated - using refreshTemporaryTabsList instead');
}

// Refresh temporary tabs list with tab groups
async function refreshTemporaryTabsList(spaceId) {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    
    const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
    if (!spaceElement) return;
    
    const tempContainer = spaceElement.querySelector('[data-tab-type="temporary"]');
    if (!tempContainer) return;
    
    // Clear existing content
    tempContainer.innerHTML = '';
    
    // Get ALL tabs in current window (not just from one space)
    const allWindowTabs = await chrome.tabs.query({ currentWindow: true });
    const temporaryTabObjects = [];
    
    // Get bookmarked tab URLs to exclude them (from bookmarks section)
    const bookmarksContainer = spaceElement.querySelector('.bookmarks-content .bookmarks-list');
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
                const groupElement = await createListTabGroupElement(group, spaceId);
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
async function createListTabGroupElement(group, spaceId) {
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
window.toggleTreeView = async function toggleTreeView(spaceId) {
    console.log('toggleTreeView called for space:', spaceId);
    
    const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
    if (!spaceElement) {
        console.error('Space element not found for space:', spaceId);
        return;
    }
    
    const tempListContainer = spaceElement.querySelector('.tabs-container[data-tab-type="temporary"]');
    const tempTreeContainer = spaceElement.querySelector('#tabsTreeContainer');
    const bookmarksListContainer = spaceElement.querySelector('.bookmarks-content.list-view');
    const bookmarksTreeContainer = spaceElement.querySelector('.bookmarks-tree-container');
    const viewModeBtn = spaceElement.querySelector('.view-mode-toggle');
    
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
        treeViewStates[spaceId] = false;
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
        treeViewStates[spaceId] = true;
        
        // Render tree view for bookmarks and temporary tabs
        console.log('Rendering tree view for bookmarks and temporary tabs in space:', spaceId);
        await renderTreeView(spaceId);
        await renderBookmarksTreeView(spaceId);
        console.log('Tree view render complete');
    }
    
    // Save tree view states to storage
    console.log('Saving tree view state:', treeViewStates);
    chrome.storage.local.set({ treeViewStates });
}

async function updateSpaceSwitcher() {
    // In unified view, space switcher is not used
    if (!spaceSwitcher) return;
    
    console.log('Updating space switcher...');
    spaceSwitcher.innerHTML = '';

    // --- Drag and Drop State ---
    let draggedButton = null;

    // --- Add listeners to the container ---
    spaceSwitcher.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        const currentlyDragged = document.querySelector('.dragging-switcher');
        if (!currentlyDragged) return; // Don't do anything if not dragging a switcher button

        const afterElement = getDragAfterElementSwitcher(spaceSwitcher, e.clientX);

        // Remove placeholder classes from all buttons first
        const buttons = spaceSwitcher.querySelectorAll('button');
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
            const lastElement = spaceSwitcher.querySelector('button:not(.dragging-switcher):last-of-type');
            if (lastElement) {
                 lastElement.classList.add('drag-over-placeholder-after');
            }
        }

        // --- Remove this block ---
        // We no longer move the element during dragover, rely on CSS placeholders
        /*
        if (currentlyDragged) {
            if (afterElement == null) {
                spaceSwitcher.appendChild(currentlyDragged);
            } else {
                spaceSwitcher.insertBefore(currentlyDragged, afterElement);
            }
        }
        */
       // --- End of removed block ---
    });

    spaceSwitcher.addEventListener('dragleave', (e) => {
        // Simple cleanup: remove placeholders if the mouse leaves the container area
        // More robust check might involve relatedTarget, but this is often sufficient
        if (e.target === spaceSwitcher) {
             const buttons = spaceSwitcher.querySelectorAll('button');
             buttons.forEach(button => {
                 button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
             });
        }
    });

    spaceSwitcher.addEventListener('drop', async (e) => {
        e.preventDefault();

         // Ensure placeholders are removed after drop
         const buttons = spaceSwitcher.querySelectorAll('button');
         buttons.forEach(button => {
             button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
         });

        if (draggedButton) {
            const targetElement = e.target.closest('button'); // Find the button dropped onto or near
            const draggedSpaceId = parseInt(draggedButton.dataset.spaceId);
            let targetSpaceId = targetElement ? parseInt(targetElement.dataset.spaceId) : null;

            // Find original index
            const originalIndex = spaces.findIndex(s => s.id === draggedSpaceId);
            if (originalIndex === -1) return; // Should not happen

            const draggedSpace = spaces[originalIndex];

            // Remove from original position
            spaces.splice(originalIndex, 1);

            // Find new index
            let newIndex;
            if (targetSpaceId) {
                const targetIndex = spaces.findIndex(s => s.id === targetSpaceId);
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
                 newIndex = spaces.length;
            }

            // Insert at new position
            // Ensure newIndex is within bounds (can happen if calculation is slightly off at edges)
            // newIndex = Math.max(0, Math.min(newIndex, spaces.length));
            console.log("droppedat", newIndex);

            if (newIndex < 0) {
                newIndex = 0;
            } else if (newIndex > spaces.length) {
                newIndex = spaces.length;
            }
            console.log("set", newIndex);

            spaces.splice(newIndex, 0, draggedSpace);

            // Save and re-render
            saveSpaces();
            await updateSpaceSwitcher(); // Re-render to reflect new order and clean up listeners
        }
        draggedButton = null; // Reset dragged item
    });


    spaces.forEach(space => {
        const button = document.createElement('button');
        button.textContent = space.name;
        button.dataset.spaceId = space.id; // Store space ID
        button.classList.toggle('active', space.id === activeSpaceId);
        button.draggable = true; // Make the button draggable

        button.addEventListener('click', async () => {
            if (button.classList.contains('dragging-switcher')) return;

            console.log("clicked for active", space);
            await setActiveSpace(space.id);
        });

        // --- Drag Event Listeners for Buttons ---
        button.addEventListener('dragstart', (e) => {
            draggedButton = button; // Store the button being dragged
            // Use a specific class to avoid conflicts with tab dragging
            setTimeout(() => button.classList.add('dragging-switcher'), 0);
            e.dataTransfer.effectAllowed = 'move';
            // Optional: Set drag data if needed elsewhere, though not strictly necessary for reordering within the same list
            // e.dataTransfer.setData('text/plain', space.id);
        });

        button.addEventListener('dragend', () => {
            // Clean up placeholders and dragging class on drag end (cancel/drop outside)
            const buttons = spaceSwitcher.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
            });
            if (draggedButton) { // Check if draggedButton is still set
                draggedButton.classList.remove('dragging-switcher');
            }
            draggedButton = null; // Ensure reset here too
        });

        spaceSwitcher.appendChild(button);
    });

    // Inactive space from bookmarks
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    spaceFolders.forEach(spaceFolder => {
        if(spaces.find(space => space.name == spaceFolder.title)) {
            return;
        } else {
            const button = document.createElement('button');
            button.textContent = spaceFolder.title;
            button.addEventListener('click', async () => {
                const newTab = await ChromeHelper.createNewTab();
                await createSpaceFromInactive(spaceFolder.title, newTab);
            });
            spaceSwitcher.appendChild(button);
        }
    });

    // const spaceFolder = spaceFolders.find(f => f.title === space.name);

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

async function setActiveSpace(spaceId, updateTab = true) {
    console.log('Setting active space:', spaceId);

    // Update global state
    activeSpaceId = spaceId;
    
    // Update tree view mode based on this space's state
    isTreeViewMode = treeViewStates[spaceId] || false;

    // Centralize logic in our new helper function
    await activateSpaceInDOM(spaceId, spaces, updateSpaceSwitcher);

    // In unified view, we don't need to manage Chrome tab group collapse states
    // All tab groups are shown as collapsible sections within the Tabs area
    
    // Apply duplicate filtering if enabled
    if (hideDuplicates) {
        setTimeout(() => filterDuplicates(), 200);
    }
}

async function createSpaceFromInactive(spaceName, tabToMove) {
    console.log(`Creating inactive space "${spaceName}" with tab:`, tabToMove);
    isCreatingSpace = true;
    try {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === spaceName);

        if (!spaceFolder) {
            console.error(`Bookmark folder for inactive space "${spaceName}" not found.`);
            return;
        }

        const groupColor = await Utils.getTabGroupColor(spaceName);
        const groupId = await ChromeHelper.createNewTabGroup(tabToMove, spaceName, groupColor);
        const spaceBookmarks = await Utils.processBookmarkFolder(spaceFolder, groupId);

        const space = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: spaceName,
            color: groupColor,
            spaceBookmarks: spaceBookmarks,
            temporaryTabs: [tabToMove.id],
            lastTab: tabToMove.id,
        };

        // Remove the moved tab from its old space
        const oldSpace = spaces.find(s => 
            s.temporaryTabs.includes(tabToMove.id) || s.spaceBookmarks.includes(tabToMove.id)
        );
        if (oldSpace) {
            oldSpace.temporaryTabs = oldSpace.temporaryTabs.filter(id => id !== tabToMove.id);
            oldSpace.spaceBookmarks = oldSpace.spaceBookmarks.filter(id => id !== tabToMove.id);
        }
        
        // Remove the tab's DOM element from the old space's UI
        const tabElementToRemove = document.querySelector(`[data-tab-id="${tabToMove.id}"]`);
        if (tabElementToRemove) {
            tabElementToRemove.remove();
        }

        spaces.push(space);
        saveSpaces();
        createSpaceElement(space);
        await setActiveSpace(space.id);
        updateSpaceSwitcher();
    } catch (error) {
        console.error(`Error creating space from inactive bookmark:`, error);
    } finally {
        isCreatingSpace = false;
    }
}

function saveSpaces() {
    console.log('Saving spaces to storage...', spaces);
    chrome.storage.local.set({ spaces }, () => {
        console.log('Spaces saved successfully');
    });
}

// moveTabToPinned removed - pinned section removed completely

async function moveTabToTemp(space, tab) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    const spaceFolder = spaceFolders.find(f => f.title === space.name);

    if (spaceFolder) {
        await Utils.searchAndRemoveBookmark(spaceFolder.id, tab.url);
    }

    // Move tab from bookmarks to temporary tabs in space data
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
    if (!space.temporaryTabs.includes(tab.id)) {
        space.temporaryTabs.push(tab.id);
    }

    saveSpaces();
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
                        const spaceId = container.closest('.space').dataset.spaceId;
                        const space = spaces.find(s => s.id === parseInt(spaceId));

                        if (space && tab) {
                            // Move tab from temporary to folder in space data
                            space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                            if (!space.spaceBookmarks.includes(tabId)) {
                                space.spaceBookmarks.push(tabId);
                            }

                            // Determine the target folder or container
                            const targetFolderContent = draggingElement.closest('.folder-content');
                            const targetFolder = targetFolderContent ? targetFolderContent.closest('.folder') : null;

                            // Add to bookmarks if URL doesn't exist
                            const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
                            if (spaceFolder) {
                                let parentId = spaceFolder.id;
                                if (targetFolder) {
                                    console.log("moving into a folder");
                                    const folderElement = targetFolder.closest('.folder');
                                    const folderName = folderElement.querySelector('.folder-name').value;
                                    const existingFolders = await chrome.bookmarks.getChildren(spaceFolder.id);
                                    let folder = existingFolders.find(f => f.title === folderName);
                                    if (!folder) {
                                        folder = await chrome.bookmarks.create({
                                            parentId: spaceFolder.id,
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
                                    await Utils.searchAndRemoveBookmark(spaceFolder.id, tab.url);

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

                            saveSpaces();
                        }
                        isDraggingTab = false;
                    });
                } else if (container.dataset.tabType === 'temporary' && draggingElement.dataset.tabId && !isDraggingTab) {
                    console.log("Tab dragged to temporary section");
                    isDraggingTab = true;
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.get(tabId, async (tab) => {
                        const space = spaces.find(s => s.id === parseInt(activeSpaceId));

                        if (space && tab) {
                            // Remove tab from bookmarks if it exists
                            moveTabToTemp(space, tab);
                        }
                        isDraggingTab = false;
                    });
                }
                // Pinned favicon dragging removed
            }
        });
    });
}

async function createNewFolder(spaceElement) {
    const bookmarksContainer = spaceElement.querySelector('.bookmarks-content .bookmarks-list');
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
        const spaceName = spaceElement.querySelector('.space-name').value;
        const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(spaceName);
        const existingFolders = await chrome.bookmarks.getChildren(spaceFolder.id);
        const folder = existingFolders.find(f => f.title === folderNameInput.value);
        if (!folder) {
            await chrome.bookmarks.create({
                parentId: spaceFolder.id,
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

async function loadTabs(space, tempContainer) {
    console.log('Loading tabs for space:', space.id);

    try {
        const tabs = await chrome.tabs.query({});

        // Get bookmarked tab URLs to exclude them
        const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
        const bookmarksContainer = spaceElement?.querySelector('.bookmarks-content .bookmarks-list');
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
                    const groupElement = await createListTabGroupElement(group, space.id);
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
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const activeSpace = spaces.find(s => s.id === activeSpaceId);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        console.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
            await Utils.searchAndRemoveBookmark(spaceFolder.id, tab.url, {
                removeTabElement: true,
                tabElement: tabElement,
                logRemoval: true
            });
        }

        return;
    }

    // In unified view, skip the "prevent closing last tab in group" check
    // since we're not managing Chrome tab groups as spaces
    if (activeSpaceId !== 'unified') {
        // If last tab is closed, create a new empty tab to prevent tab group from closing
        const tabsInGroup = await chrome.tabs.query({ groupId: parseInt(activeSpaceId) });
        console.log("tabsInGroup", tabsInGroup);
        if (tabsInGroup.length < 2) {
            console.log("creating new tab");
            await createNewTab(async () => {
                closeTab(tabElement, tab, isPinned, isBookmarkOnly);
            });
            return;
        }
    }
    const activeSpace = spaces.find(s => s.id === activeSpaceId);
    console.log("activeSpace", activeSpace);
    const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
    const isCurrentlyTemporary= activeSpace?.temporaryTabs.includes(tab.id);
    console.log("isCurrentlyPinned", isCurrentlyPinned, "isCurrentlyTemporary", isCurrentlyTemporary, "isPinned", isPinned);
    if (isCurrentlyPinned || (isPinned && !isCurrentlyTemporary)) {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        console.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
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
                spaceName: tab.spaceName
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
        const activeSpace = spaces.find(s => s.id === activeSpaceId);
        console.log("activeSpace", activeSpace);
        const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
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
                    const activeSpace = spaces.find(s => s.id === activeSpaceId);

                    if (newName && newName !== originalTitle) {
                        await Utils.setTabNameOverride(tab.id, tab.url, newName);
                        if (isPinned) {
                            await Utils.updateBookmarkTitleIfNeeded(tab, activeSpace, newName);
                        }
                    } else {
                        // If name is empty or same as original, remove override
                        await Utils.removeTabNameOverride(tab.id);
                        if (isPinned) {
                            await Utils.updateBookmarkTitleIfNeeded(tab, activeSpace, originalTitle);
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
                // Find the space this bookmark belongs to (assuming it's the active one for simplicity)
                const space = spaces.find(s => s.id === activeSpaceId);
                if (!space) {
                    console.error("Cannot open bookmark: Active space not found.");
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
                    spaceName: tab.spaceName
                };
                const activeBookmark = await createTabElement(bookmarkTab, true, false);
                activeBookmark.classList.add('active');
                tabElement.replaceWith(activeBookmark);

                // In unified view, don't force tabs into groups based on space ID
                if (activeSpaceId !== 'unified') {
                    // Immediately group the new tab
                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: parseInt(activeSpaceId) });
                }

                if (isPinned) {
                    const space = spaces.find(s => s.name === tab.spaceName);
                    if (space) {
                        space.spaceBookmarks.push(newTab.id);
                        saveSpaces();
                    }
                }

                saveSpaces(); // Save updated space state

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
            // Store last active tab for the space
            const space = spaces.find(s => s.id === tab.groupId);
            if (space) {
                space.lastTab = tab.id;
                saveSpaces();
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
        const allBookmarkSpaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        showTabContextMenu(e.pageX, e.pageY, tab, isPinned, isBookmarkOnly, tabElement, closeTab, spaces, moveTabToSpace, setActiveSpace, allBookmarkSpaceFolders, createSpaceFromInactive);
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
            
            const space = spaces.find(s => s.id === activeSpaceId);
            if (space) {
                space.temporaryTabs.push(newTab.id);
                saveSpaces();
                if(callback) {
                    callback();
                }
            }
        });
    });
}

async function createNewSpace() {
    console.log('Creating new space... Button clicked');
    isCreatingSpace = true;
    try {
        const spaceNameInput = document.getElementById('newSpaceName');
        const spaceColorSelect = document.getElementById('spaceColor');
        const spaceName = spaceNameInput.value.trim();
        const spaceColor = spaceColorSelect.value;

        if (!spaceName || spaces.some(space => space.name.toLowerCase() === spaceName.toLowerCase())) {
            const errorPopup = document.createElement('div');
            errorPopup.className = 'error-popup';
            errorPopup.textContent = 'A space with this name already exists';
            const inputContainer = document.getElementById('addSpaceInputContainer');
            inputContainer.appendChild(errorPopup);

            // Remove the error message after 3 seconds
            setTimeout(() => {
                errorPopup.remove();
            }, 3000);
            return;
        }
        const newTab = await ChromeHelper.createNewTab();
        const groupId = await ChromeHelper.createNewTabGroup(newTab, spaceName, spaceColor);

        const space = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: spaceName,
            color: spaceColor,
            spaceBookmarks: [],
            temporaryTabs: [newTab.id]
        };

        // Create bookmark folder for new space
        await LocalStorage.getOrCreateSpaceFolder(space.name);

        spaces.push(space);
        console.log('New space created:', { spaceId: space.id, spaceName: space.name, spaceColor: space.color });

        createSpaceElement(space);
        await updateSpaceSwitcher();
        await setActiveSpace(space.id);
        saveSpaces();

        isCreatingSpace = false;
        // Reset the space creation UI and show space switcher
        const addSpaceBtn = document.getElementById('addSpaceBtn');
        const inputContainer = document.getElementById('addSpaceInputContainer');
        const spaceSwitcher = document.getElementById('spaceSwitcher');
        addSpaceBtn.classList.remove('active');
        inputContainer.classList.remove('visible');
        spaceSwitcher.style.opacity = '1';
        spaceSwitcher.style.visibility = 'visible';
    } catch (error) {
        console.error('Error creating new space:', error);
    }
}

function cleanTemporaryTabs(spaceId) {
    console.log('Cleaning temporary tabs for space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        console.log("space.temporaryTabs", space.temporaryTabs);

        // iterate through temporary tabs and remove them with index
        space.temporaryTabs.forEach((tabId, index) => {
            if (index == space.temporaryTabs.length - 1) {
                createNewTab();
            }
            chrome.tabs.remove(tabId);
        });

        space.temporaryTabs = [];
        saveSpaces();
    }
}

function handleTabCreated(tab) {
    if (isCreatingSpace || isOpeningBookmark) {
        console.log('Skipping tab creation handler - space is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab created:', tab);
        // Don't force new tabs into any group - they'll stay in their opener's group or be ungrouped
        const space = spaces.find(s => s.id === activeSpaceId);

        if (space) {
            // Just track the tab, don't move it to any group
            if (!space.temporaryTabs.includes(tab.id)) {
                space.temporaryTabs.push(tab.id);
                saveSpaces();
            }
            
            // Refresh the temporary tabs list to show the new tab
            await refreshTemporaryTabsList(activeSpaceId);
            
            // Update tree view if in tree view mode (debounced)
            if (isTreeViewMode) {
                debouncedTreeViewRender(activeSpaceId);
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
        console.log('Tab updated:', tabId, changeInfo, spaces);

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
                    // Find which space this tab belongs to
                    const spaceWithTab = spaces.find(space =>
                        space.spaceBookmarks.includes(tabId) ||
                        space.temporaryTabs.includes(tabId)
                    );
                    
                    // If tab was in a space and was bookmarked, remove it from bookmarks
                    if (spaceWithTab && spaceWithTab.spaceBookmarks.includes(tabId)) {
                        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
                        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
                        const spaceFolder = spaceFolders.find(f => f.title === spaceWithTab.name);
                        
                        if (spaceFolder) {
                            await Utils.searchAndRemoveBookmark(spaceFolder.id, tab.url);
                        }
                    }
                    
                    // Remove tab from all spaces data when it becomes pinned
                    spaces.forEach(space => {
                        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
                        space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                    });
                    saveSpaces();
                    tabElement.remove(); // Remove from space
                    return;
                } else {
                    moveTabToSpace(tabId, activeSpaceId, false /* pinned */);
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
                await renderAllSpacesAsTabGroups();
            }
        }
        
        // Update tree view if in tree view mode (debounced) - now shows all groups
        if (isTreeViewMode) {
            debouncedTreeViewRender(activeSpaceId);
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
            spaces.forEach(space => {
                space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
                space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
            });
            saveSpaces();
            return;
        }
        
        const activeSpace = spaces.find(s => s.id === activeSpaceId);
        const isPinned = activeSpace?.spaceBookmarks.includes(tabId) || false;

        // Remove tab from spaces
        spaces.forEach(space => {
            space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
            space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
        });

        // Remove the tab element from the DOM
        tabElement.remove();

        if (!isPinned) {
            // Refresh the unified view to show updated tab counts
            await renderAllSpacesAsTabGroups();
        }

        saveSpaces();
        
        // Update tree view if in tree view mode (immediate for removals)
        if (isTreeViewMode) {
            debouncedTreeViewRender(activeSpaceId, 100);
        }
    } catch (error) {
        console.error('Error in handleTabRemove:', error);
    }
}

// handleTabMove function removed - the listener is disabled (see line 471)

function handleTabActivated(activeInfo) {
    if (isCreatingSpace) {
        console.log('Skipping tab creation handler - space is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (activeInfo.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab activated:', activeInfo);
        // Find which space contains this tab
        const spaceWithTab = spaces.find(space =>
            space.spaceBookmarks.includes(activeInfo.tabId) ||
            space.temporaryTabs.includes(activeInfo.tabId)
        );
        console.log("found space", spaceWithTab);

        if (spaceWithTab) {
            spaceWithTab.lastTab = activeInfo.tabId;
            saveSpaces();
            console.log("lasttab space", spaces);
        }

        if (spaceWithTab && spaceWithTab.id !== activeSpaceId) {
            // Switch to the space containing the tab
            await activateSpaceInDOM(spaceWithTab.id, spaces, updateSpaceSwitcher);
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current space
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

async function deleteSpace(spaceId) {
    console.log('Deleting space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        // Close all tabs in the space
        [...space.spaceBookmarks, ...space.temporaryTabs].forEach(tabId => {
            chrome.tabs.remove(tabId);
        });

        // Remove space from array
        spaces = spaces.filter(s => s.id !== spaceId);

        // Remove space element from DOM
        const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
        if (spaceElement) {
            spaceElement.remove();
        }

        // If this was the active space, switch to another space
        if (activeSpaceId === spaceId && spaces.length > 0) {
            await setActiveSpace(spaces[0].id);
        }

        // Delete bookmark folder for this space
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === space.name);
        await chrome.bookmarks.removeTree(spaceFolder.id);

        // Save changes
        saveSpaces();
        await updateSpaceSwitcher();
    }
}

////////////////////////////////////////////////////////////////
// -- Helper Functions
////////////////////////////////////////////////////////////////

async function moveTabToSpace(tabId, spaceId, pinned = false, openerTabId = null) {
    // Remove tab from its original space data first
    const sourceSpace = spaces.find(s => 
        s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId)
    );
    if (sourceSpace && sourceSpace.id !== spaceId) {
        sourceSpace.temporaryTabs = sourceSpace.temporaryTabs.filter(id => id !== tabId);
        sourceSpace.spaceBookmarks = sourceSpace.spaceBookmarks.filter(id => id !== tabId);
    }
    
    // 1. Find the target space
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
        console.warn(`Space with ID ${spaceId} not found.`);
        return;
    }

    // 2. In unified view, we don't move tabs between Chrome tab groups
    // Tabs stay in their original Chrome tab groups and we just update our tracking

    // 3. Update local space data
    // Remove tab from both arrays just in case
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);

    if (pinned) {
        space.spaceBookmarks.push(tabId);
    } else {
        space.temporaryTabs.push(tabId);
    }

    // 4. Update the UI (remove tab element from old section, create it in new section)
    // Remove any existing DOM element for this tab
    const oldTabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    oldTabElement?.remove();

    // Add a fresh tab element if needed
    const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
    if (spaceElement) {
        if (pinned) {
            // For bookmarked tabs, add to bookmarks section
            const container = spaceElement.querySelector('.bookmarks-content .bookmarks-list');
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
            await refreshTemporaryTabsList(spaceId);
        }
    }

    // 5. Save the updated spaces to storage
    saveSpaces();
}
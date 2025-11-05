import { Utils } from './utils.js';
import { RESTORE_ICON } from './icons.js';

// Helper function to convert Chrome group color names to CSS colors
function getChromeGroupColor(colorName) {
    const colorMap = {
        'grey': '#5F6368',
        'blue': '#1A73E8',
        'red': '#D93025',
        'yellow': '#F9AB00',
        'green': '#1E8E3E',
        'pink': '#D01884',
        'purple': '#9334E6',
        'cyan': '#007B83',
        'orange': '#E8710A'
    };
    return colorMap[colorName] || '#5F6368';
}

export function setupDOMElements(createNewTabGroup, createNewTab) {
    // Get DOM Elements (must be done here, not at module load time)
    const tabGroupsList = document.getElementById('tabGroupsList');
    const tabGroupSwitcher = document.getElementById('tabGroupSwitcher');
    const addTabGroupBtn = document.getElementById('addTabGroupBtn');
    const newTabBtn = document.getElementById('newTabBtn');
    const tabGroupTemplate = document.getElementById('tabGroupTemplate');
    
    console.log('🔧 setupDOMElements - DOM elements:', {
        tabGroupsList: !!tabGroupsList,
        tabGroupSwitcher: !!tabGroupSwitcher,
        addTabGroupBtn: !!addTabGroupBtn,
        newTabBtn: !!newTabBtn,
        tabGroupTemplate: !!tabGroupTemplate
    });
    
    // Only add tabGroupSwitcher listener if it exists (hidden in unified view)
    if (tabGroupSwitcher) {
        tabGroupSwitcher.addEventListener('wheel', (event) => {
            event.preventDefault();

            const scrollAmount = event.deltaY;

            tabGroupSwitcher.scrollLeft += scrollAmount;
        }, { passive: false });
    }

    // Add event listeners for buttons (only if they exist - hidden in unified view)
    if (addTabGroupBtn) {
        addTabGroupBtn.addEventListener('click', () => {
            const inputContainer = document.getElementById('addTabGroupInputContainer');
            const tabGroupNameInput = document.getElementById('newTabGroupName');
            const isInputVisible = inputContainer.classList.contains('visible');

            // Toggle visibility classes
            inputContainer.classList.toggle('visible');
            addTabGroupBtn.classList.toggle('active');

            // Toggle tab group switcher visibility
            if (isInputVisible && tabGroupSwitcher) {
                tabGroupSwitcher.style.opacity = '1';
                tabGroupSwitcher.style.visibility = 'visible';
            } else if (tabGroupSwitcher) {
                tabGroupNameInput.value = '';
                tabGroupSwitcher.style.opacity = '0';
                tabGroupSwitcher.style.visibility = 'hidden';
            }
        });
    }

    // Only add create tab group button listener if it exists (hidden in unified view)
    const createTabGroupBtn = document.getElementById('createTabGroupBtn');
    if (createTabGroupBtn) {
        createTabGroupBtn.addEventListener('click', createNewTabGroup);
    }
    
    // Only add new tab button listener if it exists (it's removed in unified view)
    if (newTabBtn) {
        newTabBtn.addEventListener('click', createNewTab);
    }

    const createTabGroupColorSwatch = document.getElementById('createTabGroupColorSwatch');
    if (createTabGroupColorSwatch) {
        createTabGroupColorSwatch.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-swatch')) {
                const colorPicker = document.getElementById('createTabGroupColorSwatch');
                const select = document.getElementById('tabGroupColor');
                const color = e.target.dataset.color;

                // Update selected swatch
                colorPicker.querySelectorAll('.color-swatch').forEach(swatch => {
                    swatch.classList.remove('selected');
                });
                e.target.classList.add('selected');

                // Update hidden select value
                select.value = color;

                // Trigger change event on select
                const event = new Event('change');
                select.dispatchEvent(event);
            }
        });
    }

    // Initialize selected swatches (only if they exist)
    const tabGroupColorSelects = document.querySelectorAll('.tab-group-color-select');
    if (tabGroupColorSelects.length > 0) {
        tabGroupColorSelects.forEach(select => {
            const colorPicker = select.nextElementSibling;
            if (colorPicker) {
                const currentColor = select.value;
                const swatch = colorPicker.querySelector(`[data-color="${currentColor}"]`);
                if (swatch) {
                    swatch.classList.add('selected');
                }
            }
        });
    }

    // Add input validation for new tab group name (only if it exists)
    const newTabGroupNameInput = document.getElementById('newTabGroupName');
    if (newTabGroupNameInput) {
        newTabGroupNameInput.addEventListener('input', (e) => {
            const createTabGroupBtn = document.getElementById('createTabGroupBtn');
            if (createTabGroupBtn) {
                createTabGroupBtn.disabled = !e.target.value.trim();
            }
        });
    }
    
    console.log('✅ setupDOMElements completed successfully');
}

export function showTabGroupNameInput() {
    const addTabGroupBtn = document.getElementById('addTabGroupBtn');
    const addTabGroupInputContainer = document.getElementById('addTabGroupInputContainer');

    addTabGroupBtn.classList.toggle('active');
    addTabGroupInputContainer.classList.toggle('visible');
    const errorPopup = document.createElement('div');
    errorPopup.className = 'error-popup';
    errorPopup.textContent = 'A tab group with this name already exists';
    const inputContainer = document.getElementById('addTabGroupInputContainer');
    inputContainer.appendChild(errorPopup);

    // Remove the error message after 3 seconds
    setTimeout(() => {
        errorPopup.remove();
    }, 3000);
    return;
}

export function activateTabInDOM(tabId) {
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    // If there's a tab element with this ID, mark it active
    const targetTab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

export function activateTabGroupInDOM(groupId, tabGroups, updateTabGroupSwitcher) {
    // Show/hide tab group containers
    document.querySelectorAll('.tab-group').forEach(g => {
        const isActive = g.dataset.groupId === String(groupId);
        g.classList.toggle('active', isActive);
        g.style.display = isActive ? 'block' : 'none';
    });

    // Get tab group color and update sidebar container background
    const tabGroup = tabGroups.find(g => g.id === groupId);
    if (tabGroup) {
        // Update background color
        const sidebarContainer = document.getElementById('sidebar-container');
        sidebarContainer.style.setProperty('--group-bg-color', `var(--chrome-${tabGroup.color}-color, rgba(255, 255, 255, 0.1))`);
        sidebarContainer.style.setProperty('--group-bg-color-dark', `var(--chrome-${tabGroup.color}-color-dark, rgba(255, 255, 255, 0.1))`);
    }

    // Update tab group switcher
    updateTabGroupSwitcher();
}

export function showTabContextMenu(x, y, tab, isPinned, isBookmarkOnly, tabElement, closeTab, tabGroups, moveTabToTabGroup, setActiveTabGroup, allBookmarkTabGroupFolders, createTabGroupFromInactive) {
    // Remove any existing context menus
    const existingMenu = document.getElementById('tab-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.id = 'tab-context-menu';
    contextMenu.className = 'context-menu'; // Reuse general context menu styling
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    // --- Menu Items ---

    // Only show these options for actual tabs that are part of a tab group
    if (!isBookmarkOnly) {
        // Add/Remove from Favorites option
        const favoritesOption = document.createElement('div');
        favoritesOption.className = 'context-menu-item';
        
        // Check if tab is already in favorites (using consistent async/await)
        const checkFavorites = async () => {
            try {
                const result = await chrome.storage.local.get('favorites');
                const favorites = result.favorites || [];
                const isInFavorites = favorites.some(f => f.url === tab.url);
                favoritesOption.textContent = isInFavorites ? '★ Remove from Favorites' : '☆ Add to Favorites';
            } catch (error) {
                console.error('Error checking favorites:', error);
                favoritesOption.textContent = '☆ Add to Favorites';
            }
        };
        checkFavorites();
        
        favoritesOption.addEventListener('click', async () => {
            contextMenu.remove(); // Close menu immediately for better UX
            
            try {
                // Validate tab URL before proceeding
                if (!tab.url || 
                    tab.url.startsWith('chrome://') || 
                    tab.url.startsWith('chrome-extension://') ||
                    tab.url === 'about:blank' ||
                    tab.url === '') {
                    console.warn('⚠️ Cannot add to favorites: Invalid or system URL:', tab.url);
                    return;
                }
                
                // Validate it's a proper HTTP(S) URL
                try {
                    const testUrl = new URL(tab.url);
                    if (!testUrl.protocol.startsWith('http')) {
                        console.warn('⚠️ Cannot add to favorites: Not an HTTP(S) URL:', tab.url);
                        return;
                    }
                } catch (urlError) {
                    console.error('❌ Invalid URL format:', tab.url, urlError);
                    return;
                }
                
                // Get current favorites
                const result = await chrome.storage.local.get('favorites');
                let favorites = result.favorites || [];
                
                // Check if already in favorites
                const existingIndex = favorites.findIndex(f => f.url === tab.url);
                
                if (existingIndex !== -1) {
                    // Remove from favorites
                    favorites.splice(existingIndex, 1);
                    console.log('✅ Removed from favorites:', tab.title);
                } else {
                    // Get reliable favicon URL
                    let favIconUrl = tab.favIconUrl;
                    const urlObj = new URL(tab.url);
                    const hostname = urlObj.hostname;
                    
                    // Validate favicon URL or use Google's service
                    if (!favIconUrl || 
                        favIconUrl.includes('chrome://') || 
                        favIconUrl.includes('chrome-extension://') ||
                        !(favIconUrl.startsWith('http://') || favIconUrl.startsWith('https://'))) {
                        // Always use Google's favicon service with the domain
                        favIconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
                        console.log('🌐 Using Google favicon service for:', hostname);
                    } else {
                        console.log('✅ Using tab favicon for:', hostname);
                    }
                    
                    // Add to favorites
                    favorites.push({
                        url: tab.url,
                        title: tab.title || hostname,
                        favIconUrl: favIconUrl,
                        addedAt: Date.now()
                    });
                    console.log('✅ Added to favorites:', tab.title || hostname);
                }
                
                // Save and trigger re-render
                await chrome.storage.local.set({ 
                    favorites, 
                    favoritesLastSaved: new Date().toISOString() 
                });
                
                // Dispatch event to trigger re-render
                window.dispatchEvent(new CustomEvent('favoritesChanged'));
            } catch (error) {
                console.error('❌ Error updating favorites:', error);
            }
        });
        contextMenu.appendChild(favoritesOption);

        const addToBookmarkOption = document.createElement('div');
        addToBookmarkOption.className = 'context-menu-item';
        addToBookmarkOption.textContent = 'Add to Bookmark';
        addToBookmarkOption.addEventListener('click', async () => {
            try {
                // Get current Chrome bookmarks bar
                const bookmarkBarNodes = await chrome.bookmarks.getChildren('1'); // '1' is typically the bookmark bar
                
                // Check if bookmark already exists
                const existingBookmark = bookmarkBarNodes.find(b => b.url === tab.url);
                if (!existingBookmark) {
                    await chrome.bookmarks.create({
                        parentId: '1', // Bookmark bar
                        title: tab.title,
                        url: tab.url
                    });
                    console.log('Bookmark added:', tab.title);
                } else {
                    console.log('Bookmark already exists');
                }
            } catch (error) {
                console.error('Error adding bookmark:', error);
            }
            contextMenu.remove();
        });
        contextMenu.appendChild(addToBookmarkOption);

        // Add a separator
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        contextMenu.appendChild(separator);

        // 2. Move to Group (using Chrome's native tab groups)
        // Build the group menu asynchronously
        const buildGroupMenu = async () => {
            const moveToGroupItem = document.createElement('div');
            moveToGroupItem.className = 'context-menu-item with-submenu';
            moveToGroupItem.textContent = 'Move to Group';

            const submenu = document.createElement('div');
            submenu.className = 'context-menu submenu';

            try {
                // Get all existing tab groups in the current window (using Promise-based API)
                const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
                
                // Filter out the group that the tab is currently in
                const otherGroups = groups.filter(g => g.id !== tab.groupId);

                // Add existing groups to the submenu
                otherGroups.forEach(group => {
                    const submenuItem = document.createElement('div');
                    submenuItem.className = 'context-menu-item';
                    
                    // Add color indicator
                    const colorIndicator = document.createElement('span');
                    colorIndicator.style.display = 'inline-block';
                    colorIndicator.style.width = '10px';
                    colorIndicator.style.height = '10px';
                    colorIndicator.style.borderRadius = '50%';
                    colorIndicator.style.marginRight = '8px';
                    colorIndicator.style.backgroundColor = getChromeGroupColor(group.color);
                    
                    submenuItem.appendChild(colorIndicator);
                    submenuItem.appendChild(document.createTextNode(group.title || 'Unnamed Group'));
                    
                    submenuItem.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        contextMenu.remove();
                        
                        try {
                            // Move tab to the selected group
                            await chrome.tabs.group({ groupId: group.id, tabIds: [tab.id] });
                            console.log(`✅ Moved tab ${tab.id} to group "${group.title}"`);
                        } catch (error) {
                            console.error('❌ Error moving tab to group:', error);
                        }
                    });
                    submenu.appendChild(submenuItem);
                });

                // Add separator if there are existing groups
                if (otherGroups.length > 0) {
                    const separator = document.createElement('div');
                    separator.className = 'context-menu-separator';
                    submenu.appendChild(separator);
                }

                // Add "New Group" option
                const newGroupItem = document.createElement('div');
                newGroupItem.className = 'context-menu-item';
                newGroupItem.textContent = '+ New Group';
                newGroupItem.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    contextMenu.remove();
                    
                    try {
                        // Create a new group with this tab
                        const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
                        
                        // Prompt for group name
                        const groupName = prompt('Enter group name (optional):');
                        if (groupName) {
                            await chrome.tabGroups.update(groupId, { title: groupName });
                        }
                        
                        console.log(`✅ Created new group with tab ${tab.id}`);
                    } catch (error) {
                        console.error('❌ Error creating new group:', error);
                    }
                });
                submenu.appendChild(newGroupItem);

                // Add "Remove from Group" option if tab is in a group
                if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    const separator = document.createElement('div');
                    separator.className = 'context-menu-separator';
                    submenu.appendChild(separator);

                    const ungroupItem = document.createElement('div');
                    ungroupItem.className = 'context-menu-item';
                    ungroupItem.textContent = 'Remove from Group';
                    ungroupItem.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        contextMenu.remove();
                        
                        try {
                            await chrome.tabs.ungroup([tab.id]);
                            console.log(`✅ Removed tab ${tab.id} from group`);
                        } catch (error) {
                            console.error('❌ Error removing tab from group:', error);
                        }
                    });
                    submenu.appendChild(ungroupItem);
                }

                // Add submenu to the menu item
                moveToGroupItem.appendChild(submenu);
                contextMenu.appendChild(moveToGroupItem);
            } catch (error) {
                console.error('❌ Error building group menu:', error);
            }
        };

        // Build the group menu (async)
        buildGroupMenu();
    }

    // Archive Tab (Only for active tabs)
    if (!isBookmarkOnly) {
        const archiveOption = document.createElement('div');
        archiveOption.className = 'context-menu-item';
        archiveOption.textContent = 'Archive Tab';
        archiveOption.addEventListener('click', async () => {
            await Utils.archiveTab(tab.id); // Use the utility function
            contextMenu.remove();
        });
        contextMenu.appendChild(archiveOption);
    }

    // Close Tab / Remove Bookmark
    const closeOption = document.createElement('div');
    closeOption.className = 'context-menu-item';
    closeOption.textContent = isBookmarkOnly ? 'Remove Bookmark' : 'Close Tab';
    closeOption.addEventListener('click', () => {
        closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        contextMenu.remove();
    });
    contextMenu.appendChild(closeOption);

    // --- Add to DOM and setup closing ---
    document.body.appendChild(contextMenu);

    // Close context menu when clicking outside
    const closeContextMenu = (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.remove();
            document.removeEventListener('click', closeContextMenu, { capture: true }); // Use capture phase
        }
    };
    // Use capture phase to catch clicks before they bubble up
    document.addEventListener('click', closeContextMenu, { capture: true });
}

export async function showArchivedTabsPopup(activeGroupId) {
    const tabGroupElement = document.querySelector(`[data-group-id="${activeGroupId}"]`);
    const popup = tabGroupElement.querySelector('.archived-tabs-popup');
    const list = popup.querySelector('.archived-tabs-list');
    const message = popup.querySelector('.no-archived-tabs-message');
    list.innerHTML = '';

    // --- Archiving Controls ---
    let controls = popup.querySelector('.archiving-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'archiving-controls';
        popup.insertBefore(controls, list);
    } else {
        controls.innerHTML = '';
    }

    // Fetch current settings
    const settings = await Utils.getSettings();
    const archivingEnabled = settings.autoArchiveEnabled;
    const archiveTime = settings.autoArchiveIdleMinutes;

    // Toggle (styled)
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'archiving-toggle-label';
    const toggleWrapper = document.createElement('span');
    toggleWrapper.className = 'archiving-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = archivingEnabled;
    const slider = document.createElement('span');
    slider.className = 'archiving-toggle-slider';
    toggleWrapper.appendChild(toggle);
    toggleWrapper.appendChild(slider);
    toggleLabel.appendChild(toggleWrapper);
    toggleLabel.appendChild(document.createTextNode('Enable Archiving'));
    controls.appendChild(toggleLabel);

    // Archive time input (styled)
    const timeContainer = document.createElement('div');
    timeContainer.className = 'archiving-time-container';
    const timeInput = document.createElement('input');
    timeInput.type = 'number';
    timeInput.min = '1';
    timeInput.value = archiveTime;
    timeInput.className = 'archiving-time-input';
    timeInput.disabled = !archivingEnabled;
    const minLabel = document.createElement('span');
    minLabel.textContent = 'min';
    timeContainer.appendChild(timeInput);
    timeContainer.appendChild(minLabel);
    controls.appendChild(timeContainer);

    // Event listeners
    toggle.addEventListener('change', async (e) => {
        const enabled = toggle.checked;
        timeInput.disabled = !enabled;
        await Utils.setArchivingEnabled(enabled);
    });
    timeInput.addEventListener('change', async (e) => {
        let val = parseInt(timeInput.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        timeInput.value = val;
        await Utils.setArchiveTime(val);
    });

    // --- End Archiving Controls ---

    if (!archivingEnabled) {
        message.textContent = 'Tab Archiving is disabled. Use the toggle above to enable.';
        list.style.display = 'none';
        return;
    }

    if (!(await Utils.isArchivingEnabled())) {
        message.textContent = 'Tab Archiving is disabled. Go to extension settings to enable.';
        list.style.display = 'none';
        return;
    }

    const allArchived = await Utils.getArchivedTabs();
    if (allArchived.length === 0) {
        message.textContent = 'No archived tabs.';
        list.style.display = 'none';
    } else {
        message.textContent = '';
        list.style.display = 'block';
        allArchived.forEach(archivedTab => {
            const item = document.createElement('div');
            item.className = 'tab archived-item';
            item.title = `${archivedTab.name}\n${archivedTab.url}\nArchived: ${new Date(archivedTab.archivedAt).toLocaleString()}`;

            const favicon = document.createElement('img');
            favicon.src = Utils.getFaviconUrl(archivedTab.url);
            favicon.className = 'tab-favicon';
            favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; };

            const details = document.createElement('div');
            details.className = 'tab-details';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'tab-title-display';
            titleSpan.textContent = archivedTab.name;
            details.appendChild(titleSpan);

            const restoreButton = document.createElement('button');
            restoreButton.innerHTML = RESTORE_ICON;
            restoreButton.className = 'tab-restore';
            restoreButton.style.marginLeft = 'auto';
            restoreButton.addEventListener('click', (e) => {
                e.stopPropagation();
                Utils.restoreArchivedTab(archivedTab);
                item.remove();
                if (list.children.length === 0) {
                    message.style.display = 'block';
                    list.style.display = 'none';
                }
            });

            item.appendChild(favicon);
            item.appendChild(details);
            item.appendChild(restoreButton);
            list.appendChild(item);
        });
    }
}

export function setupQuickPinListener(moveTabToTabGroup, moveTabToTemp) {
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.command === "quickPinToggle" || request.command === "toggleTabGroupPin") {
            console.log(`[QuickPin] Received command: ${request.command}`, { request });
            chrome.storage.local.get('tabGroups', function(result) {
                const tabGroups = result.tabGroups || [];
                console.log("[QuickPin] Loaded tab groups from storage:", tabGroups);

                const getTabAndToggle = (tabToToggle) => {
                    if (!tabToToggle) {
                        console.error("[QuickPin] No tab found to toggle.");
                        return;
                    }
                    console.log("[QuickPin] Toggling pin state for tab:", tabToToggle);
                    
                    const tabGroupWithTempTab = tabGroups.find(tabGroup =>
                        tabGroup.temporaryTabs.includes(tabToToggle.id)
                    );

                    if (tabGroupWithTempTab) {
                        console.log(`[QuickPin] Tab ${tabToToggle.id} is a temporary tab in tab group "${tabGroupWithTempTab.name}". Adding to bookmark.`);
                        moveTabToTabGroup(tabToToggle.id, tabGroupWithTempTab.id, true);
                        // moveTabToPinned removed - pinned section removed
                    } else {
                        const tabGroupWithBookmark = tabGroups.find(tabGroup =>
                            tabGroup.tabGroupBookmarks.includes(tabToToggle.id)
                        );

                        if (tabGroupWithBookmark) {
                            console.log(`[QuickPin] Tab ${tabToToggle.id} is a bookmarked tab in tab group "${tabGroupWithBookmark.name}". Unpinning it.`);
                            moveTabToTabGroup(tabToToggle.id, tabGroupWithBookmark.id, false);
                            moveTabToTemp(tabGroupWithBookmark, tabToToggle);
                        } else {
                            console.warn(`[QuickPin] Tab ${tabToToggle.id} not found in any tab group as temporary or bookmarked.`);
                        }
                    }
                };

                if (request.command === "quickPinToggle") {
                    console.log("[QuickPin] Handling quickPinToggle for active tab.");
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        getTabAndToggle(tabs[0]);
                    });
                } else if (request.command === "toggleTabGroupPin" && request.tabId) {
                    console.log(`[QuickPin] Handling toggleTabGroupPin for tabId: ${request.tabId}`);
                    chrome.tabs.get(request.tabId, function(tab) {
                        getTabAndToggle(tab);
                    });
                }
            });
        }
    });
} 
// Amplify Features: Dark Mode and Tree View
// This module adds dark mode toggle and tree view functionality

class AmplifyFeatures {
    constructor() {
        this.isDarkMode = false;
        this.isTreeView = false;
        this.init();
    }

    async init() {
        // Load saved preferences
        await this.loadPreferences();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Apply saved theme
        this.applyTheme();
    }

    async loadPreferences() {
        try {
            const result = await chrome.storage.local.get(['darkMode', 'treeView']);
            this.isDarkMode = result.darkMode || false;
            this.isTreeView = result.treeView || false;
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }

    async savePreferences() {
        try {
            await chrome.storage.local.set({
                darkMode: this.isDarkMode,
                treeView: this.isTreeView
            });
        } catch (error) {
            console.error('Error saving preferences:', error);
        }
    }

    setupEventListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // View mode toggle
        const viewModeBtn = document.getElementById('viewModeBtn');
        if (viewModeBtn) {
            viewModeBtn.addEventListener('click', () => this.toggleViewMode());
        }
    }

    toggleTheme() {
        this.isDarkMode = !this.isDarkMode;
        this.applyTheme();
        this.savePreferences();
    }

    applyTheme() {
        if (this.isDarkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }

    toggleViewMode() {
        this.isTreeView = !this.isTreeView;
        this.applyViewMode();
        this.savePreferences();
    }

    applyViewMode() {
        const listView = document.querySelector('.tabs-container[data-tab-type="temporary"]');
        const treeContainer = document.getElementById('tabsTreeContainer');
        const viewModeBtn = document.getElementById('viewModeBtn');
        
        if (!listView || !treeContainer) return;

        if (this.isTreeView) {
            listView.style.display = 'none';
            treeContainer.style.display = 'block';
            this.renderTreeView();
            
            // Update icon
            if (viewModeBtn) {
                viewModeBtn.querySelector('.list-icon').style.display = 'none';
                viewModeBtn.querySelector('.tree-icon').style.display = 'block';
            }
        } else {
            listView.style.display = 'block';
            treeContainer.style.display = 'none';
            
            // Update icon
            if (viewModeBtn) {
                viewModeBtn.querySelector('.list-icon').style.display = 'block';
                viewModeBtn.querySelector('.tree-icon').style.display = 'none';
            }
        }
    }

    async renderTreeView() {
        const treeContainer = document.getElementById('tabsTreeContainer');
        if (!treeContainer) return;

        // Get all tabs from the temporary tabs container
        const listView = document.querySelector('.tabs-container[data-tab-type="temporary"]');
        if (!listView) return;

        const tabs = Array.from(listView.querySelectorAll('.tab')).map(tabEl => {
            const tabId = tabEl.dataset.tabId;
            const title = tabEl.querySelector('.tab-title-display')?.textContent || '';
            const domain = tabEl.querySelector('.tab-domain-display')?.textContent || '';
            const favicon = tabEl.querySelector('.tab-favicon')?.src || '';
            const isActive = tabEl.classList.contains('active');
            
            return { tabId, title, domain, favicon, isActive, element: tabEl };
        });

        // Group tabs by domain
        const domainGroups = this.groupTabsByDomain(tabs);
        
        // Render the tree
        treeContainer.innerHTML = '';
        
        for (const [domain, domainTabs] of Object.entries(domainGroups)) {
            const groupEl = this.createDomainGroup(domain, domainTabs);
            treeContainer.appendChild(groupEl);
        }
    }

    groupTabsByDomain(tabs) {
        const groups = {};
        
        tabs.forEach(tab => {
            let domain = tab.domain;
            
            // If no domain, try to extract from title or use 'Other'
            if (!domain || domain.trim() === '') {
                domain = 'Other';
            }
            
            if (!groups[domain]) {
                groups[domain] = [];
            }
            
            groups[domain].push(tab);
        });
        
        // Sort groups by domain name
        const sortedGroups = {};
        Object.keys(groups).sort().forEach(key => {
            sortedGroups[key] = groups[key];
        });
        
        return sortedGroups;
    }

    createDomainGroup(domain, tabs) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'tree-domain-group';
        groupDiv.dataset.domain = domain;
        
        // Header
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
        
        // Domain icon (use first tab's favicon)
        const domainIcon = document.createElement('img');
        domainIcon.className = 'tree-domain-icon';
        domainIcon.src = tabs[0]?.favicon || 'assets/default_icon.png';
        domainIcon.onerror = () => {
            domainIcon.src = 'assets/default_icon.png';
        };
        
        // Domain name
        const domainName = document.createElement('div');
        domainName.className = 'tree-domain-name';
        domainName.textContent = domain;
        
        // Tab count
        const count = document.createElement('div');
        count.className = 'tree-domain-count';
        count.textContent = tabs.length;
        
        header.appendChild(expandIcon);
        header.appendChild(domainIcon);
        header.appendChild(domainName);
        header.appendChild(count);
        
        // Tabs container
        const tabsDiv = document.createElement('div');
        tabsDiv.className = 'tree-domain-tabs expanded';
        
        tabs.forEach(tab => {
            const tabItem = this.createTreeTabItem(tab);
            tabsDiv.appendChild(tabItem);
        });
        
        // Toggle expand/collapse
        header.addEventListener('click', () => {
            expandIcon.classList.toggle('expanded');
            tabsDiv.classList.toggle('expanded');
        });
        
        groupDiv.appendChild(header);
        groupDiv.appendChild(tabsDiv);
        
        return groupDiv;
    }

    createTreeTabItem(tab) {
        const tabDiv = document.createElement('div');
        tabDiv.className = 'tree-tab-item';
        if (tab.isActive) {
            tabDiv.classList.add('active');
        }
        tabDiv.dataset.tabId = tab.tabId;
        
        // Favicon
        const favicon = document.createElement('img');
        favicon.className = 'tree-tab-favicon';
        favicon.src = tab.favicon || 'assets/default_icon.png';
        favicon.onerror = () => {
            favicon.src = 'assets/default_icon.png';
        };
        
        // Title
        const title = document.createElement('div');
        title.className = 'tree-tab-title';
        title.textContent = tab.title || tab.domain;
        title.title = tab.title; // Tooltip
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tree-tab-close';
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close tab';
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Find and click the close button in the original tab element
            const originalCloseBtn = tab.element.querySelector('.tab-close, .tab-remove');
            if (originalCloseBtn) {
                originalCloseBtn.click();
            }
            // Remove from tree view
            tabDiv.remove();
            
            // If no more tabs in this domain, remove the entire group
            const domainGroup = tabDiv.closest('.tree-domain-group');
            if (domainGroup) {
                const remainingTabs = domainGroup.querySelectorAll('.tree-tab-item');
                if (remainingTabs.length === 0) {
                    domainGroup.remove();
                }
            }
        });
        
        // Click to activate tab
        tabDiv.addEventListener('click', () => {
            // Click the original tab element to activate it
            if (tab.element) {
                tab.element.click();
            }
            
            // Update active state in tree view
            document.querySelectorAll('.tree-tab-item').forEach(item => {
                item.classList.remove('active');
            });
            tabDiv.classList.add('active');
        });
        
        tabDiv.appendChild(favicon);
        tabDiv.appendChild(title);
        tabDiv.appendChild(closeBtn);
        
        return tabDiv;
    }

    // Public method to refresh tree view when tabs change
    refreshTreeView() {
        if (this.isTreeView) {
            this.renderTreeView();
        }
    }
}

// Export for use in sidebar.js
window.amplifyFeatures = new AmplifyFeatures();

// Listen for tab updates to refresh tree view
chrome.tabs.onUpdated.addListener(() => {
    if (window.amplifyFeatures && window.amplifyFeatures.isTreeView) {
        setTimeout(() => window.amplifyFeatures.refreshTreeView(), 500);
    }
});

chrome.tabs.onRemoved.addListener(() => {
    if (window.amplifyFeatures && window.amplifyFeatures.isTreeView) {
        setTimeout(() => window.amplifyFeatures.refreshTreeView(), 500);
    }
});


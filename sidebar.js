// nTabManager Sidebar JavaScript - Vertical Tabs Management

class VerticalTabManager {
  constructor() {
    this.tabs = [];
    this.windows = [];
    this.currentPosition = 'left';
    this.searchQuery = '';
    this.duplicateGroups = new Map();
    this.init();
  }

  async init() {
    // Load user preferences
    await this.loadSettings();
    
    // Bind event listeners
    this.bindEvents();
    
    // Initial load
    await this.refreshTabs();
    
    // Set up periodic refresh
    this.startPeriodicRefresh();
    
    // Apply initial position
    this.applyPosition();
    
    console.log('🚀 Vertical Tab Manager initialized');
  }

  bindEvents() {
    // Header actions
    document.getElementById('position-btn').addEventListener('click', () => {
      this.togglePositionSettings();
    });

    document.getElementById('settings-btn').addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
      this.refreshTabs();
    });

    // Quick actions
    document.getElementById('close-duplicates-btn').addEventListener('click', () => {
      this.closeDuplicates();
    });

    document.getElementById('close-others-btn').addEventListener('click', () => {
      this.closeOtherTabs();
    });

    // Search functionality
    const searchInput = document.getElementById('search-tabs');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.filterTabs();
    });

    document.getElementById('clear-search').addEventListener('click', () => {
      searchInput.value = '';
      this.searchQuery = '';
      this.filterTabs();
    });

    // Position settings
    document.querySelectorAll('.position-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const position = e.currentTarget.dataset.position;
        this.setPosition(position);
      });
    });

    // Footer actions
    document.getElementById('new-tab-btn').addEventListener('click', () => {
      this.createNewTab();
    });

    document.getElementById('new-window-btn').addEventListener('click', () => {
      this.createNewWindow();
    });

    // Listen for tab updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'tabsUpdated') {
        this.refreshTabs();
      }
    });
  }

  // Load user settings
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get({
        sidebarPosition: 'left',
        autoRefresh: true,
        showDuplicates: true
      });
      
      this.currentPosition = result.sidebarPosition;
      this.autoRefresh = result.autoRefresh;
      this.showDuplicates = result.showDuplicates;
      
      console.log('📖 Settings loaded:', result);
    } catch (error) {
      console.error('❌ Error loading settings:', error);
    }
  }

  // Save user settings
  async saveSettings() {
    try {
      await chrome.storage.sync.set({
        sidebarPosition: this.currentPosition,
        autoRefresh: this.autoRefresh,
        showDuplicates: this.showDuplicates
      });
      
      console.log('💾 Settings saved');
    } catch (error) {
      console.error('❌ Error saving settings:', error);
    }
  }

  // Refresh tabs data
  async refreshTabs() {
    try {
      this.showLoading(true);
      
      // Get all tabs
      const tabs = await chrome.tabs.query({});
      this.tabs = tabs;
      
      // Get all windows
      const windows = await chrome.windows.getAll();
      this.windows = windows;
      
      // Detect duplicates
      await this.detectDuplicates();
      
      // Update UI
      this.updateStats();
      this.renderTabs();
      
      this.showLoading(false);
      
      console.log(`🔄 Refreshed: ${tabs.length} tabs across ${windows.length} windows`);
    } catch (error) {
      console.error('❌ Error refreshing tabs:', error);
      this.showLoading(false);
    }
  }

  // Detect duplicate tabs
  async detectDuplicates() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'findDuplicates'
      });
      
      if (response.success) {
        this.duplicateGroups = new Map(
          response.data.groupsData.map(group => [group.url, group])
        );
      }
    } catch (error) {
      console.error('❌ Error detecting duplicates:', error);
    }
  }

  // Update statistics
  updateStats() {
    const totalTabs = this.tabs.length;
    let duplicateCount = 0;
    
    this.duplicateGroups.forEach(group => {
      duplicateCount += group.count - 1; // -1 because we keep one
    });
    
    document.getElementById('total-tabs').textContent = totalTabs;
    document.getElementById('duplicate-tabs').textContent = duplicateCount;
  }

  // Render tabs in the sidebar
  renderTabs() {
    const container = document.getElementById('windows-container');
    container.innerHTML = '';
    
    if (this.tabs.length === 0) {
      this.showEmptyState();
      return;
    }
    
    // Group tabs by window
    const windowGroups = new Map();
    this.tabs.forEach(tab => {
      if (!windowGroups.has(tab.windowId)) {
        windowGroups.set(tab.windowId, []);
      }
      windowGroups.get(tab.windowId).push(tab);
    });
    
    // Render each window group
    windowGroups.forEach((tabs, windowId) => {
      const windowElement = this.createWindowGroup(windowId, tabs);
      container.appendChild(windowElement);
    });
    
    // Apply search filter if active
    if (this.searchQuery) {
      this.filterTabs();
    }
  }

  // Create window group element
  createWindowGroup(windowId, tabs) {
    const windowDiv = document.createElement('div');
    windowDiv.className = 'window-group';
    windowDiv.dataset.windowId = windowId;
    
    // Find window info
    const window = this.windows.find(w => w.id === windowId);
    const isCurrentWindow = window && window.focused;
    
    windowDiv.innerHTML = `
      <div class="window-header" data-window-id="${windowId}">
        <div class="window-title">
          <span class="window-icon">${isCurrentWindow ? '🔸' : '🔹'}</span>
          <span>Window ${windowId} (${tabs.length} tabs)</span>
        </div>
        <div class="window-actions">
          <button class="window-action" data-action="minimize" title="Minimize window">
            ➖
          </button>
          <button class="window-action" data-action="close" title="Close window">
            ✕
          </button>
        </div>
      </div>
      <div class="window-tabs">
        ${tabs.map(tab => this.createTabElement(tab)).join('')}
      </div>
    `;
    
    // Bind window actions
    windowDiv.querySelector('.window-header').addEventListener('click', (e) => {
      if (e.target.classList.contains('window-action')) {
        const action = e.target.dataset.action;
        this.handleWindowAction(windowId, action);
      } else {
        this.focusWindow(windowId);
      }
    });
    
    return windowDiv;
  }

  // Create individual tab element
  createTabElement(tab) {
    const isDuplicate = this.isTabDuplicate(tab);
    const isActive = tab.active;
    const favicon = tab.favIconUrl || this.getDefaultFavicon();
    
    return `
      <div class="tab-item ${isActive ? 'active' : ''} ${isDuplicate ? 'duplicate' : ''}" 
           data-tab-id="${tab.id}">
        <img class="tab-favicon" src="${favicon}" 
             onerror="this.src='${this.getDefaultFavicon()}'">
        <div class="tab-info">
          <div class="tab-title">${this.escapeHtml(tab.title || 'Loading...')}</div>
          <div class="tab-url">${this.escapeHtml(this.getDomain(tab.url) || tab.url)}</div>
        </div>
        <div class="tab-actions">
          <button class="tab-action pin" title="Pin tab">📌</button>
          <button class="tab-action duplicate" title="Duplicate tab">📋</button>
          <button class="tab-action close" title="Close tab">✕</button>
        </div>
      </div>
    `;
  }

  // Handle tab interactions
  handleTabClick(tabId, action) {
    switch (action) {
      case 'activate':
        this.activateTab(tabId);
        break;
      case 'pin':
        this.pinTab(tabId);
        break;
      case 'duplicate':
        this.duplicateTab(tabId);
        break;
      case 'close':
        this.closeTab(tabId);
        break;
    }
  }

  // Tab actions
  async activateTab(tabId) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      console.log(`✅ Activated tab: ${tabId}`);
    } catch (error) {
      console.error('❌ Error activating tab:', error);
    }
  }

  async pinTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { pinned: !tab.pinned });
      await this.refreshTabs();
    } catch (error) {
      console.error('❌ Error pinning tab:', error);
    }
  }

  async duplicateTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.create({
        url: tab.url,
        windowId: tab.windowId,
        index: tab.index + 1
      });
      await this.refreshTabs();
    } catch (error) {
      console.error('❌ Error duplicating tab:', error);
    }
  }

  async closeTab(tabId) {
    try {
      await chrome.tabs.remove(tabId);
      await this.refreshTabs();
    } catch (error) {
      console.error('❌ Error closing tab:', error);
    }
  }

  // Window actions
  async handleWindowAction(windowId, action) {
    try {
      switch (action) {
        case 'minimize':
          await chrome.windows.update(windowId, { state: 'minimized' });
          break;
        case 'close':
          await chrome.windows.remove(windowId);
          await this.refreshTabs();
          break;
      }
    } catch (error) {
      console.error('❌ Error handling window action:', error);
    }
  }

  async focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      console.error('❌ Error focusing window:', error);
    }
  }

  // Close duplicate tabs
  async closeDuplicates() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'closeAllDuplicates'
      });
      
      if (response.success) {
        console.log(`✅ Closed ${response.closedCount} duplicate tabs`);
        await this.refreshTabs();
      }
    } catch (error) {
      console.error('❌ Error closing duplicates:', error);
    }
  }

  // Close all tabs except current
  async closeOtherTabs() {
    try {
      const currentTab = this.tabs.find(tab => tab.active);
      if (!currentTab) return;
      
      const otherTabs = this.tabs.filter(tab => 
        tab.windowId === currentTab.windowId && 
        tab.id !== currentTab.id && 
        !tab.pinned
      );
      
      for (const tab of otherTabs) {
        await chrome.tabs.remove(tab.id);
      }
      
      await this.refreshTabs();
      console.log(`✅ Closed ${otherTabs.length} other tabs`);
    } catch (error) {
      console.error('❌ Error closing other tabs:', error);
    }
  }

  // Create new tab
  async createNewTab() {
    try {
      await chrome.tabs.create({});
      await this.refreshTabs();
    } catch (error) {
      console.error('❌ Error creating new tab:', error);
    }
  }

  // Create new window
  async createNewWindow() {
    try {
      await chrome.windows.create({});
      await this.refreshTabs();
    } catch (error) {
      console.error('❌ Error creating new window:', error);
    }
  }

  // Position management
  togglePositionSettings() {
    const settings = document.getElementById('position-settings');
    settings.classList.toggle('hidden');
    
    // Update active position
    document.querySelectorAll('.position-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.position === this.currentPosition);
    });
  }

  async setPosition(position) {
    this.currentPosition = position;
    await this.saveSettings();
    this.applyPosition();
    this.togglePositionSettings();
    
    console.log(`📍 Sidebar position set to: ${position}`);
  }

  applyPosition() {
    document.body.className = `position-${this.currentPosition}`;
    
    // Update sidebar dimensions based on position
    const container = document.querySelector('.sidebar-container');
    
    switch (this.currentPosition) {
      case 'left':
      case 'right':
        container.style.flexDirection = 'column';
        container.style.height = '100vh';
        container.style.width = 'auto';
        break;
      case 'top':
      case 'bottom':
        container.style.flexDirection = 'row';
        container.style.height = 'auto';
        container.style.width = '100vw';
        break;
    }
  }

  // Search and filter
  filterTabs() {
    const tabItems = document.querySelectorAll('.tab-item');
    const windowGroups = document.querySelectorAll('.window-group');
    
    if (!this.searchQuery) {
      // Show all tabs
      tabItems.forEach(item => item.style.display = 'flex');
      windowGroups.forEach(group => group.style.display = 'block');
      return;
    }
    
    // Filter tabs
    windowGroups.forEach(windowGroup => {
      const tabs = windowGroup.querySelectorAll('.tab-item');
      let hasVisibleTabs = false;
      
      tabs.forEach(tabItem => {
        const title = tabItem.querySelector('.tab-title').textContent.toLowerCase();
        const url = tabItem.querySelector('.tab-url').textContent.toLowerCase();
        const matches = title.includes(this.searchQuery) || url.includes(this.searchQuery);
        
        tabItem.style.display = matches ? 'flex' : 'none';
        if (matches) hasVisibleTabs = true;
      });
      
      windowGroup.style.display = hasVisibleTabs ? 'block' : 'none';
    });
  }

  // Utility functions
  isTabDuplicate(tab) {
    for (const [url, group] of this.duplicateGroups) {
      if (group.tabs.some(t => t.id === tab.id)) {
        return group.count > 1;
      }
    }
    return false;
  }

  getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  getDefaultFavicon() {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23718096" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showLoading(show) {
    document.getElementById('loading-state').classList.toggle('hidden', !show);
    document.getElementById('windows-container').classList.toggle('hidden', show);
  }

  showEmptyState() {
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('windows-container').classList.add('hidden');
  }

  openSettings() {
    // Future enhancement: Open settings page
    console.log('⚙️ Settings clicked - future enhancement');
  }

  startPeriodicRefresh() {
    if (this.autoRefresh) {
      setInterval(() => {
        this.refreshTabs();
      }, 5000); // Refresh every 5 seconds
    }
  }
}

// Event delegation for dynamic elements
document.addEventListener('click', (e) => {
  const tabItem = e.target.closest('.tab-item');
  if (tabItem) {
    const tabId = parseInt(tabItem.dataset.tabId);
    
    if (e.target.classList.contains('tab-action')) {
      const action = e.target.classList.contains('close') ? 'close' :
                     e.target.classList.contains('pin') ? 'pin' :
                     e.target.classList.contains('duplicate') ? 'duplicate' : null;
      
      if (action && window.tabManager) {
        window.tabManager.handleTabClick(tabId, action);
      }
    } else {
      // Click on tab item itself - activate tab
      if (window.tabManager) {
        window.tabManager.handleTabClick(tabId, 'activate');
      }
    }
  }
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.tabManager = new VerticalTabManager();
  console.log('🚀 Sidebar initialized');
});

// Search Popup Content Script
class AmplifySearchPopup {
  constructor() {
    this.overlay = null;
    this.searchInput = null;
    this.resultsContainer = null;
    this.allItems = [];
    this.filteredItems = [];
    this.selectedIndex = 0;
    this.isOpen = false;
  }

  async initialize() {
    // Listen for keyboard command
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'toggleSearch') {
        this.toggle();
      }
    });

    // Also listen for direct keyboard shortcut (fallback)
    document.addEventListener('keydown', (e) => {
      // CMD+K on Mac, Ctrl+K on Windows/Linux
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  async toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      await this.open();
    }
  }

  async open() {
    if (this.isOpen) return;

    this.isOpen = true;
    await this.loadData();
    this.render();
    this.searchInput.focus();
  }

  close() {
    if (!this.isOpen) return;

    this.isOpen = false;
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.searchInput = null;
    this.resultsContainer = null;
  }

  async loadData() {
    try {
      // Load all tabs
      const tabs = await chrome.runtime.sendMessage({ action: 'getTabs' });
      
      // Load all bookmarks
      const bookmarks = await chrome.runtime.sendMessage({ action: 'getBookmarks' });

      // Combine and format items
      this.allItems = [
        ...(tabs || []).map(tab => ({
          type: 'tab',
          id: tab.id,
          title: tab.title || 'Untitled',
          url: tab.url,
          favicon: tab.favIconUrl || this.getDefaultFavicon(tab.url)
        })),
        ...(bookmarks || []).map(bookmark => ({
          type: 'bookmark',
          id: bookmark.id,
          title: bookmark.title || 'Untitled',
          url: bookmark.url,
          favicon: this.getDefaultFavicon(bookmark.url)
        }))
      ];

      this.filteredItems = [...this.allItems];
    } catch (error) {
      console.error('Error loading data:', error);
      this.allItems = [];
      this.filteredItems = [];
    }
  }

  getDefaultFavicon(url) {
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    } catch {
      return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
    }
  }

  render() {
    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'amplify-search-overlay';
    
    // Create container
    const container = document.createElement('div');
    container.className = 'amplify-search-container';

    // Create search input section
    const inputContainer = document.createElement('div');
    inputContainer.className = 'amplify-search-input-container';
    inputContainer.innerHTML = `
      <svg class="amplify-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
      </svg>
      <input type="text" class="amplify-search-input" placeholder="Search tabs and bookmarks..." autocomplete="off" spellcheck="false">
    `;

    // Create results container
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'amplify-search-results';

    // Create footer
    const footer = document.createElement('div');
    footer.className = 'amplify-search-footer';
    footer.innerHTML = `
      <div class="amplify-search-hints">
        <div class="amplify-search-hint">
          <span class="amplify-search-key">↑↓</span>
          <span>Navigate</span>
        </div>
        <div class="amplify-search-hint">
          <span class="amplify-search-key">↵</span>
          <span>Open</span>
        </div>
        <div class="amplify-search-hint">
          <span class="amplify-search-key">Esc</span>
          <span>Close</span>
        </div>
      </div>
    `;

    // Assemble
    container.appendChild(inputContainer);
    container.appendChild(this.resultsContainer);
    container.appendChild(footer);
    this.overlay.appendChild(container);
    document.body.appendChild(this.overlay);

    // Get references
    this.searchInput = inputContainer.querySelector('.amplify-search-input');

    // Render initial results
    this.renderResults();

    // Event listeners
    this.searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    container.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  handleSearch(query) {
    query = query.toLowerCase().trim();

    if (!query) {
      this.filteredItems = [...this.allItems];
    } else {
      this.filteredItems = this.allItems.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(query);
        const urlMatch = item.url.toLowerCase().includes(query);
        return titleMatch || urlMatch;
      });
    }

    this.selectedIndex = 0;
    this.renderResults();
  }

  renderResults() {
    if (this.filteredItems.length === 0) {
      this.resultsContainer.innerHTML = `
        <div class="amplify-search-empty">
          <svg class="amplify-search-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div class="amplify-search-empty-text">No results found</div>
        </div>
      `;
      return;
    }

    this.resultsContainer.innerHTML = '';
    
    this.filteredItems.forEach((item, index) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'amplify-search-result-item';
      if (index === this.selectedIndex) {
        resultItem.classList.add('selected');
      }

      resultItem.innerHTML = `
        <img class="amplify-result-favicon" src="${item.favicon}" onerror="this.src='data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;%236b7280&quot; stroke-width=&quot;2&quot;><path d=&quot;M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5&quot;/></svg>'">
        <div class="amplify-result-content">
          <div class="amplify-result-title">${this.escapeHtml(item.title)}</div>
          <div class="amplify-result-url">${this.escapeHtml(item.url)}</div>
        </div>
        <span class="amplify-result-badge ${item.type}">${item.type === 'tab' ? 'Tab' : 'Bookmark'}</span>
      `;

      resultItem.addEventListener('click', () => {
        this.openItem(item);
      });

      resultItem.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      this.resultsContainer.appendChild(resultItem);
    });
  }

  handleKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
        this.updateSelection();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateSelection();
        break;

      case 'Enter':
        e.preventDefault();
        if (this.filteredItems[this.selectedIndex]) {
          this.openItem(this.filteredItems[this.selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        this.close();
        break;
    }
  }

  updateSelection() {
    const items = this.resultsContainer.querySelectorAll('.amplify-search-result-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  async openItem(item) {
    try {
      if (item.type === 'tab') {
        // Switch to existing tab
        await chrome.runtime.sendMessage({
          action: 'switchToTab',
          tabId: item.id
        });
      } else {
        // Open bookmark in new tab
        await chrome.runtime.sendMessage({
          action: 'openUrl',
          url: item.url
        });
      }
      this.close();
    } catch (error) {
      console.error('Error opening item:', error);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the search popup
const searchPopup = new AmplifySearchPopup();
searchPopup.initialize();


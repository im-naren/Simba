// Popup script for nTabManager Extension

class DuplicateTabUI {
  constructor() {
    this.currentData = null;
    this.init();
  }

  init() {
    // Bind event listeners
    this.bindEvents();
    
    // Start initial scan
    this.scanForDuplicates();
  }

  bindEvents() {
    // Primary action buttons
    document.getElementById('close-all').addEventListener('click', () => {
      this.closeAllDuplicates();
    });

    document.getElementById('refresh-scan').addEventListener('click', () => {
      this.scanForDuplicates();
    });

    document.getElementById('scan-again').addEventListener('click', () => {
      this.scanForDuplicates();
    });

    document.getElementById('retry-scan').addEventListener('click', () => {
      this.scanForDuplicates();
    });

    document.getElementById('test-auto-detection').addEventListener('click', () => {
      this.testAutoDetection();
    });
  }

  // Show different UI states
  showState(state) {
    // Hide all states
    const states = ['loading', 'no-duplicates', 'duplicates-found', 'error-state'];
    states.forEach(stateId => {
      document.getElementById(stateId).classList.add('hidden');
    });

    // Show the requested state
    const element = document.getElementById(state);
    if (element) {
      element.classList.remove('hidden');
      element.classList.add('fade-in');
    }
  }

  // Scan for duplicate tabs
  async scanForDuplicates() {
    try {
      this.showState('loading');

      const response = await chrome.runtime.sendMessage({
        action: 'findDuplicates'
      });

      if (response.success) {
        this.currentData = response.data;
        
        if (response.data.totalDuplicates === 0) {
          this.showNoDuplicates();
        } else {
          this.showDuplicatesFound(response.data);
        }
      } else {
        this.showError(response.error || 'Failed to scan for duplicates');
      }
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      this.showError('Unable to communicate with extension');
    }
  }

  // Show no duplicates state
  showNoDuplicates() {
    this.showState('no-duplicates');
  }

  // Show duplicates found state
  showDuplicatesFound(data) {
    // Update stats
    document.getElementById('duplicate-count').textContent = data.totalDuplicates;
    document.getElementById('group-count').textContent = data.duplicateGroups;

    // Render duplicate groups
    this.renderDuplicateGroups(data.groupsData);

    this.showState('duplicates-found');
  }

  // Render duplicate groups in the UI
  renderDuplicateGroups(groupsData) {
    const container = document.getElementById('duplicate-groups');
    container.innerHTML = '';

    groupsData.forEach((group, index) => {
      const groupElement = this.createGroupElement(group, index);
      container.appendChild(groupElement);
    });
  }

  // Create a single group element
  createGroupElement(group, index) {
    const div = document.createElement('div');
    div.className = 'duplicate-group';
    
    // Get the first tab for display info
    const firstTab = group.tabs[0];
    const domain = this.extractDomain(group.url);
    
    div.innerHTML = `
      <div class="group-header">
        <div class="group-info">
          <img class="group-favicon" src="${firstTab.favIconUrl || this.getDefaultFavicon()}" 
               onerror="this.src='${this.getDefaultFavicon()}'">
          <div>
            <div class="group-title">${firstTab.title || domain}</div>
            <div class="group-url">${domain}</div>
          </div>
        </div>
        <div class="group-count">${group.count} tabs</div>
      </div>
      <div class="group-actions">
        <button class="btn btn-small btn-danger" data-url="${group.url}">
          🗑️ Close ${group.count - 1} duplicates
        </button>
      </div>
    `;

    // Add event listener for group-specific action
    const closeBtn = div.querySelector('[data-url]');
    closeBtn.addEventListener('click', (e) => {
      const url = e.target.getAttribute('data-url');
      this.closeSpecificDuplicates([url]);
    });

    return div;
  }

  // Extract domain from URL
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return url;
    }
  }

  // Get default favicon
  getDefaultFavicon() {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
  }

  // Close all duplicate tabs
  async closeAllDuplicates() {
    try {
      // Disable button during operation
      const btn = document.getElementById('close-all');
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳ Closing...';

      const response = await chrome.runtime.sendMessage({
        action: 'closeAllDuplicates'
      });

      if (response.success) {
        // Show success message briefly, then rescan
        btn.innerHTML = `✅ Closed ${response.closedCount} tabs`;
        
        setTimeout(() => {
          this.scanForDuplicates();
        }, 1000);
      } else {
        throw new Error(response.error || 'Failed to close duplicates');
      }
    } catch (error) {
      console.error('Error closing duplicates:', error);
      this.showError('Failed to close duplicate tabs');
      
      // Reset button
      const btn = document.getElementById('close-all');
      btn.disabled = false;
      btn.innerHTML = '🧹 Close All Duplicates';
    }
  }

  // Close specific duplicate tabs
  async closeSpecificDuplicates(urls) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'closeSpecificDuplicates',
        urls: urls
      });

      if (response.success) {
        // Rescan to update UI
        setTimeout(() => {
          this.scanForDuplicates();
        }, 500);
      } else {
        throw new Error(response.error || 'Failed to close specific duplicates');
      }
    } catch (error) {
      console.error('Error closing specific duplicates:', error);
      this.showError('Failed to close duplicate tabs');
    }
  }

  // Test auto-detection manually
  async testAutoDetection() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testAutoDetection'
      });
      
      if (response.success) {
        alert(`Auto-detection test: Found ${response.totalTabs} tabs, ${response.duplicatesFound} duplicates detected`);
      } else {
        alert('Auto-detection test failed: ' + response.error);
      }
    } catch (error) {
      alert('Error testing auto-detection: ' + error.message);
    }
  }



  // Show error state
  showError(message) {
    document.getElementById('error-message').textContent = message;
    this.showState('error-state');
  }
}

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new DuplicateTabUI();
}); 
// nTabManager New Tab Page JavaScript

class NewTabManager {
  constructor() {
    this.currentDate = new Date();
    this.init();
  }

  init() {
    this.isCalendarConnected = false;
    
    this.setupEventListeners();
    this.loadGoogleWorkspaceData();
    this.loadRecentTabs();
    this.checkCalendarConnection();
    
    // Refresh calendar events every 10 minutes (only if connected)
    setInterval(() => {
      if (this.isCalendarConnected) {
        this.loadTodaysEvents();
      }
    }, 10 * 60 * 1000);
  }

  // Load recent tabs (dummy data for now)
  loadRecentTabs() {
    const recentTabs = [
      { title: 'Datalake onboarding for bank faci...', url: 'mail.go...', info: 'You visited 3 days ago', favicon: '📧' },
      { title: 'Razorpay - Calendar - Week of A...', url: 'calendar.goo...', info: 'You visit often', favicon: '📅' },
      { title: 'DE: Bandwidth in support and un...', url: 'docs.google...', info: 'You visit often', favicon: '📝' },
      { title: 'DevRev', url: 'app.devrev.ai', info: 'You visit often', favicon: '⚡' }
    ];

    const container = document.getElementById('recent-tabs');
    container.innerHTML = '';

    recentTabs.forEach(tab => {
      const tabElement = document.createElement('a');
      tabElement.className = 'tab-item';
      tabElement.href = tab.url;
      tabElement.target = '_blank';
      
      tabElement.innerHTML = `
        <div class="tab-favicon">${tab.favicon}</div>
        <div class="tab-details">
          <div class="tab-title">${tab.title}</div>
          <div class="tab-info">${tab.info}</div>
        </div>
      `;
      
      container.appendChild(tabElement);
    });
  }

  // Set up event listeners
  setupEventListeners() {
    // Search functionality
    document.getElementById('search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });

    document.getElementById('search-btn').addEventListener('click', () => {
      this.performSearch();
    });

    // Calendar connection
    document.getElementById('connect-calendar-btn').addEventListener('click', async () => {
      await this.connectGoogleCalendar();
    });

    // Restore default tab functionality
    document.getElementById('restore-default-btn').addEventListener('click', () => {
      this.showRestoreModal();
    });

    document.getElementById('close-restore-modal').addEventListener('click', () => {
      this.hideRestoreModal();
    });

    document.getElementById('open-extensions-page').addEventListener('click', () => {
      this.openExtensionsPage();
    });

    // Close modal when clicking outside
    document.getElementById('restore-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.hideRestoreModal();
      }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideRestoreModal();
      }
    });
  }

  // Initialize today's date display
  initializeTodaysDate() {
    const today = new Date();
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    const dateString = today.toLocaleDateString('en-US', options);
    
    const todayElement = document.getElementById('today-date-simple');
    if (todayElement) {
      todayElement.textContent = dateString;
    }
  }

  // Check if calendar is already connected
  async checkCalendarConnection() {
    try {
      // First try to get token non-interactively (using existing browser login)
      const token = await this.getGoogleAuthToken(['https://www.googleapis.com/auth/calendar.readonly'], false);
      
      if (token) {
        this.isCalendarConnected = true;
        this.showEventsSection();
        this.loadTodaysEvents();
        // Save that we're connected
        await chrome.storage.local.set({ googleCalendarConnected: true });
      } else {
        this.showCalendarAuthPrompt();
      }
    } catch (error) {
      console.error('Error checking calendar connection:', error);
      this.showCalendarAuthPrompt();
    }
  }

  // Connect to Google Calendar
  async connectGoogleCalendar() {
    const connectBtn = document.getElementById('connect-calendar-btn');
    if (connectBtn) {
      connectBtn.textContent = '🔄 Connecting...';
      connectBtn.disabled = true;
    }

    try {
      // First try to use existing Google session (since Gmail is logged in)
      console.log('🔑 Attempting to use existing Google session...');
      
      const token = await this.tryExistingGoogleAuth();
      if (token) {
        console.log('✅ Successfully connected using existing Google session!');
        this.isCalendarConnected = true;
        await chrome.storage.local.set({ googleCalendarConnected: true });
        this.showEventsSection();
        this.loadTodaysEvents();
        return;
      }
      
      // If that fails, show setup instructions
      console.log('⚠️ No existing session found, showing setup instructions...');
      this.showGoogleCalendarSetup();
      
    } catch (error) {
      console.error('❌ Error connecting to Google Calendar:', error);
      this.showGoogleCalendarSetup();
    } finally {
      if (connectBtn) {
        connectBtn.textContent = '🔗 Connect Google Calendar';
        connectBtn.disabled = false;
      }
    }
  }

  // Try to authenticate using existing Google session
  async tryExistingGoogleAuth() {
    return new Promise((resolve) => {
      // Try to get token without interactive prompt first
      chrome.identity.getAuthToken({ 
        interactive: false,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      }, (token) => {
        if (chrome.runtime.lastError) {
          console.log('No existing auth token found:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        
        if (token) {
          console.log('✅ Found existing auth token!');
          resolve(token);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Disconnect from Google Calendar
  async disconnectCalendar() {
    try {
      await chrome.storage.local.remove(['googleCalendarConnected']);
      this.isCalendarConnected = false;
      this.showCalendarConnectionPrompt();
      
      // Clear any cached tokens
      if (chrome.identity && chrome.identity.removeCachedAuthToken) {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (token) {
            chrome.identity.removeCachedAuthToken({ token }, () => {
              console.log('Cached token removed');
            });
          }
        });
      }
    } catch (error) {
      console.error('Error disconnecting calendar:', error);
    }
  }

  // Show calendar connection prompt
  showCalendarConnectionPrompt() {
    const calendarStatus = document.getElementById('calendar-status');
    const eventsSection = document.getElementById('events-section');
    
    if (calendarStatus) {
      calendarStatus.style.display = 'block';
    }
    if (eventsSection) {
      eventsSection.style.display = 'none';
    }
  }

  // Show events section (hide connection prompt)
  showEventsSection() {
    const calendarStatus = document.getElementById('calendar-status');
    const eventsSection = document.getElementById('events-section');
    
    if (calendarStatus) {
      calendarStatus.style.display = 'none';
    }
    if (eventsSection) {
      eventsSection.style.display = 'block';
    }
  }

  // Show Google Calendar setup instructions
  showGoogleCalendarSetup() {
    const calendarStatus = document.getElementById('calendar-status');
    if (!calendarStatus) return;

    calendarStatus.innerHTML = `
      <div class="setup-instructions">
        <div class="status-icon">⚙️</div>
        <h3>Google Calendar Setup Required</h3>
        <p>To show your calendar events, we need to set up Google API access.</p>
        
        <div class="setup-steps">
          <h4>📋 Quick Setup (5 minutes):</h4>
          <ol>
            <li><strong>Go to</strong> <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a></li>
            <li><strong>Create new project</strong> or select existing one</li>
            <li><strong>Enable</strong> "Google Calendar API"</li>
            <li><strong>Create credentials</strong> → "OAuth client ID" → "Chrome extension"</li>
            <li><strong>Copy your Client ID</strong> and update manifest.json</li>
          </ol>
        </div>

        <div class="setup-buttons">
          <button id="open-setup-guide" class="setup-btn primary">
            📖 Detailed Setup Guide
          </button>
          <button id="try-again-btn" class="setup-btn secondary">
            🔄 Try Again
          </button>
        </div>

        <div class="setup-alternative">
          <p><strong>💡 Alternative:</strong> You can also use this extension without calendar integration - it will still manage duplicate tabs perfectly!</p>
        </div>
      </div>
    `;

    // Add event listeners
    document.getElementById('open-setup-guide').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('GOOGLE_CALENDAR_SETUP.md') });
    });

    document.getElementById('try-again-btn').addEventListener('click', () => {
      this.connectGoogleCalendar();
    });
  }

  // (Removed) monthly calendar rendering/navigation – we only show today's meetings

  // Load Google Workspace data from browser history
  async loadGoogleWorkspaceData() {
    try {
      // Search browser history for Google Workspace files
      const searchQueries = [
        'docs.google.com/document',
        'docs.google.com/spreadsheets', 
        'docs.google.com/presentation'
      ];

      const allFiles = [];
      
      for (const query of searchQueries) {
        const results = await chrome.history.search({
          text: query,
          maxResults: 50,
          startTime: Date.now() - (30 * 24 * 60 * 60 * 1000) // Last 30 days
        });

        results.forEach(item => {
          let type = 'doc';
          if (item.url.includes('/spreadsheets/')) type = 'sheet';
          else if (item.url.includes('/presentation/')) type = 'slide';

          // Extract document title from URL or use the page title
          let title = item.title || 'Untitled Document';
          
          // Remove common Google Docs suffixes
          title = title.replace(/ - Google (Docs|Sheets|Slides)$/, '');
          
          // Format last visit time
          const lastVisit = new Date(item.lastVisitTime);
          const now = new Date();
          const diffHours = Math.floor((now - lastVisit) / (1000 * 60 * 60));
          
          let dateText = 'You visited';
          if (diffHours < 1) dateText += ' just now';
          else if (diffHours < 24) dateText += ` ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
          else {
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays === 1) dateText += ' yesterday';
            else if (diffDays < 7) dateText += ` ${diffDays} days ago`;
            else dateText += ' in the past week';
          }

          allFiles.push({
            title,
            date: dateText,
            url: item.url,
            type,
            lastVisitTime: item.lastVisitTime,
            visitCount: item.visitCount || 1
          });
        });
      }

      // Sort by last visit time (most recent first)
      allFiles.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

      if (allFiles.length === 0) {
        // Fallback to mock data if no history found
        const mockFiles = [
          { title: 'No recent Google Workspace files found', date: 'Visit some Docs, Sheets, or Slides', url: '#', type: 'doc' }
        ];
        this.renderDriveFiles(mockFiles);
      } else {
        this.renderDriveFiles(allFiles);
      }
      
    } catch (error) {
      console.error('Error loading Google Workspace data from history:', error);
      
      // Fallback to mock data
      const mockFiles = [
        { title: 'Error loading recent files', date: 'Check extension permissions', url: '#', type: 'doc' }
      ];
      this.renderDriveFiles(mockFiles);
    }
  }

  // Render drive files in single list
  renderDriveFiles(files) {
    const container = document.getElementById('drive-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Take first 6 files and render them
    const filesToShow = files.slice(0, 6);
    
    filesToShow.forEach(file => {
      const fileElement = document.createElement('a');
      fileElement.className = 'drive-item';
      fileElement.href = file.url;
      fileElement.target = '_blank';
      
      // Determine icon type based on file type
      let iconClass = 'doc';
      if (file.type === 'sheet' || file.mimeType?.includes('spreadsheet')) {
        iconClass = 'sheet';
      } else if (file.type === 'slide' || file.mimeType?.includes('presentation')) {
        iconClass = 'slide';
      }
      
      fileElement.innerHTML = `
        <div class="drive-icon ${iconClass}"></div>
        <div class="drive-details">
          <div class="drive-name">${file.title}</div>
          <div class="drive-info">${file.date}</div>
        </div>
      `;
      
      container.appendChild(fileElement);
    });
  }

  // Open tab manager
  openTabManager() {
    // Open the extension popup or a dedicated tab manager page
    chrome.runtime.sendMessage({ action: 'openTabManager' });
  }

  // Update duplicate count
  async updateDuplicateCount() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'findDuplicates' });
      if (response && response.success) {
        const count = response.data.totalDuplicates;
        const countElement = document.getElementById('duplicate-count');
        if (count > 0) {
          countElement.textContent = `${count} duplicates found`;
          countElement.style.color = '#ff6b6b';
        } else {
          countElement.textContent = 'No duplicates';
          countElement.style.color = 'rgba(255, 255, 255, 0.7)';
        }
      }
    } catch (error) {
      console.error('Error updating duplicate count:', error);
    }
  }

  // Perform search
  performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;
    
    // Check if it's a URL
    if (query.includes('.') && !query.includes(' ')) {
      // Treat as URL
      const url = query.startsWith('http') ? query : `https://${query}`;
      window.open(url, '_blank');
    } else {
      // Treat as search query
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      window.open(searchUrl, '_blank');
    }
    
    // Clear the search input
    document.getElementById('search-input').value = '';
  }

  // Load today's calendar events from Google Calendar
  async loadTodaysEvents() {
    try {
      console.log('🔄 Loading today\'s calendar events...');
      
      // Try to get authentication token
      let token;
      try {
        token = await this.getGoogleAuthToken();
      } catch (error) {
        console.error('❌ Authentication setup error:', error.message);
        if (error.message.includes('OAuth client_id not configured')) {
          this.showGoogleCalendarSetup();
        } else {
          this.showCalendarError('Authentication failed: ' + error.message);
        }
        return;
      }
      
      if (!token) {
        console.log('❌ No authentication token available - need setup');
        this.showGoogleCalendarSetup();
        return;
      }

      // Fetch today's events
      const events = await this.fetchTodaysCalendarEvents(token);
      
      if (events && events.length > 0) {
        console.log(`✅ Loaded ${events.length} calendar events`);
        this.renderCalendarEvents(events);
      } else {
        console.log('📅 No events found for today');
        this.showNoEventsMessage();
      }
      
    } catch (error) {
      console.error('❌ Error loading calendar events:', error);
      this.showCalendarError(error.message);
    }
  }

  // Get Google authentication token (improved version)
  async getGoogleAuthToken() {
    return new Promise((resolve, reject) => {
      // First try non-interactive (using existing Gmail login)
      chrome.identity.getAuthToken({ 
        interactive: false,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly']
      }, (token) => {
        if (token) {
          console.log('✅ Got token from existing session');
          resolve(token);
          return;
        }
        
        if (chrome.runtime.lastError) {
          console.log('⚠️ No existing auth session:', chrome.runtime.lastError.message);
          
          // Check if it's a client_id configuration issue
          if (chrome.runtime.lastError.message.includes('CLIENT_ID') || 
              chrome.runtime.lastError.message.includes('oauth2') ||
              chrome.runtime.lastError.message.includes('invalid_client')) {
            reject(new Error('OAuth client_id not configured. Please set up Google Cloud Console.'));
            return;
          }
        }
        
        resolve(null); // No token available, but not an error
      });
    });
  }

  // Authenticate with Google (interactive)
  async authenticateWithGoogle() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ 
        interactive: true  // Show login popup
      }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
  }

  // Fetch today's calendar events from Google Calendar API
  async fetchTodaysCalendarEvents(token) {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    const timeMin = startOfDay.toISOString();
    const timeMax = endOfDay.toISOString();
    
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Calendar API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.items || [];
  }

  // Extract meeting links from event
  extractMeetingLinks(event) {
    const links = [];
    
    // Check for Google Meet link
    if (event.hangoutLink) {
      links.push({
        type: 'google-meet',
        url: event.hangoutLink,
        platform: 'Google Meet'
      });
    }
    
    // Check description and location for meeting links
    const textToSearch = `${event.description || ''} ${event.location || ''}`;
    
    // Zoom links
    const zoomMatch = textToSearch.match(/https:\/\/[^.\s]*\.?zoom\.us\/[^\s]*/gi);
    if (zoomMatch) {
      zoomMatch.forEach(url => {
        links.push({
          type: 'zoom',
          url: url,
          platform: 'Zoom'
        });
      });
    }
    
    // Microsoft Teams links
    const teamsMatch = textToSearch.match(/https:\/\/teams\.microsoft\.com\/[^\s]*/gi);
    if (teamsMatch) {
      teamsMatch.forEach(url => {
        links.push({
          type: 'teams',
          url: url,
          platform: 'Microsoft Teams'
        });
      });
    }
    
    // WebEx links
    const webexMatch = textToSearch.match(/https:\/\/[^.\s]*\.?webex\.com\/[^\s]*/gi);
    if (webexMatch) {
      webexMatch.forEach(url => {
        links.push({
          type: 'webex',
          url: url,
          platform: 'WebEx'
        });
      });
    }
    
    return links;
  }

  // Format event time
  formatEventTime(event) {
    let startTime, endTime;
    
    if (event.start.dateTime) {
      startTime = new Date(event.start.dateTime);
      endTime = new Date(event.end.dateTime);
    } else {
      // All-day event
      return 'All day';
    }
    
    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    };
    
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  // Check if event is happening now
  isEventHappeningNow(event) {
    if (!event.start.dateTime || !event.end.dateTime) return false;
    
    const now = new Date();
    const startTime = new Date(event.start.dateTime);
    const endTime = new Date(event.end.dateTime);
    
    return now >= startTime && now <= endTime;
  }

  // Time until start helper for pill (e.g., "In 7 hr")
  timeUntil(event) {
    if (!event.start?.dateTime) return '';
    const now = Date.now();
    const start = new Date(event.start.dateTime).getTime();
    const diffMs = start - now;
    if (diffMs <= 0) return 'Now';
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `In ${mins} min`;
    const hrs = Math.round(mins / 60);
    return `In ${hrs} hr`;
  }

  // Render calendar events with join buttons
  renderCalendarEvents(events) {
    const eventsContainer = document.getElementById('events-list');
    eventsContainer.innerHTML = '';
    
    if (events.length === 0) {
      this.showNoEventsMessage();
      return;
    }
    
    events.forEach(event => {
      const card = document.createElement('div');
      card.className = 'event-card';

      const timeText = this.formatEventTime(event);
      const until = this.timeUntil(event);

      card.innerHTML = `
        <div class="event-time">${timeText.split(' - ')[0]}</div>
        <div class="event-title">${event.summary || 'Untitled Event'}</div>
        <div class="event-badge">${until}</div>
      `;

      eventsContainer.appendChild(card);
    });
    
    // Add event listeners for join buttons
    document.querySelectorAll('.join-meeting-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const meetingUrl = e.target.getAttribute('data-url');
        window.open(meetingUrl, '_blank');
      });
    });
  }

  // Show no events message
  showNoEventsMessage() {
    const eventsContainer = document.getElementById('events-list');
    eventsContainer.innerHTML = `
      <div class="no-events-message">
        <div class="no-events-icon">📅</div>
        <div class="no-events-text">No events scheduled for today</div>
        <div class="no-events-subtext">Enjoy your free time!</div>
      </div>
    `;
  }

  // Show calendar authentication prompt
  showCalendarAuthPrompt() {
    const statusContainer = document.getElementById('calendar-status');
    statusContainer.innerHTML = `
      <div class="calendar-connect">
        <span class="material-symbols-outlined calendar-icon">calendar_today</span>
        <button id="connect-calendar-btn" class="connect-btn">
          <span class="material-symbols-outlined">link</span>
          Connect Google Calendar
        </button>
      </div>
    `;
    
    document.getElementById('connect-calendar-btn').addEventListener('click', async () => {
      await this.connectGoogleCalendar();
    });
  }

  // Show calendar error
  showCalendarError(errorMessage) {
    const eventsContainer = document.getElementById('events-list');
    eventsContainer.innerHTML = `
      <div class="calendar-error">
        <div class="error-icon">⚠️</div>
        <div class="error-text">Calendar Error</div>
        <div class="error-subtext">${errorMessage}</div>
        <button id="retry-calendar-btn" class="retry-btn">
          🔄 Retry
        </button>
      </div>
    `;
    
    document.getElementById('retry-calendar-btn').addEventListener('click', () => {
      this.loadTodaysEvents();
    });
  }

  // Restore default tab modal methods
  showRestoreModal() {
    const modal = document.getElementById('restore-modal');
    modal.classList.add('show');
    
    // Prevent body scrolling when modal is open
    document.body.style.overflow = 'hidden';
  }

  hideRestoreModal() {
    const modal = document.getElementById('restore-modal');
    modal.classList.remove('show');
    
    // Restore body scrolling
    document.body.style.overflow = '';
  }

  openExtensionsPage() {
    // Open Chrome extensions page
    chrome.tabs.create({ url: 'chrome://extensions/' });
    this.hideRestoreModal();
  }
}

// Google Workspace Integration Guide
class GoogleWorkspaceIntegration {
  // To implement real Google Workspace integration, follow these steps:
  
  static setupGoogleAPI() {
    // 1. Add Google API permissions to manifest.json:
    /*
    "permissions": [
      "identity",
      "https://www.googleapis.com/auth/drive.readonly"
    ],
    "oauth2": {
      "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
      "scopes": [
        "https://www.googleapis.com/auth/drive.readonly"
      ]
    }
    */
  }
  
  static async authenticateWithGoogle() {
    // 2. Authenticate with Google Drive API:
    /*
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
    */
  }
  
  static async fetchRecentFiles(token, mimeType) {
    // 3. Fetch recent files by type:
    /*
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=mimeType='${mimeType}'&orderBy=viewedByMeTime desc&pageSize=5`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    return response.json();
    */
  }
}

// Initialize the new tab page
document.addEventListener('DOMContentLoaded', () => {
  new NewTabManager();
});

// Console message for developers
console.log(`
🚀 nTabManager New Tab Page Loaded!

📝 To integrate with real Google Workspace:
1. Set up Google Cloud Console project
2. Add OAuth2 credentials
3. Update manifest.json with permissions
4. Implement GoogleWorkspaceIntegration class methods

📅 To integrate with real calendar:
1. Use Google Calendar API
2. Add calendar permissions
3. Fetch today's events

🔗 Current features:
✅ Dynamic greeting & time
✅ Interactive calendar widget  
✅ Mock Google Workspace data
✅ Search functionality
✅ Tab manager integration
✅ Duplicate tab monitoring
`);

!function() {
    "use strict";
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    
    let scriptElement = document.currentScript;
    let siteId = scriptElement ? scriptElement.dataset.pid : "";
    
    const CONFIG = {
      API_BASE_URL: "http://localhost:7898/api/v1",
      USB_BROWSER_PID: "41e80bd880c0f29b3211b97606153e9bc4e57857c07201c6276fbd528dc30c0f",
      USB_BROWSER_URL: "https://a.usbrowserspeed.com/cs",
      
      // Storage keys
      VISITOR_ID_KEY: "viq_vid",
      SESSION_ID_KEY: "viq_sid",
      LAST_ACTIVITY_KEY: "viq_last_activity",
      PENDING_DATA_KEY: "viq_pending_data",
      REFERRER_KEY: "viq_referrer",
      
      // Timeouts
      SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
      VISITOR_EXPIRY: 365 * 24 * 60 * 60, // 1 year in seconds
      SESSION_EXPIRY: 30 * 60, // 30 minutes in seconds
      DATA_SEND_INTERVAL: 15000, // 15 seconds
      
      // Feature flags
      ENABLE_EMAIL_CAPTURE: true,
      ENABLE_HASH_COLLECTION: true,
      ENABLE_SCROLL_TRACKING: true,
      ENABLE_CLICK_TRACKING: true
    };
    
    // ============================================================================
    // VISITOR IQ CLASS
    // ============================================================================
    
    class VisitorIQ {
      constructor() {
        // Identity
        this.siteId = siteId;
        this.visitorId = null;
        this.sessionId = null;
        this.compositeId = null; // UUID + context for USB Browser
        
        // Session tracking
        this.sessionStartTime = null;
        this.activeDuration = 0;
        this.lastActivityTime = Date.now();
        
        // Storage
        this.hasLocalStorage = false;
        this.pendingData = [];
        
        // Collections
        this.emails = new Set();
        this.md5Hashes = new Set();
        this.sha256Hashes = new Set();
        this.pagesVisited = [];
        this.clickedElements = [];
        
        // Metrics
        this.deviceMetrics = {};
        this.scrollDepth = 0;
        this.maxScrollDepth = 0;
        this.entryPage = null;
        this.exitPage = null;
        this.lastClickedText = null;
        
        // Environment
        this.geoData = null;
        this.timeZone = null;
        this.locale = null;
        this.preferredLanguages = [];
        this.touchSupport = false;
        this.referrer = null;
        
        // State
        this.isInitialized = false;
        this.isBot = false;
      }
      
      // ========================================================================
      // INITIALIZATION
      // ========================================================================
      
      async initialize() {
        console.log('[VisitorIQ] Initializing...');
        
        // Validate environment
        if (!this.validateEnvironment()) {
          console.log('[VisitorIQ] Environment validation failed');
          return;
        }
        
        // Check for bot
        await this.detectBot();
        if (this.isBot) {
          console.log('[VisitorIQ] Bot detected, stopping initialization');
          return;
        }
        
        // Check localStorage
        this.checkLocalStorage();
        
        // Generate/retrieve IDs
        this.visitorId = this.generateVisitorId();
        this.sessionId = this.getSessionId();
        
        // Store initial referrer
        this.storeInitialReferrer();
        this.referrer = this.getStoredValue(CONFIG.REFERRER_KEY, true);
        
        // Collect static data
        this.collectDeviceMetrics();
        this.collectTimeZoneAndLocale();
        this.collectPreferredLanguages();
        this.collectTouchSupport();
        
        // Track entry page
        this.entryPage = window.location.href;
        this.pagesVisited.push({
          url: window.location.href,
          title: document.title,
          timestamp: new Date().toISOString()
        });
        
        // Initialize collectors
        this.initializeEmailCapture();
        this.collectHashes();
        
        // Start tracking
        this.startSessionTracking();
        this.trackSessionDuration();
        this.captureExitPage();
        
        // Send initial data
        await this.sendPendingData();
        await this.sendDataToAPI({});
        
        // Send to USB Browser
        this.sendToUSBrowser();
        
        this.isInitialized = true;
        console.log('[VisitorIQ] Initialized successfully', {
          visitorId: this.visitorId,
          sessionId: this.sessionId
        });
      }
      
      // ========================================================================
      // VALIDATION & BOT DETECTION
      // ========================================================================
      
      validateEnvironment() {
        // Check cookies enabled
        if (!navigator.cookieEnabled) {
          console.warn('[VisitorIQ] Cookies disabled');
          return false;
        }
        
        // Check if in iframe
        if (window.location !== window.parent.location) {
          console.warn('[VisitorIQ] Running in iframe');
          return false;
        }
        
        // Prevent double load
        if (this.getCookie('viq_loading') === 'true') {
          console.warn('[VisitorIQ] Already loading');
          return false;
        }
        
        this.setCookie('viq_loading', 'true', 1); // 1 second
        return true;
      }
      
      async detectBot() {
        try {
          // Simple bot detection (can be enhanced with botd library)
          const userAgent = navigator.userAgent.toLowerCase();
          const botPatterns = [
            'bot', 'crawler', 'spider', 'headless',
            'googlebot', 'bingbot', 'slurp', 'duckduckbot',
            'baiduspider', 'yandexbot', 'facebookexternalhit',
            'instagram', 'whatsapp'
          ];
          
          this.isBot = botPatterns.some(pattern => userAgent.includes(pattern));
          
          // Additional check: webdriver
          if (navigator.webdriver) {
            this.isBot = true;
          }
          
        } catch (error) {
          console.error('[VisitorIQ] Bot detection error:', error);
          this.isBot = false;
        }
      }
      
      // ========================================================================
      // ID GENERATION
      // ========================================================================
      
      generateVisitorId() {
        let vid = this.getStoredValue(CONFIG.VISITOR_ID_KEY, true);
        
        if (!vid) {
          // Generate UUID v4
          vid = this.generateUUID();
          vid = vid + '-' + Date.now();
          
          // Store for 1 year
          this.storeValue(CONFIG.VISITOR_ID_KEY, vid, CONFIG.VISITOR_EXPIRY);
          console.log('[VisitorIQ] Generated new visitor ID:', vid);
        }
        
        return vid;
      }
      
      getSessionId() {
        let sid = this.getStoredValue(CONFIG.SESSION_ID_KEY, true);
        let lastActivity = this.getStoredValue(CONFIG.LAST_ACTIVITY_KEY);
        
        // Check if session expired
        if (!sid || (lastActivity && Date.now() - parseInt(lastActivity) > CONFIG.SESSION_TIMEOUT)) {
          sid = this.generateUUID() + '-' + Date.now();
          this.storeValue(CONFIG.SESSION_ID_KEY, sid, CONFIG.SESSION_EXPIRY);
          this.sessionStartTime = Date.now();
          console.log('[VisitorIQ] Generated new session ID:', sid);
        }
        
        // Update last activity
        this.storeValue(CONFIG.LAST_ACTIVITY_KEY, Date.now().toString(), CONFIG.SESSION_EXPIRY);
        
        return sid;
      }
      
      generateUUID() {
        try {
          // Use crypto API if available
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        } catch (e) {
          // Fallback to Math.random
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }
      }
      
      // ========================================================================
      // COMPOSITE ID FOR USB BROWSER
      // ========================================================================
      
      generateCompositeId() {
        const context = {
          v: this.visitorId,           // Visitor UUID
          s: this.siteId,               // Site ID
          r: document.referrer || "direct",  // Referrer
          p: this.cleanUrl(window.location.href)  // Current page (cleaned)
        };
        
        return btoa(JSON.stringify(context));
      }
      
      cleanUrl(url) {
        try {
          let urlObj = new URL(url);
          urlObj.search = '';
          urlObj.hash = '';
          return urlObj.toString();
        } catch (e) {
          return url;
        }
      }
      
      // ========================================================================
      // STORAGE MANAGEMENT
      // ========================================================================
      
      checkLocalStorage() {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('viq_test', '1');
            if (localStorage.getItem('viq_test') === '1') {
              localStorage.removeItem('viq_test');
              this.hasLocalStorage = true;
            }
          }
        } catch (e) {
          this.hasLocalStorage = false;
        }
      }
      
      storeValue(key, value, maxAgeSeconds) {
        // Store in cookie
        this.setCookie(key, value, maxAgeSeconds);
        
        // Store in localStorage if available
        if (this.hasLocalStorage) {
          try {
            localStorage.setItem(key, value);
          } catch (e) {
            console.warn('[VisitorIQ] localStorage write failed:', e);
          }
        }
      }
      
      getStoredValue(key, cookieOnly = false) {
        let value = null;
        
        // Try localStorage first (unless cookieOnly)
        if (this.hasLocalStorage && !cookieOnly) {
          try {
            value = localStorage.getItem(key);
          } catch (e) {
            // Ignore
          }
        }
        
        // Fallback to cookie
        if (!value) {
          value = this.getCookie(key);
        }
        
        return value;
      }
      
      setCookie(name, value, maxAgeSeconds) {
        const maxAge = maxAgeSeconds ? `;max-age=${maxAgeSeconds}` : '';
        document.cookie = `${name}=${value}${maxAge};path=/;secure;samesite=strict`;
      }
      
      getCookie(name) {
        const cookie = document.cookie
          .split('; ')
          .find(row => row.startsWith(name + '='));
        return cookie ? cookie.split('=')[1] : null;
      }
      
      // ========================================================================
      // REFERRER TRACKING
      // ========================================================================
      
      storeInitialReferrer() {
        const currentReferrer = document.referrer;
        const currentHost = window.location.hostname;
        
        // Only store external referrers
        if (currentReferrer) {
          try {
            const referrerHost = new URL(currentReferrer).hostname;
            if (referrerHost !== currentHost) {
              // Check if not already stored or expired
              if (!this.getStoredValue(CONFIG.REFERRER_KEY, true)) {
                this.storeValue(CONFIG.REFERRER_KEY, currentReferrer, 15 * 24 * 60 * 60); // 15 days
              }
            }
          } catch (e) {
            // Invalid referrer URL
          }
        }
      }
      
      // ========================================================================
      // DEVICE & ENVIRONMENT METRICS
      // ========================================================================
      
      collectDeviceMetrics() {
        this.deviceMetrics = {
          screen_resolution: `${window.screen.width}x${window.screen.height}`,
          viewport_size: `${window.innerWidth}x${window.innerHeight}`,
          device_pixel_ratio: window.devicePixelRatio || 1,
          color_depth: window.screen.colorDepth || 24,
          browser_name: this.getBrowserName(),
          browser_version: this.getBrowserVersion(),
          operating_system: this.getOperatingSystem(),
          user_agent: navigator.userAgent,
          hardware_concurrency: navigator.hardwareConcurrency || 'unknown',
          device_memory: navigator.deviceMemory || 'unknown',
          platform: navigator.platform || 'unknown'
        };
      }
      
      getBrowserName() {
        const ua = navigator.userAgent;
        if (ua.indexOf('Firefox') > -1) return 'Firefox';
        if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) return 'Opera';
        if (ua.indexOf('Trident') > -1) return 'Internet Explorer';
        if (ua.indexOf('Edg') > -1) return 'Edge';
        if (ua.indexOf('Chrome') > -1) return 'Chrome';
        if (ua.indexOf('Safari') > -1) return 'Safari';
        return 'Unknown';
      }
      
      getBrowserVersion() {
        const ua = navigator.userAgent;
        let match;
        
        switch (this.getBrowserName()) {
          case 'Firefox':
            match = ua.match(/Firefox\/([0-9\.]+)/);
            break;
          case 'Opera':
            match = ua.match(/OPR\/([0-9\.]+)/);
            break;
          case 'Edge':
            match = ua.match(/Edg\/([0-9\.]+)/);
            break;
          case 'Chrome':
            match = ua.match(/Chrome\/([0-9\.]+)/);
            break;
          case 'Safari':
            match = ua.match(/Version\/([0-9\.]+)/);
            break;
          default:
            match = null;
        }
        
        return match && match[1] ? match[1] : 'Unknown';
      }
      
      getOperatingSystem() {
        const ua = navigator.userAgent;
        const platform = navigator.userAgentData?.platform || navigator.platform;
        
        if (/Win/.test(platform)) return 'Windows';
        if (/Mac/.test(platform)) return 'MacOS';
        if (/Linux/.test(platform)) return 'Linux';
        if (/Android/.test(ua)) return 'Android';
        if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
        return 'Unknown';
      }
      
      collectTimeZoneAndLocale() {
        try {
          const options = Intl.DateTimeFormat().resolvedOptions();
          this.timeZone = options.timeZone;
          this.locale = options.locale;
        } catch (e) {
          this.timeZone = 'Unknown';
          this.locale = 'Unknown';
        }
      }
      
      collectPreferredLanguages() {
        this.preferredLanguages = navigator.languages || [navigator.language] || ['Unknown'];
      }
      
      collectTouchSupport() {
        this.touchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      }
      
      // ========================================================================
      // EMAIL CAPTURE
      // ========================================================================
      
      initializeEmailCapture() {
        const self = this;
        
        function validateEmail(email) {
          email = email.trim();
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (emailRegex.test(email)) {
            self.emails.add(email);
            console.log('[VisitorIQ] Email captured:', email);
          }
        }
        
        function attachListener(element) {
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            element.addEventListener('blur', function(e) {
              validateEmail(e.target.value);
            }, false);
            
            element.addEventListener('change', function(e) {
              validateEmail(e.target.value);
            }, false);
          }
        }
        
        // Attach to existing elements
        document.querySelectorAll('input, textarea').forEach(attachListener);
        
        // Watch for new elements
        const observer = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
              if (node.nodeType === 1) {
                if (node.matches('input, textarea')) {
                  attachListener(node);
                }
                node.querySelectorAll('input, textarea').forEach(attachListener);
              }
            });
          });
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
      }
      
      // ========================================================================
      // HASH COLLECTION
      // ========================================================================
      
      collectHashes() {
        const md5Regex = /^[a-f0-9]{32}$/i;
        const sha256Regex = /^[a-f0-9]{64}$/i;
        
        // Scan cookies
        document.cookie.split('; ').forEach(cookie => {
          const parts = cookie.split('=');
          const value = decodeURIComponent(parts.slice(1).join('='));
          
          if (md5Regex.test(value)) {
            this.md5Hashes.add(value);
          } else if (sha256Regex.test(value)) {
            this.sha256Hashes.add(value);
          }
        });
        
        // Scan localStorage
        if (this.hasLocalStorage) {
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              const value = localStorage.getItem(key);
              
              if (md5Regex.test(value)) {
                this.md5Hashes.add(value);
              } else if (sha256Regex.test(value)) {
                this.sha256Hashes.add(value);
              }
            }
          } catch (e) {
            console.warn('[VisitorIQ] localStorage scan failed:', e);
          }
        }
        
        if (this.md5Hashes.size > 0 || this.sha256Hashes.size > 0) {
          console.log('[VisitorIQ] Hashes collected:', {
            md5: this.md5Hashes.size,
            sha256: this.sha256Hashes.size
          });
        }
      }
      
      // ========================================================================
      // BEHAVIORAL TRACKING
      // ========================================================================
      
      startSessionTracking() {
        let lastActivityTime = Date.now();
        const self = this;
        
        function updateActivity() {
          const now = Date.now();
          const timeDiff = now - lastActivityTime;
          
          // Only count if less than 2x interval (prevents idle time)
          if (timeDiff > 0 && timeDiff < CONFIG.DATA_SEND_INTERVAL * 2) {
            self.activeDuration += timeDiff;
          }
          
          lastActivityTime = now;
        }
        
        // Track user activity
        ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(eventType => {
          document.addEventListener(eventType, updateActivity, { passive: true });
        });
        
        // Track clicks separately
        document.addEventListener('click', function(e) {
            updateActivity();
            self.captureClickText(e);
        }, false);
        
        // Track scroll depth
        document.addEventListener('scroll', function() {
            updateActivity();
            self.updateScrollDepth();
        }, { passive: true });
        
        // Send data periodically
        setInterval(() => {
          if (document.visibilityState === 'visible' && self.activeDuration > 0) {
            self.sendDataToAPI({});
          }
        }, CONFIG.DATA_SEND_INTERVAL);
      }
      
      captureClickText(event) {
        let text = '';
        const target = event.target;
        
        if (target) {
          if (target.innerText && target.innerText.trim()) {
            text = target.innerText.trim();
          } else if (target.value && target.value.trim()) {
            text = target.value.trim();
          } else if (target.alt && target.alt.trim()) {
            text = target.alt.trim();
          } else if (target.title && target.title.trim()) {
            text = target.title.trim();
          }
          
          // Limit length
          if (text.length > 100) {
            text = text.substring(0, 100) + '...';
          }
          
          if (text) {
            this.lastClickedText = text;
            this.clickedElements.push({
              text: text,
              tag: target.tagName,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      
      updateScrollDepth() {
        const scrollHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight,
          document.body.clientHeight,
          document.documentElement.clientHeight
        );
        
        const scrollTop = window.pageYOffset || 
          document.documentElement.scrollTop || 
          document.body.scrollTop || 0;
        
        const clientHeight = window.innerHeight;
        
        if (scrollHeight > 0) {
          const depth = ((scrollTop + clientHeight) / scrollHeight) * 100;
          this.scrollDepth = parseFloat(depth.toFixed(2));
          
          if (this.scrollDepth > this.maxScrollDepth) {
            this.maxScrollDepth = this.scrollDepth;
          }
        }
      }
      
      trackSessionDuration() {
        const self = this;
        
        // Send data on visibility change
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            self.sendDataToAPI({});
          }
        });
        
        // Send data before unload
        window.addEventListener('beforeunload', () => {
          self.sendDataToAPI({});
        });
      }
      
      captureExitPage() {
        window.addEventListener('beforeunload', () => {
          this.exitPage = window.location.href;
        });
      }
      
      // ========================================================================
      // DATA PAYLOAD CONSTRUCTION
      // ========================================================================
      
      getPayload(additionalData = {}) {
        const payload = {
          // Identity
          visitor_id: this.visitorId,
          site_id: this.siteId,
          session_id: this.sessionId,
          
          // Page context
          url: window.location.href,
          title: document.title,
          referrer: this.referrer,
          last_referrer: document.referrer,
          
          // Session data
          duration: this.activeDuration,
          timestamp: new Date().toISOString(),
          entry_page: this.entryPage,
          exit_page: this.exitPage || window.location.href,
          
          // Behavioral data
          scroll_depth: this.maxScrollDepth,
          pages_visited: this.pagesVisited,
          
          // Device & environment
          device_metrics: this.deviceMetrics,
          time_zone: this.timeZone,
          locale: this.locale,
          preferred_languages: this.preferredLanguages,
          touch_support: this.touchSupport,
          
          // User agent
          user_agent: navigator.userAgent,
          
          // Collected data
          ...(this.emails.size > 0 && { emails: Array.from(this.emails) }),
          ...(this.md5Hashes.size > 0 && { md5_hashes: Array.from(this.md5Hashes) }),
          ...(this.sha256Hashes.size > 0 && { sha256_hashes: Array.from(this.sha256Hashes) }),
          ...(this.lastClickedText && { last_clicked_text: this.lastClickedText }),
          ...(this.clickedElements.length > 0 && { clicked_elements: this.clickedElements.slice(-10) }), // Last 10
          
          // Additional data
          ...additionalData
        };
        
        return payload;
      }
      
      // ========================================================================
      // DATA TRANSMISSION
      // ========================================================================
      
      async sendDataToAPI(additionalData = {}) {
        try {
          const payload = this.getPayload(additionalData);
          const encodedData = btoa(JSON.stringify({ data: JSON.stringify(payload) }));
          const jsonBody = JSON.stringify({ data: encodedData });

          // Try sendBeacon first (more reliable for page unload)
          if (navigator.sendBeacon) {
            const blob = new Blob([jsonBody], { type: 'application/json' });
            const sent = navigator.sendBeacon(
              CONFIG.API_BASE_URL + '/api/v1/track',
              blob
            );
            
            if (sent) {
              // Success - remove from pending queue
              this.pendingData = this.pendingData.filter(d => d !== encodedData);
              this.activeDuration = 0; // Reset after successful send
              
              // Update last activity
              this.storeValue(CONFIG.LAST_ACTIVITY_KEY, Date.now().toString(), CONFIG.SESSION_EXPIRY);
              
              return true;
            } else {
              // Failed - add to pending
              this.addToPending(encodedData);
            }
          } else {
            // Fallback to fetch
            const response = await fetch(CONFIG.API_BASE_URL + '/api/v1/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: jsonBody,
              keepalive: true
            });
            
            if (response.ok) {
              this.pendingData = this.pendingData.filter(d => d !== encodedData);
              this.activeDuration = 0;
              this.storeValue(CONFIG.LAST_ACTIVITY_KEY, Date.now().toString(), CONFIG.SESSION_EXPIRY);
              return true;
            } else {
              this.addToPending(encodedData);
            }
          }
        } catch (error) {
          console.error('[VisitorIQ] Error sending data:', error);
          return false;
        }
      }
      
      addToPending(data) {
        if (!this.pendingData.includes(data)) {
          this.pendingData.push(data);
          this.storePendingData();
        }
      }
      
      storePendingData() {
        try {
          this.storeValue(
            CONFIG.PENDING_DATA_KEY,
            JSON.stringify(this.pendingData),
            7 * 24 * 60 * 60 // 7 days
          );
        } catch (e) {
          console.warn('[VisitorIQ] Failed to store pending data:', e);
        }
      }
      
      async sendPendingData() {
        const pendingStr = this.getStoredValue(CONFIG.PENDING_DATA_KEY);
        
        if (pendingStr) {
          try {
            const pending = JSON.parse(pendingStr);
            console.log('[VisitorIQ] Sending', pending.length, 'pending items');
            
            for (const data of pending) {
              // Use fetch for retrying old data (data is base64 string; send as JSON)
              try {
                const response = await fetch(CONFIG.API_BASE_URL + '/api/v1/track', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ data: data })
                });
                
                if (response.ok) {
                  this.pendingData = this.pendingData.filter(d => d !== data);
                }
              } catch (e) {
                console.warn('[VisitorIQ] Failed to send pending item:', e);
              }
            }
            
            // Update stored pending data
            this.storePendingData();
          } catch (e) {
            console.error('[VisitorIQ] Error processing pending data:', e);
          }
        }
      }
      
      // ========================================================================
      // USB BROWSER INTEGRATION
      // ========================================================================
      
      sendToUSBrowser() {
        try {
          // Generate composite ID (UUID + context)
          this.compositeId = this.generateCompositeId();
          
          const url = new URL(CONFIG.USB_BROWSER_URL);
          url.searchParams.set('pid', CONFIG.USB_BROWSER_PID);
          url.searchParams.set('puid', this.compositeId); // UUID + context
          
          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.async = true;
          script.src = url.toString();
          
          document.head.appendChild(script);
          
          console.log('[VisitorIQ] Sent to USB Browser', {
            puid: this.compositeId,
            decoded: JSON.parse(atob(this.compositeId))
          });
        } catch (error) {
          console.error('[VisitorIQ] Error sending to USB Browser:', error);
        }
      }
    }
    
    // ============================================================================
    // TEST FUNCTIONALITY
    // ============================================================================
    
    async function runTest() {
      try {
        const response = await fetch(CONFIG.API_BASE_URL + "/api/v1/sites/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId: siteId })
        });
        
        if (response.status === 200) {
          window.alert("✅ Your tracking pixel is working!\n\nYou can now:\n- Close this browser window\n- Continue to setup a view in your dashboard");
        } else {
          window.alert("⚠️ Test failed. Please check:\n\n1. Content security policy allows the script\n2. Tracking pixel is correctly installed\n3. Ad blockers are disabled\n4. Try refreshing the site");
        }
      } catch (error) {
        console.error('[VisitorIQ] Test error:', error);
        window.alert("❌ Connection error. Please check:\n\n1. Content security policy\n2. Network connectivity\n3. Ad blockers\n4. CORS settings");
      }
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    // Check for test mode
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('visitoriqTest') === 'true') {
      runTest();
    }
    
    // Initialize tracking
    const tracker = new VisitorIQ();
    tracker.initialize();
    
    // Expose to window for debugging (optional - remove in production)
    if (window.location.hostname === 'localhost' || urlParams.get('debug') === 'true') {
      window.VisitorIQ = tracker;
    }
    
  }();

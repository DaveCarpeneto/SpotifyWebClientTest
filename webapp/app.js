// Main Application Logic

const App = {
    contentElement: null,
    tabId: null,
    heartbeatInterval: null,
    pollInterval: null,
    pollTimer: null,
    currentPlaybackState: null,
    seekDebounceTimer: null,
    volumeDebounceTimer: null,
    isTabVisible: true,
    sdkInitialized: false,
    progressUpdateTimer: null,
    lastProgressUpdate: null,
    isRestoringFromHistory: false,
    isMuted: false,
    volumeBeforeMute: 70,
    selectedTracks: new Set(),
    lastSelectedTrackIndex: null,
    
    // Filter state
    filterState: {
        isActive: false,
        filterText: '',
        filterBar: null,
        filterInput: null
    },
    
    // Shadow playlist for liked songs continuous playback
    shadowPlaylist: {
        id: null,              // Playlist ID when it exists
        uri: null,             // Playlist URI for playback context
        trackUris: [],         // Cached list of track URIs in the shadow playlist
        lastSyncTime: null,    // Last time we synced with liked songs
        isSyncing: false       // Flag to prevent concurrent syncs
    },
    
    // Drag and drop state
    dragState: {
        isDragging: false,
        draggedItems: [],
        dragSourceType: null,  // 'playlist', 'liked-songs', 'artist', 'album', 'search'
        dragSourceId: null,    // playlist ID, artist ID, etc.
        currentDropTarget: null,
        dropIndicator: null,
        isReordering: false    // True if dragging within the same playlist
    },
    
    // Placeholder image - Musical note with question mark
    placeholderImage: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzI4MjgyOCIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBmb250LXNpemU9IjYwIiBmaWxsPSIjNTM1MzUzIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj7wn461PC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNzAlIiBmb250LXNpemU9IjMwIiBmaWxsPSIjNTM1MzUzIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj4/PC90ZXh0Pjwvc3ZnPg==',
    
    getImageUrl(item) {
        // Helper function to get image URL from various item types
        // Selects the largest image based on height/width
        if (!item) return this.placeholderImage;
        
        // Helper to select the largest image from an array
        const selectLargestImage = (images) => {
            if (!images || images.length === 0) return null;
            
            // Find the image with the largest dimensions (width * height)
            let largestImage = images[0];
            let largestSize = 0;
            
            for (const img of images) {
                if (img.url) {
                    // Calculate size - use width * height if available, or width, or default to 0
                    const size = (img.width || 0) * (img.height || 0) || (img.width || 0);
                    if (size > largestSize) {
                        largestSize = size;
                        largestImage = img;
                    }
                }
            }
            
            return largestImage?.url || null;
        };
        
        // Check for images array
        if (item.images && item.images.length > 0) {
            const url = selectLargestImage(item.images);
            if (url) return url;
        }
        
        // Check for album.images
        if (item.album && item.album.images && item.album.images.length > 0) {
            const url = selectLargestImage(item.album.images);
            if (url) return url;
        }
        
        // Check for show.images
        if (item.show && item.show.images && item.show.images.length > 0) {
            const url = selectLargestImage(item.show.images);
            if (url) return url;
        }
        
        return this.placeholderImage;
    },

    // Context-specific shuffle settings management
    getContextShuffleSetting(contextUri) {
        const settings = JSON.parse(localStorage.getItem('contextShuffleSettings') || '{}');
        return settings[contextUri] || 'disabled';
    },

    setContextShuffleSetting(contextUri, state) {
        const settings = JSON.parse(localStorage.getItem('contextShuffleSettings') || '{}');
        settings[contextUri] = state;
        localStorage.setItem('contextShuffleSettings', JSON.stringify(settings));
    },

    currentContextUri: null,
    isAddingContext: false,  // Flag to prevent duplicate async addContextDisplay calls
    
    // Settings management
    getSetting(key, defaultValue) {
        try {
            const value = localStorage.getItem('spotifyAppSettings_' + key);
            if (value === null) return defaultValue;
            return JSON.parse(value);
        } catch (error) {
            console.error('Error getting setting:', key, error);
            return defaultValue;
        }
    },
    
    setSetting(key, value) {
        try {
            localStorage.setItem('spotifyAppSettings_' + key, JSON.stringify(value));
        } catch (error) {
            console.error('Error setting:', key, error);
        }
    },

    init() {
        this.contentElement = document.getElementById('app-content');
        
        // Check if app is already open in another tab
        if (!this.acquireTabLock()) {
            this.showMultipleTabsWarning();
            return;
        }

        // Set up heartbeat and cleanup
        this.setupHeartbeat();
        this.setupCleanup();
        this.setupVisibilityTracking();
        this.setupHistoryNavigation();
        
        this.handleAppState();
    },

    acquireTabLock() {
        // Generate unique ID for this tab
        this.tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const lockKey = 'spotify_app_lock';
        const lockData = localStorage.getItem(lockKey);
        
        if (lockData) {
            try {
                const lock = JSON.parse(lockData);
                const timeSinceHeartbeat = Date.now() - lock.lastHeartbeat;
                
                // If last heartbeat was less than 5 seconds ago, another tab is active
                if (timeSinceHeartbeat < 5000) {
                    return false;
                }
            } catch (e) {
                // Invalid lock data, proceed
            }
        }
        
        // Acquire lock
        this.updateHeartbeat();
        return true;
    },

    updateHeartbeat() {
        const lockKey = 'spotify_app_lock';
        const lockData = {
            tabId: this.tabId,
            lastHeartbeat: Date.now()
        };
        localStorage.setItem(lockKey, JSON.stringify(lockData));
    },

    setupHeartbeat() {
        // Update heartbeat every 2 seconds
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
        }, 2000);

        // Listen for storage events (another tab trying to acquire lock)
        window.addEventListener('storage', (e) => {
            if (e.key === 'spotify_app_lock' && e.newValue) {
                try {
                    const lock = JSON.parse(e.newValue);
                    // If another tab forcefully took the lock, show warning
                    if (lock.tabId !== this.tabId) {
                        this.releaseTabLock();
                        this.showMultipleTabsWarning();
                    }
                } catch (err) {
                    // Ignore parse errors
                }
            }
        });
    },

    setupCleanup() {
        // Release lock when page is about to unload
        window.addEventListener('beforeunload', () => {
            this.releaseTabLock();
            this.stopPolling();
        });

        // Also handle visibility change (tab closed/hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                // Don't release immediately, just stop heartbeat when hidden
                // This prevents issues with quick tab switches
            }
        });
    },

    setupVisibilityTracking() {
        document.addEventListener('visibilitychange', () => {
            this.isTabVisible = document.visibilityState === 'visible';
            
            if (this.isTabVisible) {
                // Tab became visible, resume polling
                this.updatePollingInterval();
            } else {
                // Tab hidden, stop polling
                this.stopPolling();
            }
        });
    },

    releaseTabLock() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        const lockKey = 'spotify_app_lock';
        const lockData = localStorage.getItem(lockKey);
        
        if (lockData) {
            try {
                const lock = JSON.parse(lockData);
                // Only release if this tab owns the lock
                if (lock.tabId === this.tabId) {
                    localStorage.removeItem(lockKey);
                }
            } catch (e) {
                // If parse fails, just remove it
                localStorage.removeItem(lockKey);
            }
        }
    },

    setupHistoryNavigation() {
        // Handle browser back/forward buttons
        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.type) {
                this.isRestoringFromHistory = true;
                this.restoreFromHistory(event.state);
                this.isRestoringFromHistory = false;
            }
        });
        
        // Replace initial state if none exists
        if (!history.state) {
            history.replaceState({ type: 'initial' }, '', window.location.href);
        }
    },

    pushHistoryState(state) {
        // Don't push state if we're restoring from history
        if (this.isRestoringFromHistory) {
            return;
        }
        
        // Create a clean URL without the hash (optional)
        const url = window.location.pathname + window.location.search;
        history.pushState(state, '', url);
    },

    async restoreFromHistory(state) {
        switch (state.type) {
            case 'artist':
                if (state.artistId) {
                    await this.displayArtistDetails(state.artistId);
                }
                break;
            case 'album':
                if (state.albumId) {
                    await this.displayAlbumDetails(state.albumId);
                }
                break;
            case 'playlist':
                if (state.playlistId) {
                    await this.displayPlaylistDetails(state.playlistId);
                }
                break;
            case 'podcast':
                if (state.podcastId) {
                    await this.displayPodcastDetails(state.podcastId);
                }
                break;
            case 'audiobook':
                if (state.audiobookId) {
                    await this.displayAudiobookDetails(state.audiobookId);
                }
                break;
            case 'user-profile':
                if (state.userId) {
                    await this.displayUserProfile(state.userId);
                }
                break;
            case 'liked-songs':
                await this.displayLikedSongsDetails();
                break;
            case 'liked-episodes':
                await this.displayLikedEpisodesDetails();
                break;
            case 'search-results':
                if (state.searchData) {
                    this.redisplaySearchResults(state.searchData);
                }
                break;
        }
    },

    showMultipleTabsWarning() {
        this.contentElement.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <div class="error">
                        <strong>⚠️ Multiple Tabs Detected</strong><br><br>
                        This application is already open in another browser tab.<br>
                        Please close this tab and use the existing one.<br><br>
                        <i>Running multiple instances makes a mess of things - sorry</i> 😕
                    </div>
                </div>
            </div>
        `;
    },

    async handleAppState() {
        const urlParams = new URLSearchParams(window.location.search);
        const hasCode = urlParams.has('code');
        const hasError = urlParams.has('error');

        try {
            // Scenario B: Callback from Spotify
            if (hasCode || hasError) {
                this.showLoading('Processing authentication...');
                await SpotifyAuth.handleCallback();
                return; // Will reload after successful token exchange
            }

            // Check if we have a token
            const accessToken = SpotifyAuth.getAccessToken();

            if (!accessToken) {
                // Scenario A: Not authenticated
                this.showLogin();
                return;
            }

            // Check if token is expired
            if (SpotifyAuth.isTokenExpired()) {
                const refreshToken = SpotifyAuth.getRefreshToken();
                
                if (refreshToken) {
                    // Scenario D: Token expired, but we have refresh token
                    this.showLoading('Refreshing authentication...');
                    await SpotifyAuth.refreshAccessToken();
                    this.showSuccess();
                } else {
                    // No refresh token, need to login again
                    this.showLogin();
                }
            } else {
                // Scenario C: Valid token exists
                this.showSuccess();
                // Initialize Web Playback SDK
                await this.initializeWebPlaybackSDK();
                // Start polling for playback state
                this.startPolling();
                // Load user profile
                this.loadUserProfile();
                // Initialize shadow playlist for liked songs
                this.initializeShadowPlaylist();
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.showError(error.message);
            // Clear auth data on error
            SpotifyAuth.clearAuthData();
            // Show login button after error
            setTimeout(() => this.showLogin(), 3000);
        }
    },

    async initializeWebPlaybackSDK() {
        if (this.sdkInitialized) {
            console.log('SDK already initialized');
            return;
        }
        
        try {
            const accessToken = SpotifyAuth.getAccessToken();
            if (!accessToken) {
                console.error('No access token for SDK initialization');
                return;
            }
            
            // Set up callbacks
            WebPlaybackSDK.onStateChange = (state) => {
                this.handleSDKStateChange(state);
            };
            
            WebPlaybackSDK.onActivePlayerChange = (isActive) => {
                this.handleActivePlayerChange(isActive);
            };
            
            // Initialize the SDK
            const deviceId = await WebPlaybackSDK.init(accessToken);
            console.log('Web Playback SDK initialized with device ID:', deviceId);
            this.sdkInitialized = true;
        } catch (error) {
            console.error('Error initializing Web Playback SDK:', error);
        }
    },
    
    handleSDKStateChange(state) {
        if (state) {
            // Convert SDK state to our playback state format
            const playbackState = WebPlaybackSDK.convertStateToPlaybackState(state);
            this.currentPlaybackState = playbackState;
            this.lastProgressUpdate = Date.now();
            this.updateUIWithPlaybackState(playbackState);
            
            // Start/stop progress updates based on playing state
            if (!playbackState.is_playing) {
                this.stopProgressUpdates();
            } else {
                this.startProgressUpdates();
            }
        } else {
            // State is null, we lost playback
            this.stopProgressUpdates();
            this.currentPlaybackState = null;
            this.updateUIWithPlaybackState(null);
        }
    },
    
    startProgressUpdates() {
        // Only update progress if we're the active player
        if (!WebPlaybackSDK.isActivePlayer) return;
        
        // Clear any existing timer
        this.stopProgressUpdates();
        
        // Update every 100ms for smooth animation
        this.progressUpdateTimer = setInterval(() => {
            if (!this.currentPlaybackState || !this.currentPlaybackState.is_playing) {
                this.stopProgressUpdates();
                return;
            }
            
            const now = Date.now();
            const elapsed = now - this.lastProgressUpdate;
            const currentMs = this.currentPlaybackState.progress_ms + elapsed;
            const totalMs = this.currentPlaybackState.item.duration_ms;
            
            // Don't go past the end
            if (currentMs >= totalMs) {
                this.stopProgressUpdates();
                return;
            }
            
            // Update UI with calculated position
            const percent = (currentMs / totalMs) * 100;
            document.getElementById('seek-progress').style.width = `${percent}%`;
            document.getElementById('current-time').textContent = this.formatTime(currentMs);
        }, 100);
    },
    
    stopProgressUpdates() {
        if (this.progressUpdateTimer) {
            clearInterval(this.progressUpdateTimer);
            this.progressUpdateTimer = null;
        }
    },
    
    handleActivePlayerChange(isActive) {
        if (isActive) {
            // We became the active player - STOP polling
            console.log('✓ We are now the active player - stopping polling');
            this.stopPolling();
            
            // Restore saved volume
            this.restoreSavedVolume();
        } else {
            // We lost active player status - RESUME polling
            console.log('✗ We lost active player status - resuming polling');
            this.stopProgressUpdates();
            this.updatePollingInterval();
        }
    },
    
    async restoreSavedVolume() {
        const savedVolume = localStorage.getItem('spotify_web_player_volume');
        if (savedVolume !== null) {
            const volumeInt = parseInt(savedVolume, 10);
            if (!isNaN(volumeInt) && volumeInt >= 0 && volumeInt <= 100) {
                try {
                    // Set volume in SDK
                    await WebPlaybackSDK.setVolume(volumeInt / 100);
                    // Update UI
                    document.getElementById('volume-progress').style.width = `${volumeInt}%`;
                    console.log(`Restored volume to ${volumeInt}%`);
                } catch (error) {
                    console.error('Error restoring volume:', error);
                }
            }
        }
    },

    async startPolling() {
        // Initial fetch
        await this.fetchAndUpdatePlaybackState();
        // Set up polling interval
        this.updatePollingInterval();
    },

    async loadUserProfile() {
        try {
            const profile = await SpotifyAPI.getUserProfile();
            if (profile) {
                // Store user ID for later use
                if (profile.id) {
                    SpotifyAuth.storeUserId(profile.id);
                }
                
                const accountBtn = document.getElementById('btn-account');
                if (profile.images && profile.images.length > 0) {
                    accountBtn.innerHTML = `<img src="${profile.images[0].url}" alt="Profile">`;
                } else {
                    accountBtn.textContent = '👤';
                }
                
                // Set account menu header
                const accountMenuHeader = document.getElementById('account-menu-header');
                if (accountMenuHeader) {
                    accountMenuHeader.textContent = profile.display_name || 'Account';
                }
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    },
    
    // Initialize shadow playlist for liked songs continuous playback
    async initializeShadowPlaylist() {
        // Check if feature is enabled
        const enabled = this.getSetting('allowLikedSongsContinuousPlayback', true);
        if (!enabled) {
            console.log('Shadow playlist feature is disabled');
            return;
        }
        
        try {
            // Look for existing shadow playlist
            const shadowPlaylist = await SpotifyAPI.findShadowPlaylist();
            
            if (shadowPlaylist) {
                console.log('Found existing shadow playlist:', shadowPlaylist.id);
                this.shadowPlaylist.id = shadowPlaylist.id;
                this.shadowPlaylist.uri = shadowPlaylist.uri;
                
                // Load existing tracks
                const trackUris = await SpotifyAPI.getShadowPlaylistTracks(shadowPlaylist.id);
                this.shadowPlaylist.trackUris = trackUris;
                console.log(`Shadow playlist has ${trackUris.length} tracks`);
                
                // Mark last sync time
                this.shadowPlaylist.lastSyncTime = Date.now();
            } else {
                console.log('No shadow playlist found (now creating)');
                const playlistsRootNode = document.querySelector('[data-node-id="playlists"]');
                if (playlistsRootNode) {
                    await this.loadUserPlaylists(playlistsRootNode);
                }
            }
        } catch (error) {
            console.error('Error initializing shadow playlist:', error);
        }
    },
    
    // Ensure shadow playlist exists and is synced with liked songs
    async ensureShadowPlaylist(likedSongsUris) {
        // Check if feature is enabled
        const enabled = this.getSetting('allowLikedSongsContinuousPlayback', true);
        if (!enabled) {
            return null;
        }
        
        // Prevent concurrent syncs
        if (this.shadowPlaylist.isSyncing) {
            console.log('Shadow playlist sync already in progress');
            return this.shadowPlaylist.uri;
        }
        
        this.shadowPlaylist.isSyncing = true;
        
        try {
            // Create playlist if it doesn't exist
            if (!this.shadowPlaylist.id) {
                console.log('Creating shadow playlist...');
                const playlist = await SpotifyAPI.createShadowPlaylist();
                
                if (playlist) {
                    this.shadowPlaylist.id = playlist.id;
                    this.shadowPlaylist.uri = playlist.uri;
                    this.shadowPlaylist.trackUris = [];
                    console.log('Shadow playlist created:', playlist.id);
                } else {
                    console.error('Failed to create shadow playlist');
                    return null;
                }
            }
            
            // Sync tracks
            const result = await SpotifyAPI.syncShadowPlaylist(
                this.shadowPlaylist.id,
                likedSongsUris,
                this.shadowPlaylist.trackUris
            );
            
            // Update cached track list
            this.shadowPlaylist.trackUris = likedSongsUris;
            this.shadowPlaylist.lastSyncTime = Date.now();
            
            if (result.added > 0 || result.removed > 0) {
                console.log(`Shadow playlist synced: +${result.added} -${result.removed}`);
            }
            
            return this.shadowPlaylist.uri;
        } catch (error) {
            console.error('Error ensuring shadow playlist:', error);
            return null;
        } finally {
            this.shadowPlaylist.isSyncing = false;
        }
    },

    stopPolling() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    },

    updatePollingInterval() {
        // Don't poll if tab is hidden
        if (!this.isTabVisible) {
            this.stopPolling();
            return;
        }
        
        // Don't poll if we are the active player
        if (WebPlaybackSDK.isActivePlayer) {
            console.log('We are active player - skipping polling');
            this.stopPolling();
            return;
        }

        this.stopPolling();

        let interval = 20000; // Default: 20 seconds

        if (this.currentPlaybackState) {
            if (this.currentPlaybackState.is_playing) {
                interval = 3000; // 3 seconds when playing
            } else {
                interval = 10000; // 10 seconds when paused
            }
        }

        this.pollInterval = interval;
        this.pollTimer = setTimeout(() => this.pollPlaybackState(), interval);
    },

    // Pagination loading indicator helpers
    showPaginationLoading() {
        const detailsImage = document.querySelector('.liked-songs-icon, .playlist-details-image, .artist-details-image, .album-details-image, .podcast-details-image, .audiobook-details-image');
        if (!detailsImage) return;
 
        // Check if overlay already exists
        if (document.querySelector('.pagination-loading-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 'pagination-loading-overlay';
        overlay.innerHTML = '⏳<br>loading...';
        detailsImage.parentElement.style.position = 'relative';
        detailsImage.parentElement.appendChild(overlay);
    },

    hidePaginationLoading() {
        const overlay = document.querySelector('.pagination-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    },

    async pollPlaybackState() {
        await this.fetchAndUpdatePlaybackState();
        this.updatePollingInterval(); // Schedule next poll
    },

    async fetchAndUpdatePlaybackState() {
        try {
            const state = await SpotifyAPI.getPlaybackState();
            
            if (!state || state.error === 'NO_ACTIVE_DEVICE') {
                // No active device - we could become the active player
                console.log('No active device found');
                
                if (WebPlaybackSDK.isReady && !WebPlaybackSDK.isActivePlayer) {
                    console.log('→ Transferring playback to us (no other devices)');
                    await WebPlaybackSDK.transferPlaybackHere(false);
                }
                
                this.currentPlaybackState = null;
                this.updateUIWithPlaybackState(null);
            } else {
                // Check if the active device is us
                const activeDeviceId = state.device?.id;
                
                if (activeDeviceId && WebPlaybackSDK.isOurDevice(activeDeviceId)) {
                    // The active device is us!
                    console.log('→ Active device is us:', activeDeviceId);
                    if (!WebPlaybackSDK.isActivePlayer) {
                        WebPlaybackSDK.setActivePlayer(true);
                    }
                } else if (WebPlaybackSDK.isActivePlayer && activeDeviceId && !WebPlaybackSDK.isOurDevice(activeDeviceId)) {
                    // Someone else became the active player
                    console.log('→ Another device is now active:', activeDeviceId);
                    WebPlaybackSDK.setActivePlayer(false);
                }
                
                this.currentPlaybackState = state;
                this.updateUIWithPlaybackState(state);
            }
        } catch (error) {
            console.error('Error fetching playback state:', error);
        }
    },

    updateUIWithPlaybackState(state) {
        const otherDeviceNotification = document.getElementById('other-device-notification');
        const otherDeviceNameSpan = document.getElementById('other-device-name');
        
        if (!state) {
            // No playback - show default state
            document.getElementById('track-title').textContent = 'No track playing';
            document.getElementById('track-artist').textContent = 'Connect a Spotify client';
            document.getElementById('album-art').innerHTML = '🎵';
            document.getElementById('current-time').textContent = '0:00';
            document.getElementById('total-time').textContent = '0:00';
            document.getElementById('seek-progress').style.width = '0%';
            
            // Hide other device notification when there's no playback
            if (otherDeviceNotification) {
                otherDeviceNotification.style.display = 'none';
            }
            
            // Reset context tracking when playback stops
            this.currentContextUri = null;
            
            return;
        }

        // Check if another device is the active player
        const activeDeviceId = state.device?.id;
        const isOtherDevice = activeDeviceId && !WebPlaybackSDK.isOurDevice(activeDeviceId);
        
        if (otherDeviceNotification && otherDeviceNameSpan) {
            if (isOtherDevice) {
                otherDeviceNameSpan.textContent = `Playing on ${state.device.name}`;
                otherDeviceNotification.style.display = 'block';
            } else {
                otherDeviceNotification.style.display = 'none';
            }
        }

        // Handle context-specific shuffle settings
        const contextUri = state.context?.uri;
        if (contextUri !== this.currentContextUri) {
            // Context changed - apply new context's shuffle setting
            if (contextUri) {
                this.applyContextShuffle(contextUri);
            }
            
            this.currentContextUri = contextUri;
        }

        const item = state.item;
        if (item) {
            // Update track info
            document.getElementById('track-title').textContent = item.name;
            const trackArtistElement = document.getElementById('track-artist');
            
            // Debug: log item type and structure
            console.log('Item type:', item.type, 'Has show:', !!item.show, 'Has audiobook:', !!item.audiobook, 'Item:', item);
            
            // Check item type first - episodes and chapters have different structures
            if (item.type === 'episode' || item.show) {
                // This is a podcast episode
                trackArtistElement.innerHTML = '';
                const showSpan = document.createElement('span');
                // The show name might be in item.show.name or item.album.name
                const showName = item.show?.name || item.album?.name || 'Unknown Show';
                const showId = item.show?.id || item.album?.id || '';
                showSpan.textContent = showName;
                showSpan.style.cursor = 'pointer';
                showSpan.style.textDecoration = 'none';
                showSpan.classList.add('clickable-link');
                showSpan.dataset.showId = showId;
                trackArtistElement.appendChild(showSpan);
            } else if (item.type === 'chapter' || item.audiobook) {
                // This is an audiobook chapter
                trackArtistElement.innerHTML = '';
                const audiobookSpan = document.createElement('span');
                // The audiobook name might be in item.audiobook.name or item.album.name
                const audiobookName = item.audiobook?.name || item.album?.name || 'Unknown Audiobook';
                const audiobookId = item.audiobook?.id || item.album?.id || '';
                audiobookSpan.textContent = audiobookName;
                audiobookSpan.style.cursor = 'pointer';
                audiobookSpan.style.textDecoration = 'none';
                audiobookSpan.classList.add('clickable-link');
                audiobookSpan.dataset.audiobookId = audiobookId;
                trackArtistElement.appendChild(audiobookSpan);
            } else if (item.artists && item.album) {
                // This is a regular track - display artist and album
                const artists = item.artists.map(a => a.name).join(', ');
                
                // Create clickable artist and album spans
                trackArtistElement.innerHTML = '';
                
                // Artist span (clickable to first artist)
                const artistSpan = document.createElement('span');
                artistSpan.textContent = artists;
                artistSpan.style.cursor = 'pointer';
                artistSpan.style.textDecoration = 'none';
                artistSpan.classList.add('clickable-link');
                artistSpan.dataset.artistId = item.artists?.[0]?.id || ''; // First artist
                
                // Separator
                const separator = document.createElement('span');
                separator.textContent = ' • ';
                separator.style.cursor = 'default';
                
                // Album span (clickable to album)
                const albumSpan = document.createElement('span');
                albumSpan.textContent = item.album.name;
                albumSpan.style.cursor = 'pointer';
                albumSpan.style.textDecoration = 'none';
                albumSpan.classList.add('clickable-link');
                albumSpan.dataset.albumId = item.album?.id || '';
                
                trackArtistElement.appendChild(artistSpan);
                trackArtistElement.appendChild(separator);
                trackArtistElement.appendChild(albumSpan);
                
                // Add context if it exists and is different from the album
                if (state.context && state.context.uri) {
                    const albumUri = item.album.uri || `spotify:album:${item.album.id}`;
                    if (state.context.uri !== albumUri) {
                        // Context is different from the album - show it
                        this.addContextDisplay(trackArtistElement, state.context);
                    }
                }
            }
            
            // Update album art only if it changed
            const albumArt = document.getElementById('album-art');
            // For episodes/chapters, images might be in different places
            let newImageUrl = null;
            if (item.type === 'episode' && item.images && item.images.length > 0) {
                newImageUrl = item.images[0].url;
            } else if (item.type === 'chapter' && item.images && item.images.length > 0) {
                newImageUrl = item.images[0].url;
            } else if (item.album && item.album.images && item.album.images.length > 0) {
                newImageUrl = item.album.images[0].url;
            }
            
            const currentImg = albumArt.querySelector('img');
            const currentImageUrl = currentImg ? currentImg.src : null;
            
            if (newImageUrl && newImageUrl !== currentImageUrl) {
                albumArt.innerHTML = `<img src="${newImageUrl}" alt="Album art">`;
            } else if (!newImageUrl && currentImg) {
                albumArt.innerHTML = '🎵';
            } else if (!newImageUrl && !currentImg && albumArt.textContent !== '🎵') {
                albumArt.innerHTML = '🎵';
            }

            // Update seek bar
            const currentMs = state.progress_ms || 0;
            const totalMs = item.duration_ms;
            const percent = (currentMs / totalMs) * 100;
            document.getElementById('seek-progress').style.width = `${percent}%`;
            document.getElementById('current-time').textContent = this.formatTime(currentMs);
            document.getElementById('total-time').textContent = this.formatTime(totalMs);
        }

        // Update play/pause button
        const playPauseBtn = document.getElementById('btn-play-pause');
        playPauseBtn.textContent = state.is_playing ? '⏸' : '▶';
        playPauseBtn.title = state.is_playing ? 'Pause' : 'Play';

        // Update shuffle button
        const shuffleBtn = document.getElementById('btn-shuffle');
        shuffleBtn.classList.toggle('active', state.shuffle_state);

        // Update loop button
        const loopBtn = document.getElementById('btn-loop');
        loopBtn.classList.remove('active', 'track-mode');
        if (state.repeat_state === 'track') {
            loopBtn.classList.add('active', 'track-mode');
            loopBtn.title = 'Loop: Track';
        } else if (state.repeat_state === 'context') {
            loopBtn.classList.add('active');
            loopBtn.title = 'Loop: Context';
        } else {
            loopBtn.title = 'Loop: Off';
        }

        // Update volume
        const volumeBar = document.getElementById('volume-bar');
        const volumeIcon = document.querySelector('.volume-icon');
        
        if (state.device && state.device.volume_percent !== null && state.device.volume_percent !== undefined) {
            const volume = state.device.volume_percent;
            document.getElementById('volume-progress').style.width = `${volume}%`;
            
            // Update mute state based on volume
            if (volume === 0 && this.volumeBeforeMute > 0) {
                this.isMuted = true;
            } else if (volume > 0) {
                this.isMuted = false;
            }
            
            // Update volume icon based on mute state and volume level
            if (volumeIcon) {
                if (this.isMuted || volume === 0) {
                    volumeIcon.textContent = '🔇';
                } else if (volume < 33) {
                    volumeIcon.textContent = '🔈';
                } else if (volume < 66) {
                    volumeIcon.textContent = '🔉';
                } else {
                    volumeIcon.textContent = '🔊';
                }
            }
        }
        
        // Disable volume control if device doesn't support it
        if (state.device && state.device.supports_volume === false) {
            volumeBar.classList.add('disabled');
            volumeBar.style.opacity = '0.4';
            volumeBar.style.cursor = 'not-allowed';
            if (volumeIcon) {
                volumeIcon.style.opacity = '0.4';
                volumeIcon.style.cursor = 'not-allowed';
            }
        } else {
            volumeBar.classList.remove('disabled');
            volumeBar.style.opacity = '1';
            volumeBar.style.cursor = 'pointer';
            if (volumeIcon) {
                volumeIcon.style.opacity = '1';
                volumeIcon.style.cursor = 'pointer';
            }
        }
        
        // Update currently playing highlights in content pane
        this.updateCurrentlyPlayingHighlights();
        
        // Update context play button appearance if visible
        const contextPlayButtons = document.querySelectorAll('.context-play-button');
        contextPlayButtons.forEach(button => {
            const buttonContextUri = button.dataset.contextUri;
            const currentContextUri = state?.context?.uri;
            const isCurrentContext = buttonContextUri === currentContextUri;
            
            if (isCurrentContext) {
                // This button's context is playing - show play/pause state
                const contextType = buttonContextUri?.split(':')[1] || 'content';
                this.updateContextPlayButtonAppearance(button, state.is_playing, contextType);
            } else {
                // Different context - show play icon
                const contextType = buttonContextUri?.split(':')[1] || 'content';
                this.updateContextPlayButtonAppearance(button, false, contextType);
            }
        });
    },

    async addContextDisplay(trackArtistElement, context) {
        // Add context display to the track-artist element
        // Format: " (via [Context Name])" where Context Name is clickable and in italics
        
        // If we're already adding context, don't start another async operation
        if (this.isAddingContext) {
            return;
        }
        
        // Prevent duplicates by checking if context is already displayed
        const existingContextLink = trackArtistElement.querySelector('[data-context-uri]');
        if (existingContextLink && existingContextLink.dataset.contextUri === context.uri) {
            return; // Context already displayed, don't add again
        }
        
        // Set flag to prevent concurrent calls
        this.isAddingContext = true;

        try {
            // Extract context type and ID from URI
            const contextParts = context.uri.split(':');
            const contextType = contextParts[1]; // 'playlist', 'artist', 'show', etc.
            const contextId = contextParts[2];
            
            let contextName = null;
            let isShadowPlaylist = false;
            
            // Check if this is the shadow playlist (liked songs)
            if (contextType === 'playlist' && this.shadowPlaylist.id === contextId) {
                contextName = 'Liked Songs';
                isShadowPlaylist = true;
            } else {
                // First check if metadata has the name
                if (context.metadata && context.metadata.context_description) {
                    contextName = context.metadata.context_description;
                }
                
                // If no name in metadata, fetch it from the API
                if (!contextName) {
                    if (contextType === 'playlist') {
                        const playlist = await SpotifyAPI.getPlaylist(contextId);
                        contextName = playlist?.name;
                    } else if (contextType === 'artist') {
                        const artist = await SpotifyAPI.makeRequest(`/artists/${contextId}`);
                        contextName = artist?.name;
                    } else if (contextType === 'show') {
                        const show = await SpotifyAPI.makeRequest(`/shows/${contextId}`);
                        contextName = show?.name;
                    }
                }
            }
            
            // If we got a name, add it to the display
            if (contextName) {

                // Add separator
                const contextSeparator = document.createElement('span');
                contextSeparator.textContent = ' ';
                contextSeparator.style.cursor = 'default';

                // Create context span (clickable, italic)
                const contextSpan = document.createElement('span');                
                contextSpan.style.fontStyle = 'italic';
                contextSpan.style.cursor = 'default';
                const viaText = document.createTextNode('(via ');
                contextSpan.appendChild(viaText);

                // Create clickable link for context name
                const contextLink = document.createElement('span');
                contextLink.textContent = contextName;
                contextLink.style.cursor = 'pointer';
                contextLink.style.textDecoration = 'none';
                contextLink.classList.add('clickable-link');
                contextLink.dataset.contextUri = context.uri;
                contextLink.dataset.contextType = contextType;
                contextLink.dataset.contextId = contextId;
                if (isShadowPlaylist) {
                    contextLink.dataset.isShadowPlaylist = 'true';
                }
                
                contextSpan.appendChild(contextLink);
                
                const closeParen = document.createTextNode(')');
                contextSpan.appendChild(closeParen);
                
                trackArtistElement.appendChild(contextSeparator);
                trackArtistElement.appendChild(contextSpan);
            }
        } catch (error) {
            console.error('Error fetching context details:', error);
        } finally {
            // Clear flag when done
            this.isAddingContext = false;
        }
    },
    
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
            
    isCurrentlyPlayingItem(itemId) {
        // Check if the given item ID matches the currently playing track/episode/chapter
        if (!this.currentPlaybackState || !this.currentPlaybackState.item) {
            return false;
        }
        const currentId = this.currentPlaybackState.item.id;
        return currentId === itemId;
    },

    updateCurrentlyPlayingHighlights() {
        // Remove all existing highlights
        const previouslyPlaying = document.querySelectorAll('.currently-playing');
        previouslyPlaying.forEach(element => {
            element.classList.remove('currently-playing');
            
            // For table rows, restore the track number
            if (element.tagName === 'TR') {
                const numCell = element.querySelector('.track-number-cell');
                if (numCell) {
                    const trackNumber = element.rowIndex; // Use row index as approximation
                    numCell.innerHTML = trackNumber.toString();
                    numCell.className = '';
                }
            }
            
            // For result items, remove play icon overlay
            const imageContainer = element.querySelector('.result-item-image-container');
            if (imageContainer) {
                const img = imageContainer.querySelector('img');
                const parent = imageContainer.parentNode;
                if (img && parent) {
                    parent.replaceChild(img, imageContainer);
                }
            }
            
            // For episodes, remove play icon overlay
            const episodeContainer = element.querySelector('.episode-image-container');
            if (episodeContainer) {
                const img = episodeContainer.querySelector('img');
                const parent = episodeContainer.parentNode;
                if (img && parent) {
                    parent.replaceChild(img, episodeContainer);
                }
            }
            
            // For chapters, remove play icon overlay
            const chapterContainer = element.querySelector('.chapter-image-container');
            if (chapterContainer) {
                const img = chapterContainer.querySelector('img');
                const parent = chapterContainer.parentNode;
                if (img && parent) {
                    parent.replaceChild(img, chapterContainer);
                }
            }
        });

        // If there's no current playback, we're done
        if (!this.currentPlaybackState || !this.currentPlaybackState.item) {
            return;
        }

        const currentId = this.currentPlaybackState.item.id;
        
        // Find all elements with matching ID
        const allElements = document.querySelectorAll('[data-item-id]');
        allElements.forEach(element => {
            if (element.dataset.itemId === currentId) {
                element.classList.add('currently-playing');
                
                // Determine if currently playing or paused
                const isPlaying = this.currentPlaybackState && this.currentPlaybackState.is_playing;
                const iconSymbol = isPlaying ? '\u23f8' : '\u25b6'; // pause or play
                
                // For table rows, replace track number with play/pause icon
                if (element.tagName === 'TR') {
                    const numCell = element.querySelector('td:first-child');
                    if (numCell && !numCell.classList.contains('track-number-cell')) {
                        // Store original number if needed later
                        const originalNumber = numCell.textContent;
                        numCell.className = 'track-number-cell';
                        numCell.innerHTML = `<span class="play-icon-indicator">${iconSymbol}</span>`;
                    } else if (numCell && numCell.classList.contains('track-number-cell')) {
                        // Update existing icon
                        const iconSpan = numCell.querySelector('.play-icon-indicator');
                        if (iconSpan) {
                            iconSpan.innerHTML = iconSymbol;
                        }
                    }
                }
                
                // For result items (search results, artist top tracks), add play icon overlay to image
                if (element.classList.contains('result-item')) {
                    const img = element.querySelector('.result-item-image');
                    if (img && img.style.display !== 'none') {
                        const existingOverlay = element.querySelector('.play-icon-overlay');
                        if (existingOverlay) {
                            // Update existing overlay with current icon
                            existingOverlay.innerHTML = iconSymbol;
                        } else {
                            // Create new overlay
                            const imageContainer = document.createElement('div');
                            imageContainer.className = 'result-item-image-container';
                            const playIconOverlay = document.createElement('div');
                            playIconOverlay.className = 'play-icon-overlay';
                            playIconOverlay.innerHTML = iconSymbol;
                            
                            const parent = img.parentNode;
                            parent.replaceChild(imageContainer, img);
                            imageContainer.appendChild(img);
                            imageContainer.appendChild(playIconOverlay);
                        }
                    }
                }
                
                // For episodes, add play icon overlay to image
                if (element.classList.contains('episode-item')) {
                    const img = element.querySelector('.episode-image');
                    if (img) {
                        const existingOverlay = element.querySelector('.play-icon-overlay');
                        if (existingOverlay) {
                            // Update existing overlay with current icon
                            existingOverlay.innerHTML = iconSymbol;
                        } else {
                            // Create new overlay
                            const imageContainer = document.createElement('div');
                            imageContainer.className = 'episode-image-container';
                            const playIconOverlay = document.createElement('div');
                            playIconOverlay.className = 'play-icon-overlay';
                            playIconOverlay.innerHTML = iconSymbol;
                            
                            const parent = img.parentNode;
                            parent.replaceChild(imageContainer, img);
                            imageContainer.appendChild(img);
                            imageContainer.appendChild(playIconOverlay);
                        }
                    }
                }
                
                // For chapters, add play icon overlay to image
                if (element.classList.contains('chapter-item')) {
                    const img = element.querySelector('.chapter-image');
                    if (img) {
                        const existingOverlay = element.querySelector('.play-icon-overlay');
                        if (existingOverlay) {
                            // Update existing overlay with current icon
                            existingOverlay.innerHTML = iconSymbol;
                        } else {
                            // Create new overlay
                            const imageContainer = document.createElement('div');
                            imageContainer.className = 'chapter-image-container';
                            const playIconOverlay = document.createElement('div');
                            playIconOverlay.className = 'play-icon-overlay';
                            playIconOverlay.innerHTML = iconSymbol;
                            
                            const parent = img.parentNode;
                            parent.replaceChild(imageContainer, img);
                            imageContainer.appendChild(img);
                            imageContainer.appendChild(playIconOverlay);
                        }
                    }
                }
            }
        });
    },

    showLogin() {
        this.contentElement.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <h1>Spotify Web Client</h1>
                    <div style="text-align: center;">
                        <p style="margin-bottom: 20px; color: #666;">
                            Connect your Spotify account to get started
                        </p>
                        <button class="login-button" id="login-btn">
                            Login with Spotify
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('login-btn').addEventListener('click', () => {
            SpotifyAuth.login();
        });
    },

    showSuccess() {
        this.contentElement.innerHTML = `
            <div class="player-container">
                <div class="player">
                    <!-- Playback Controls Section -->
                    <div class="controls-section">
                        <div class="playback-controls">
                            <button class="control-btn btn-previous" id="btn-previous" title="Previous">⏮</button>
                            <button class="control-btn btn-play-pause" id="btn-play-pause" title="Play">▶</button>
                            <button class="control-btn btn-next" id="btn-next" title="Next">⏭</button>
                            <button class="control-btn btn-shuffle" id="btn-shuffle" title="Shuffle">
                                <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M13.151.922a.75.75 0 10-1.06 1.06L13.109 3H11.16a3.75 3.75 0 00-2.873 1.34l-6.173 7.356A2.25 2.25 0 01.39 12.5H0V14h.391a3.75 3.75 0 002.873-1.34l6.173-7.356a2.25 2.25 0 011.724-.804h1.947l-1.017 1.018a.75.75 0 001.06 1.06L15.98 3.75 13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 00.39 3.5z"/>
                                    <path d="M7.5 10.723l.98-1.167.957 1.14a2.25 2.25 0 001.724.804h1.947l-1.017-1.018a.75.75 0 111.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 11-1.06-1.06L13.109 13H11.16a3.75 3.75 0 01-2.873-1.34l-.787-.938z"/>
                                </svg>
                            </button>
                            <button class="control-btn btn-loop" id="btn-loop" title="Loop: Off">
                                <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M0 4.75A3.75 3.75 0 013.75 1h8.5A3.75 3.75 0 0116 4.75v5a3.75 3.75 0 01-3.75 3.75H9.81l1.018 1.018a.75.75 0 11-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 111.06 1.06L9.811 12h2.439a2.25 2.25 0 002.25-2.25v-5a2.25 2.25 0 00-2.25-2.25h-8.5A2.25 2.25 0 001.5 4.75v5A2.25 2.25 0 003.75 12H5v1.5H3.75A3.75 3.75 0 010 9.75v-5z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Album Art -->
                    <div class="album-art" id="album-art">
                        🎵
                    </div>

                    <!-- Main Section -->
                    <div class="main-section">
                        <!-- Track Info -->
                        <div class="track-info">
                            <div class="track-title" id="track-title">No track playing</div>
                            <div class="track-artist" id="track-artist">Artist • Album</div>
                        </div>

                        <!-- Seek Bar -->
                        <div class="seek-container">
                            <div class="time-display" id="current-time">0:00</div>
                            <div class="seek-bar" id="seek-bar">
                                <div class="seek-bar-inner">
                                    <div class="seek-progress" id="seek-progress"></div>
                                </div>
                            </div>
                            <div class="time-display" id="total-time">0:00</div>
                        </div>

                        <!-- Volume and Search -->
                        <div class="controls-row">
                            <div class="volume-container">
                                <span class="volume-icon">🔊</span>
                                <div class="volume-bar" id="volume-bar">
                                    <div class="volume-bar-inner">
                                        <div class="volume-progress" id="volume-progress"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="search-container">
                                <input type="text" class="search-input" id="search-input" placeholder="Search for tracks..." autocomplete="off">
                                <button class="search-btn" id="search-btn" title="Search">🔍</button>
                            </div>
                        </div>
                    </div>

                    <!-- Right Actions -->
                    <div class="actions-section">
                        <div class="action-group">
                            <button class="action-btn" id="btn-account" title="Account">👤</button>
                            <div class="account-menu" id="account-menu">
                                <div class="account-menu-header" id="account-menu-header">Account</div>
                                <div class="account-menu-item account-menu-checkbox-item" id="menu-continuous-playback">
                                    <label>
                                        <input type="checkbox" id="checkbox-continuous-playback">
                                        <span>Allow continuous playback of liked songs</span>
                                    </label>
                                </div>
                                <div class="account-menu-item" id="menu-logout">Logout</div>
                            </div>
                        </div>
                        <div class="action-group">
                            <button class="action-btn" id="btn-devices" title="Devices">📱</button>
                            <div class="devices-dropdown" id="devices-dropdown">
                                <div class="devices-dropdown-header">Select a device</div>
                                <div id="devices-list"></div>
                            </div>
                        </div>
                        <button class="action-btn" id="btn-filter" title="Filter">
                            <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="fill: currentColor;">
                                <path d="M1 2h14v2L10 9v5l-4 2V9L1 4V2z" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div id="other-device-notification" class="other-device-notification" style="display: none;">
                    🔊 <span id="other-device-name"></span>
                </div>
                <div class="content-area">
                    <div class="nav-panel">
                        <div class="nav-tree" id="nav-tree"></div>
                    </div>
                    <div class="splitter" id="splitter"></div>
                    <div class="content-panel">
                        <!-- Content will be displayed here -->
                    </div>
                </div>
            </div>
        `;

        this.initializePlayerControls();
        this.initializeNavigationTree();
        this.initializeSplitter();
    },

    initializeNavigationTree() {
        const navTree = document.getElementById('nav-tree');
        
        const rootNodes = [
            { id: 'search-results', name: 'Search Results', icon: '🔍' },
            { id: 'playlists', name: 'Playlists', icon: '📋' },
            { id: 'albums', name: 'Albums', icon: '💿' },
            { id: 'artists', name: 'Artists', icon: '🎤' },
            { id: 'podcasts', name: 'Podcasts', icon: '🎙️' },
            { id: 'audiobooks', name: 'Audiobooks', icon: '📚' }
        ];

        rootNodes.forEach(node => {
            const nodeElement = this.createTreeNode(node);
            navTree.appendChild(nodeElement);
        });
        
        // Add drag handlers to the entire nav tree for albums, artists, playlists, shows, audiobooks
        navTree.addEventListener('dragover', (e) => this.handleNavTreeDragOver(e));
        navTree.addEventListener('drop', (e) => this.handleNavTreeDrop(e));
    },

    createTreeNode(node, level = 0, playlistData = null) {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'tree-node';
        nodeDiv.style.paddingLeft = `${level * 20 + 10}px`;
        nodeDiv.dataset.nodeId = node.id;
        
        // Add playlist-specific data attributes for drag and drop
        if (node.playlistId) {
            nodeDiv.dataset.playlistId = node.playlistId;
            
            // Check if this is owned by the current user
            if (playlistData) {
                const currentUserId = SpotifyAuth.getUserId();
                const isOwned = playlistData.owner && currentUserId && playlistData.owner.id === currentUserId;
                nodeDiv.dataset.playlistOwned = isOwned.toString();
                
                // Add drag handlers for owned playlists
                if (isOwned) {
                    nodeDiv.addEventListener('dragover', (e) => this.handlePlaylistNodeDragOver(e, nodeDiv, true));
                    nodeDiv.addEventListener('dragleave', (e) => this.handlePlaylistNodeDragLeave(e, nodeDiv));
                    nodeDiv.addEventListener('drop', (e) => this.handlePlaylistNodeDrop(e, nodeDiv, node.playlistId, true));
                } else {
                    nodeDiv.addEventListener('dragover', (e) => this.handlePlaylistNodeDragOver(e, nodeDiv, false));
                    nodeDiv.addEventListener('dragleave', (e) => this.handlePlaylistNodeDragLeave(e, nodeDiv));
                }
            }
        }
        
        // Add handlers for the playlists root node
        if (level === 0 && node.id === 'playlists') {
            nodeDiv.addEventListener('dragover', (e) => this.handlePlaylistRootDragOver(e));
            nodeDiv.addEventListener('drop', (e) => this.handlePlaylistRootDrop(e, nodeDiv));
        }
        
        // Add handlers for liked-songs and liked-episodes nodes
        if (node.id === 'liked-songs' || node.id === 'liked-episodes') {
            nodeDiv.addEventListener('dragover', (e) => this.handleLikedNodeDragOver(e, nodeDiv));
            nodeDiv.addEventListener('dragleave', (e) => this.handleLikedNodeDragLeave(e, nodeDiv));
            nodeDiv.addEventListener('drop', (e) => this.handleLikedNodeDrop(e, nodeDiv, node.id));
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'tree-node-content';
        
        // Disclosure triangle
        const disclosure = document.createElement('span');
        disclosure.className = 'tree-disclosure';
        disclosure.innerHTML = '▶';
        
        // Show disclosure triangle for root nodes that will have children (all except search)
        if (level === 0 && node.id !== 'search-results') {
            disclosure.style.visibility = 'visible';
        } else {
            disclosure.style.visibility = 'hidden';
        }
        
        disclosure.addEventListener('click', (e) => {
            e.stopPropagation();
            // If children don't exist yet, trigger initial load
            const childrenContainer = nodeDiv.querySelector('.tree-children');
            if (!childrenContainer && level === 0) {
                this.handleTreeNodeClick(node, nodeDiv);
            } else {
                this.toggleTreeNode(nodeDiv);
            }
        });
        
        // Icon
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        
        // If node has an imageUrl, create an img element
        if (node.imageUrl) {
            const img = document.createElement('img');
            img.src = node.imageUrl || this.placeholderImage;
            img.alt = node.name || '';
            img.className = 'tree-node-image';
            icon.appendChild(img);
        } else {
            icon.textContent = node.icon;
        }
        
        // Name
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = node.name;
        
        contentDiv.appendChild(disclosure);
        contentDiv.appendChild(icon);
        contentDiv.appendChild(name);
        
        // Add + button for playlists root node
        if (level === 0 && node.id === 'playlists') {
            const addButton = document.createElement('button');
            addButton.className = 'tree-add-button';
            addButton.innerHTML = '+';
            addButton.title = 'Create new playlist';
            addButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.displayNewPlaylistForm();
            });
            contentDiv.appendChild(addButton);
        }
        
        // Add refresh button for root nodes that need it (artists, albums, podcasts, audiobooks, playlists)
        // Initially hidden, will be shown when children are populated
        if (level === 0 && (node.id === 'artists' || node.id === 'albums' || node.id === 'podcasts' || node.id === 'audiobooks' || node.id === 'playlists')) {
            const refreshButton = document.createElement('button');
            refreshButton.className = 'tree-refresh-button';
            refreshButton.innerHTML = '↻';
            refreshButton.title = 'Refresh ' + node.name.toLowerCase();
            refreshButton.style.display = 'none'; // Initially hidden
            refreshButton.addEventListener('click', (e) => {
                e.stopPropagation();
                // Trigger a refresh by calling updateContentPanel
                this.updateContentPanel(node, nodeDiv);
            });
            contentDiv.appendChild(refreshButton);
        }
        
        // Click handler for the entire content div
        contentDiv.addEventListener('click', (e) => {
            // Don't trigger if clicking buttons or disclosure
            if (e.target.closest('.tree-disclosure') || 
                e.target.closest('.tree-add-button') || 
                e.target.closest('.tree-refresh-button') ||
                e.target.closest('.tree-delete-btn')) {
                return;
            }
            this.handleTreeNodeClick(node, nodeDiv);
        });
        

        
        nodeDiv.appendChild(contentDiv);
        
        return nodeDiv;
    },

    toggleTreeNode(nodeDiv) {
        const disclosure = nodeDiv.querySelector('.tree-disclosure');
        const childrenContainer = nodeDiv.querySelector('.tree-children');
        
        if (!childrenContainer) return;
        
        const isExpanded = nodeDiv.classList.toggle('expanded');
        
        if (isExpanded) {
            disclosure.style.transform = 'rotate(90deg)';
            childrenContainer.style.maxHeight = childrenContainer.scrollHeight + 'px';
            setTimeout(() => {
                childrenContainer.style.maxHeight = 'none';
            }, 300);
        } else {
            disclosure.style.transform = 'rotate(0deg)';
            childrenContainer.style.maxHeight = childrenContainer.scrollHeight + 'px';
            setTimeout(() => {
                childrenContainer.style.maxHeight = '0';
            }, 10);
        }
    },

    handleTreeNodeClick(node, nodeDiv) {
        // Remove previous selection
        document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
        nodeDiv.classList.add('selected');
        
        // Check if this is a root node and if children exist
        const childrenContainer = nodeDiv.querySelector('.tree-children');
        const isRootNode = nodeDiv.style.paddingLeft === '10px';
        const hasChildren = childrenContainer !== null;
        
        // For root nodes with children: just toggle visibility, don't refresh
        if (isRootNode && hasChildren && (node.id === 'artists' || node.id === 'albums' || 
            node.id === 'playlists' || node.id === 'podcasts' || node.id === 'audiobooks')) {
            // Just toggle the tree node
            this.toggleTreeNode(nodeDiv);
            
            // Update the content panel to show the list view (without refreshing data)
            // We need to call a display function without reloading
            this.displayExistingContent(node, nodeDiv);
            return;
        }
        
        // For other cases: expand if children exist and not expanded
        if (childrenContainer && !nodeDiv.classList.contains('expanded')) {
            this.toggleTreeNode(nodeDiv);
        }
        
        // Update right panel (will load data if needed)
        this.updateContentPanel(node, nodeDiv);
    },
    
    // Helper to display content without reloading data
    displayExistingContent(node, nodeDiv) {
        const childrenContainer = nodeDiv.querySelector('.tree-children');
        if (!childrenContainer) return;
        
        // Get the existing data from the tree and display it
        if (node.id === 'artists') {
            const artists = this.extractArtistsFromTree(childrenContainer);
            if (artists.length > 0) {
                this.displayArtistsList(artists);
            }
        } else if (node.id === 'albums') {
            const albums = this.extractAlbumsFromTree(childrenContainer);
            if (albums.length > 0) {
                this.displayAlbumsList(albums);
            }
        } else if (node.id === 'playlists') {
            const playlists = this.extractPlaylistsFromTree(childrenContainer);
            if (playlists.length > 0) {
                this.displayPlaylistsList(playlists);
            }
        } else if (node.id === 'podcasts') {
            const podcasts = this.extractPodcastsFromTree(childrenContainer);
            if (podcasts.length > 0) {
                this.displayPodcastsList(podcasts);
            }
        } else if (node.id === 'audiobooks') {
            const audiobooks = this.extractAudiobooksFromTree(childrenContainer);
            if (audiobooks.length > 0) {
                this.displayAudiobooksList(audiobooks);
            }
        }
    },
    
    // Helper functions to extract data from tree nodes
    extractArtistsFromTree(container) {
        const artists = [];
        Array.from(container.children).forEach(child => {
            const nameEl = child.querySelector('.tree-name');
            const imgEl = child.querySelector('.tree-node-image');
            if (nameEl && child.dataset.nodeId && child.dataset.nodeId.startsWith('artist-')) {
                const artistId = child.dataset.nodeId.replace('artist-', '');
                artists.push({
                    id: artistId,
                    name: nameEl.textContent,
                    images: imgEl ? [{ url: imgEl.src }] : []
                });
            }
        });
        return artists;
    },
    
    extractAlbumsFromTree(container) {
        const albums = [];
        Array.from(container.children).forEach(child => {
            const nameEl = child.querySelector('.tree-name');
            const imgEl = child.querySelector('.tree-node-image');
            if (nameEl && child.dataset.nodeId && child.dataset.nodeId.startsWith('album-')) {
                const albumId = child.dataset.nodeId.replace('album-', '');
                albums.push({
                    id: albumId,
                    name: nameEl.textContent,
                    images: imgEl ? [{ url: imgEl.src }] : []
                });
            }
        });
        return albums;
    },
    
    extractPlaylistsFromTree(container) {
        const playlists = [];
        Array.from(container.children).forEach(child => {
            const nameEl = child.querySelector('.tree-name');
            const imgEl = child.querySelector('.tree-node-image');
            if (nameEl && child.dataset.nodeId && child.dataset.nodeId.startsWith('playlist-')) {
                const playlistId = child.dataset.nodeId.replace('playlist-', '');
                playlists.push({
                    id: playlistId,
                    name: nameEl.textContent,
                    images: imgEl ? [{ url: imgEl.src }] : []
                });
            }
        });
        return playlists;
    },
    
    extractPodcastsFromTree(container) {
        const podcasts = [];
        Array.from(container.children).forEach(child => {
            const nameEl = child.querySelector('.tree-name');
            const imgEl = child.querySelector('.tree-node-image');
            // Skip "Liked Episodes"
            if (nameEl && nameEl.textContent !== 'Liked Episodes' && 
                child.dataset.nodeId && child.dataset.nodeId.startsWith('podcast-')) {
                const podcastId = child.dataset.nodeId.replace('podcast-', '');
                podcasts.push({
                    id: podcastId,
                    name: nameEl.textContent,
                    images: imgEl ? [{ url: imgEl.src }] : []
                });
            }
        });
        return podcasts;
    },
    
    extractAudiobooksFromTree(container) {
        const audiobooks = [];
        Array.from(container.children).forEach(child => {
            const nameEl = child.querySelector('.tree-name');
            const imgEl = child.querySelector('.tree-node-image');
            if (nameEl && child.dataset.nodeId && child.dataset.nodeId.startsWith('audiobook-')) {
                const audiobookId = child.dataset.nodeId.replace('audiobook-', '');
                audiobooks.push({
                    id: audiobookId,
                    name: nameEl.textContent,
                    images: imgEl ? [{ url: imgEl.src }] : []
                });
            }
        });
        return audiobooks;
    },

    async updateContentPanel(node, nodeDiv) {
        // Check if this is the search results root node
        if (node.id === 'search-results') {
            this.displaySearchResultsList(nodeDiv);
        } else if (node.id === 'artists') {
            await this.loadFollowedArtists(nodeDiv);
        } else if (node.id === 'albums') {
            await this.loadSavedAlbums(nodeDiv);
        } else if (node.id === 'playlists') {
            await this.loadUserPlaylists(nodeDiv);
        } else if (node.id === 'podcasts') {
            await this.loadSavedPodcasts(nodeDiv);
        } else if (node.id === 'audiobooks') {
            await this.loadSavedAudiobooks(nodeDiv);
        } else if (node.id === 'liked-songs') {
            // This is the Liked Songs special playlist
            await this.displayLikedSongsDetails();
        } else if (node.id === 'liked-episodes') {
            // This is the Liked Episodes special entry
            await this.displayLikedEpisodesDetails();
        } else if (node.artistId) {
            // This is an individual artist node
            await this.displayArtistDetails(node.artistId);
        } else if (node.albumId) {
            // This is an individual album node
            await this.displayAlbumDetails(node.albumId);
        } else if (node.playlistId) {
            // This is an individual playlist node
            await this.displayPlaylistDetails(node.playlistId);
        } else if (node.podcastId) {
            // This is an individual podcast node
            await this.displayPodcastDetails(node.podcastId);
        } else if (node.audiobookId) {
            // This is an individual audiobook node
            await this.displayAudiobookDetails(node.audiobookId);
        } else {
            // Placeholder for other nodes
            console.log('Selected node:', node.name);
        }
    },

    displaySearchResultsList(searchResultsNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        // Create container
        const container = document.createElement('div');
        container.className = 'search-results-list-container';

        // Add title
        const title = document.createElement('h1');
        title.className = 'search-results-title';
        title.textContent = 'Search Results';
        container.appendChild(title);

        // Get all search result child nodes
        const childrenContainer = searchResultsNode.querySelector('.tree-children');
        if (!childrenContainer || childrenContainer.children.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-message';
            emptyMsg.textContent = 'No search results yet. Use the search box above to find content.';
            container.appendChild(emptyMsg);
            contentPanel.appendChild(container);
            return;
        }

        // Create list of search results
        const resultsList = document.createElement('div');
        resultsList.className = 'search-results-list';

        Array.from(childrenContainer.children).forEach(queryNode => {
            const queryName = queryNode.querySelector('.tree-name')?.textContent;
            if (!queryName) return;

            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-list-item';

            // Trash button
            const trashBtn = document.createElement('button');
            trashBtn.className = 'search-result-trash-btn';
            trashBtn.innerHTML = '🗑️';
            trashBtn.title = 'Delete search result';
            trashBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSearchResultNode(queryNode, childrenContainer);
                // Refresh the list
                this.displaySearchResultsList(searchResultsNode);
            });

            // Query name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'search-result-list-name';
            nameSpan.textContent = queryName;

            resultItem.appendChild(trashBtn);
            resultItem.appendChild(nameSpan);

            // Click handler for the result item (except trash button)
            resultItem.addEventListener('click', (e) => {
                if (e.target.closest('.search-result-trash-btn')) return;
                
                // Select this node in the tree
                document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
                queryNode.classList.add('selected');
                
                // Display its search results with proper event handlers
                if (queryNode.searchResultsData) {
                    this.redisplaySearchResults(queryNode.searchResultsData);
                }
            });

            resultsList.appendChild(resultItem);
        });

        container.appendChild(resultsList);
        contentPanel.appendChild(container);
    },

    async loadFollowedArtists(artistsRootNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading followed artists...</div>';

        try {
            let allArtists = [];
            let childrenContainer = artistsRootNode.querySelector('.tree-children');
            const isFirstLoad = !childrenContainer;
            
            // Create or clear the children container
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                artistsRootNode.appendChild(childrenContainer);
                
                // Show disclosure triangle
                const disclosure = artistsRootNode.querySelector('.tree-disclosure');
                if (disclosure) {
                    disclosure.style.visibility = 'visible';
                }
            } else {
                // Clear existing children for refresh
                childrenContainer.innerHTML = '';
            }
            
            const onPageLoaded = (newArtists, totalLoaded, hasMore) => {
                // Add new artists to the tree
                newArtists.forEach(artist => {
                    let imageUrl = null;
                    if (artist.images && artist.images.length > 0) {
                        imageUrl = artist.images[artist.images.length - 1]?.url || null;
                    }

                    const artistNode = {
                        id: `artist-${artist.id}`,
                        artistId: artist.id,
                        name: artist.name,
                        imageUrl: imageUrl,
                        icon: '🎤'
                    };

                    const nodeElement = this.createTreeNode(artistNode, 1);
                    childrenContainer.appendChild(nodeElement);
                });
                
                // Re-sort all nodes alphabetically
                const nodes = Array.from(childrenContainer.children);
                nodes.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });
                nodes.forEach(node => childrenContainer.appendChild(node));
            };
            
            const artists = await SpotifyAPI.getFollowedArtists(50, onPageLoaded);
            
            if (!artists || artists.length === 0) {
                contentPanel.innerHTML = '<div class="empty-message">You are not following any artists yet.</div>';
                return;
            }

            // Expand the artists node only on first load
            if (isFirstLoad && !artistsRootNode.classList.contains('expanded')) {
                this.toggleTreeNode(artistsRootNode);
            }
            
            // Show the refresh button now that children are populated
            const refreshButton = artistsRootNode.querySelector('.tree-refresh-button');
            if (refreshButton) {
                refreshButton.style.display = 'flex';
            }

            // Display list of artists in content panel
            this.displayArtistsList(artists);

        } catch (error) {
            console.error('Error loading followed artists:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load followed artists. Please try again.</div>';
        }
    },

    displayArtistsList(artists) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'artists-list-container';

        const title = document.createElement('h1');
        title.className = 'artists-list-title';
        title.textContent = 'Followed Artists';
        container.appendChild(title);

        const artistsList = document.createElement('div');
        artistsList.className = 'artists-list';

        artists.forEach(artist => {
            const artistItem = document.createElement('div');
            artistItem.className = 'artist-list-item';

            // Artist image (always show, use placeholder if needed)
            const img = document.createElement('img');
            img.className = 'artist-list-image';
            img.src = this.getImageUrl(artist);
            img.alt = artist.name;
            artistItem.appendChild(img);

            // Artist name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'artist-list-name';
            nameDiv.textContent = artist.name;
            artistItem.appendChild(nameDiv);

            // Genres
            if (artist.genres && artist.genres.length > 0) {
                const genresDiv = document.createElement('div');
                genresDiv.className = 'artist-list-genres';
                genresDiv.textContent = artist.genres.slice(0, 3).join(', ');
                artistItem.appendChild(genresDiv);
            }

            // Click handler
            artistItem.addEventListener('click', () => {
                this.displayArtistDetails(artist.id);
            });

            artistsList.appendChild(artistItem);
        });

        container.appendChild(artistsList);
        contentPanel.appendChild(container);
    },

    async displayArtistDetails(artistId) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        // Push to history
        this.pushHistoryState({
            type: 'artist',
            artistId: artistId
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading artist details...</div>';

        try {
            let allAlbums = [];
            let albumSectionsByType = {};
            let shouldShowLoadingIndicator = false;
            let totalAlbums = 0;
            
            const onPageLoaded = (newAlbums, totalLoaded, hasMore) => {
                // Show loading indicator if needed
                if (shouldShowLoadingIndicator && hasMore) {
                    this.showPaginationLoading();
                }
                
                allAlbums = allAlbums.concat(newAlbums);
                
                // Hide loading indicator when complete
                if (!hasMore) {
                    this.hidePaginationLoading();
                }
                
                // Group new albums by type and add to existing sections
                const albumsByType = {
                    album: [],
                    compilation: [],
                    single: []
                };
                
                newAlbums.forEach(album => {
                    const type = album.album_type || 'album';
                    if (albumsByType[type]) {
                        albumsByType[type].push(album);
                    }
                });
                
                // Add albums to their respective sections
                Object.keys(albumsByType).forEach(type => {
                    if (albumsByType[type].length > 0 && albumSectionsByType[type]) {
                        const albumsContent = albumSectionsByType[type];
                        albumsByType[type].forEach(album => {
                            const albumItem = this.createResultItem(album, 'albums');
                            albumsContent.appendChild(albumItem);
                        });
                    }
                });
            };
            
            // Fetch artist details, top tracks, and albums in parallel
            const [artist, topTracks, albums] = await Promise.all([
                SpotifyAPI.getArtist(artistId),
                SpotifyAPI.getArtistTopTracks(artistId),
                SpotifyAPI.getArtistAlbums(artistId, 50, onPageLoaded)
            ]);
            
            allAlbums = albums || [];
            totalAlbums = albums?.length || 0;
            
            // Determine if we should show pagination loading indicator
            // For artists, check the first API response which includes total
            if (albums && albums.total && albums.total > 200) {
                shouldShowLoadingIndicator = true;
            }
            
            if (!artist) {
                contentPanel.innerHTML = '<div class="error">Failed to load artist details.</div>';
                return;
            }

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'artist-details-container';
            container.style.position = 'relative';

            // Header section with image and info side by side
            const headerSection = document.createElement('div');
            headerSection.className = 'artist-details-header';

            // Large artist image (left side) - always show with placeholder if needed
            const img = document.createElement('img');
            img.className = 'artist-details-image';
            img.src = this.getImageUrl(artist);
            img.alt = artist.name;
            headerSection.appendChild(img);

            // Artist info (right side)
            const infoSection = document.createElement('div');
            infoSection.className = 'artist-details-info';

            // Artist name
            const name = document.createElement('h1');
            name.className = 'artist-details-name';
            name.textContent = artist.name || 'Unknown Artist';
            infoSection.appendChild(name);

            // Followers
            if (artist.followers && artist.followers.total !== null && artist.followers.total !== undefined) {
                const followersDiv = document.createElement('div');
                followersDiv.className = 'artist-details-followers';
                followersDiv.textContent = `${this.formatFollowers(artist.followers.total)} followers`;
                infoSection.appendChild(followersDiv);
            }

            // Genres
            if (artist.genres && artist.genres.length > 0) {
                const genresDiv = document.createElement('div');
                genresDiv.className = 'artist-details-genres';
                genresDiv.innerHTML = '<strong>Genres:</strong> ' + artist.genres.join(', ');
                infoSection.appendChild(genresDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add followed icon in top-right
            const followedIconTopRight = this.createLikedIcon(false, 'liked-icon-top-right', 'artist', artist.id, {
                name: artist.name,
                imageUrl: artist.images && artist.images.length > 0 ? artist.images[artist.images.length - 1]?.url : null
            });
            container.appendChild(followedIconTopRight);
            
            // Fetch artist followed status in background
            (async () => {
                try {
                    const followedStatuses = await SpotifyAPI.checkFollowedArtists([artist.id]);
                    const icon = container.querySelector('.liked-icon-top-right');
                    if (icon && followedStatuses.length > 0) {
                        icon.className = `liked-icon ${followedStatuses[0] ? 'liked' : 'unliked'} liked-icon-top-right`;
                        icon.title = followedStatuses[0] ? 'Following' : 'Not following';
                    }
                } catch (error) {
                    console.error('Error fetching artist followed status:', error);
                }
            })();

            // Top Tracks section
            if (topTracks && topTracks.length > 0) {
                const topTracksSection = document.createElement('div');
                topTracksSection.className = 'artist-details-section';

                const topTracksHeader = document.createElement('h2');
                topTracksHeader.className = 'artist-details-section-title';
                topTracksHeader.textContent = 'Popular Tracks';
                topTracksSection.appendChild(topTracksHeader);

                const tracksContent = document.createElement('div');
                tracksContent.className = 'result-section-content';

                topTracks.forEach(track => {
                    const trackItem = this.createResultItem(track, 'tracks');
                    tracksContent.appendChild(trackItem);
                });

                topTracksSection.appendChild(tracksContent);
                container.appendChild(topTracksSection);
            }

            // Albums section - grouped by album_type
            if (albums && albums.length > 0) {
                // Group albums by album_type
                const albumsByType = {
                    album: [],
                    compilation: [],
                    single: []
                };

                albums.forEach(album => {
                    const type = album.album_type || 'album';
                    if (albumsByType[type]) {
                        albumsByType[type].push(album);
                    }
                });

                // Sort each group by release_date (newest to oldest)
                Object.keys(albumsByType).forEach(type => {
                    albumsByType[type].sort((a, b) => {
                        const dateA = a.release_date || '';
                        const dateB = b.release_date || '';
                        return dateB.localeCompare(dateA);
                    });
                });

                // Display each group in order: album, compilation, single
                const typeOrder = ['album', 'compilation', 'single'];
                const typeLabels = {
                    album: 'Albums',
                    compilation: 'Compilations',
                    single: 'Singles'
                };

                typeOrder.forEach(type => {
                    if (albumsByType[type].length > 0) {
                        const albumSection = document.createElement('div');
                        albumSection.className = 'artist-details-section';

                        const albumHeader = document.createElement('h2');
                        albumHeader.className = 'artist-details-section-title';
                        albumHeader.textContent = typeLabels[type];
                        albumSection.appendChild(albumHeader);

                        const albumsContent = document.createElement('div');
                        albumsContent.className = 'result-section-content';
                        
                        // Store reference for progressive loading
                        albumSectionsByType[type] = albumsContent;

                        albumsByType[type].forEach(album => {
                            const albumItem = this.createResultItem(album, 'albums');
                            albumsContent.appendChild(albumItem);
                        });

                        albumSection.appendChild(albumsContent);
                        container.appendChild(albumSection);
                    }
                });
            }

            contentPanel.appendChild(container);

            // Fetch liked statuses for tracks and albums in background
            (async () => {
                try {
                    // Collect track IDs and album IDs
                    const trackIds = topTracks ? topTracks.filter(t => t && t.id).map(t => t.id) : [];
                    const albumIds = albums ? albums.filter(a => a && a.id).map(a => a.id) : [];
                    
                    // Fetch statuses in parallel
                    const [trackStatuses, albumStatuses] = await Promise.all([
                        trackIds.length > 0 ? SpotifyAPI.checkLikedTracks(trackIds) : Promise.resolve([]),
                        albumIds.length > 0 ? SpotifyAPI.checkLikedAlbums(albumIds) : Promise.resolve([])
                    ]);
                    
                    // Update track liked icons
                    if (trackIds.length > 0) {
                        const trackItems = container.querySelectorAll('.result-item[data-item-type="tracks"]');
                        trackItems.forEach((item, index) => {
                            if (index < trackStatuses.length && index < topTracks.length) {
                                const placeholder = item.querySelector('.liked-icon-placeholder');
                                if (placeholder) {
                                    placeholder.innerHTML = '';
                                    const track = topTracks[index];
                                    const likedIcon = this.createLikedIcon(trackStatuses[index], 'liked-icon-inline', 'track', track.id);
                                    placeholder.appendChild(likedIcon);
                                }
                            }
                        });
                    }
                    
                    // Update album liked icons
                    if (albumIds.length > 0) {
                        const albumItems = container.querySelectorAll('.result-item[data-item-type="albums"]');
                        albumItems.forEach((item, index) => {
                            if (index < albumStatuses.length && index < albums.length) {
                                const placeholder = item.querySelector('.liked-icon-placeholder');
                                if (placeholder) {
                                    placeholder.innerHTML = '';
                                    const album = albums[index];
                                    const likedIcon = this.createLikedIcon(albumStatuses[index], 'liked-icon-inline', 'album', album.id, {
                                        name: album.name,
                                        imageUrl: album.images && album.images.length > 0 ? album.images[0]?.url : null
                                    });
                                    placeholder.appendChild(likedIcon);
                                }
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error fetching liked statuses:', error);
                }
            })();

        } catch (error) {
            console.error('Error displaying artist details:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load artist details. Please try again.</div>';
        }
    },

    formatFollowers(count) {
        if (count >= 1000000) {
            return (count / 1000000).toFixed(1) + 'M';
        } else if (count >= 1000) {
            return (count / 1000).toFixed(1) + 'K';
        }
        return count.toString();
    },

    // Create a liked/unliked icon element
    createLikedIcon(isLiked, additionalClass = '', itemType = null, itemId = null, itemData = {}) {
        const icon = document.createElement('div');
        icon.className = `liked-icon ${isLiked ? 'liked' : 'unliked'} ${additionalClass}`;
        icon.title = isLiked ? 'Liked' : 'Not liked';
        
        // Add click handler if we have context
        if (itemType && itemId) {
            icon.style.cursor = 'pointer';
            icon.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering item navigation
                this.handleLikeToggle(itemType, itemId, icon, itemData);
            });
        }
        
        return icon;
    },

    // Create context-specific play/pause button
    // Create context-specific play/pause button
    createContextPlayButton(contextUri, contextType, tracks = null) {
        const playButton = document.createElement('div');
        playButton.className = 'context-play-button';
        playButton.dataset.contextUri = contextUri;
        
        // Store tracks for finding first playable track
        if (tracks) {
            playButton.tracksData = tracks;
        }
        
        // Check if this context is currently playing and set initial appearance
        const currentContextUri = this.currentPlaybackState?.context?.uri;
        const isCurrentContext = currentContextUri === contextUri;
        const isPlaying = isCurrentContext && this.currentPlaybackState?.is_playing;
        
        // Initial button appearance based on current playback state
        this.updateContextPlayButtonAppearance(playButton, isPlaying, contextType);
        
        // Click handler
        playButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            // Check if this context is currently playing
            const currentContextUri = this.currentPlaybackState?.context?.uri;
            const isCurrentContext = currentContextUri === contextUri;
            
            if (isCurrentContext) {
                // This context is currently playing - toggle play/pause
                try {
                    if (this.currentPlaybackState?.is_playing) {
                        await SpotifyAPI.pause();
                        console.log(`Paused ${contextType}`);
                    } else {
                        await SpotifyAPI.play();
                        console.log(`Resumed ${contextType}`);
                    }
                } catch (error) {
                    console.error(`Error toggling playback:`, error);
                }
            } else {
                // Different context - play this context
                try {
                    // Apply context-specific shuffle setting immediately before playback
                    const contextSetting = this.getContextShuffleSetting(contextUri);
                    const targetShuffle = contextSetting === 'enabled';
                    
                    try {
                        await SpotifyAPI.setShuffle(targetShuffle);
                        console.log(`Set shuffle to ${targetShuffle} before playing ${contextUri}`);
                    } catch (error) {
                        console.error('Error setting shuffle before playback:', error);
                    }
                    
                    let position = null;
                    
                    // If shuffle is disabled, find the first playable track
                    if (!targetShuffle && playButton.tracksData) {
                        // Find first playable track
                        for (let i = 0; i < playButton.tracksData.length; i++) {
                            const track = playButton.tracksData[i];
                            const isPlayable = track.is_playable !== false && !(track.restrictions && track.restrictions.reason);
                            if (isPlayable) {
                                position = i;
                                console.log(`Starting at first playable track: position ${i}`);
                                break;
                            }
                        }
                        // If no playable track found, default to 0
                        if (position === null) {
                            position = 0;
                        }
                    }
                    
                    await SpotifyAPI.playContentUri(null, contextUri, null, position);
                    console.log(`Started playing ${contextType}: ${contextUri}${position !== null ? ` from position ${position}` : ''}`);
                } catch (error) {
                    console.error(`Error playing ${contextType}:`, error);
                    let errorMessage = `Failed to play ${contextType}`;
                    if (error.message && error.message.includes('Restriction violated')) {
                        errorMessage = `Cannot play this ${contextType}\n\nContent may not be available in your region, or may require a Spotify Premium subscription.`;
                    } else if (error.message && error.message.includes('NO_ACTIVE_DEVICE')) {
                        errorMessage = 'No active device found. Please select a device from the devices menu.';
                    } else if (error.message) {
                        errorMessage = `Cannot play ${contextType}\n\n${error.message}`;
                    }
                    alert(errorMessage);
                }
            }
        });
        
        return playButton;
    },

    // Update context play button appearance
    updateContextPlayButtonAppearance(button, isPlaying, contextType) {
        if (isPlaying) {
            // Show pause icon
            const pauseIconSvg = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.7 1a.7.7 0 00-.7.7v12.6a.7.7 0 00.7.7h2.6a.7.7 0 00.7-.7V1.7a.7.7 0 00-.7-.7H2.7zm8 0a.7.7 0 00-.7.7v12.6a.7.7 0 00.7.7h2.6a.7.7 0 00.7-.7V1.7a.7.7 0 00-.7-.7h-2.6z"/>
            </svg>`;
            button.innerHTML = pauseIconSvg;
            button.title = `Pause ${contextType}`;
        } else {
            // Show play icon
            const playIconSvg = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 1.713a.7.7 0 011.05-.607l10.89 6.288a.7.7 0 010 1.212L4.05 14.894A.7.7 0 013 14.288V1.713z"/>
            </svg>`;
            button.innerHTML = playIconSvg;
            button.title = `Play ${contextType}`;
        }
        
        const svgElement = button.querySelector('svg');
        if (svgElement) svgElement.style.fill = '#fff';
    },

    // Create context-specific shuffle button
    createContextShuffleButton(contextUri, contextType) {
        const shuffleButton = document.createElement('div');
        shuffleButton.className = 'context-shuffle-button';
        shuffleButton.dataset.contextUri = contextUri;
        
        // Get current state from localStorage
        const currentState = this.getContextShuffleSetting(contextUri);
        shuffleButton.dataset.state = currentState;
        
        // Create the button content
        this.updateShuffleButtonAppearance(shuffleButton, currentState);
        
        // Click handler to toggle between enabled/disabled
        shuffleButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nextState = shuffleButton.dataset.state === 'enabled' ? 'disabled' : 'enabled';
            
            shuffleButton.dataset.state = nextState;
            this.setContextShuffleSetting(contextUri, nextState);
            this.updateShuffleButtonAppearance(shuffleButton, nextState);
            
            // If we're currently playing from this context, apply the change immediately
            if (this.currentContextUri === contextUri && this.currentPlaybackState) {
                const targetShuffle = nextState === 'enabled';
                try {
                    await SpotifyAPI.setShuffle(targetShuffle);
                    console.log(`Immediately applied context shuffle: ${nextState} for ${contextUri}`);
                } catch (error) {
                    console.error('Error applying context shuffle:', error);
                }
            }
        });
        
        return shuffleButton;
    },

    updateShuffleButtonAppearance(button, state) {
        // Create shuffle icon SVG (correct Spotify shuffle icon)
        const svg = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.151.922a.75.75 0 10-1.06 1.06L13.109 3H11.16a3.75 3.75 0 00-2.873 1.34l-6.173 7.356A2.25 2.25 0 01.39 12.5H0V14h.391a3.75 3.75 0 002.873-1.34l6.173-7.356a2.25 2.25 0 011.724-.804h1.947l-1.017 1.018a.75.75 0 001.06 1.06L15.98 3.75 13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 00.39 3.5z"/>
            <path d="M7.5 10.723l.98-1.167.957 1.14a2.25 2.25 0 001.724.804h1.947l-1.017-1.018a.75.75 0 111.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 11-1.06-1.06L13.109 13H11.16a3.75 3.75 0 01-2.873-1.34l-.787-.938z"/>
        </svg>`;
        
        if (state === 'enabled') {
            button.innerHTML = svg;
            button.title = 'Context shuffle: Enabled\\nShuffle will be enabled when playing this content';
            button.style.backgroundColor = '#1DB954';
            const svgElement = button.querySelector('svg');
            if (svgElement) svgElement.style.fill = '#fff';
        } else {
            button.innerHTML = svg;
            button.title = 'Context shuffle: Disabled\\nShuffle will be disabled when playing this content';
            button.style.backgroundColor = '#282828';
            const svgElement = button.querySelector('svg');
            if (svgElement) svgElement.style.fill = '#b3b3b3';
        }
    },

    async applyContextShuffle(contextUri) {
        const setting = this.getContextShuffleSetting(contextUri);
        const targetShuffle = setting === 'enabled';
        
        try {
            await SpotifyAPI.setShuffle(targetShuffle);
            console.log(`Applied context shuffle: ${setting} for ${contextUri}`);
        } catch (error) {
            console.error('Error applying context shuffle:', error);
        }
    },

    // Handle toggling liked/followed state
    async handleLikeToggle(itemType, itemId, iconElement, itemData = {}) {
        try {
            // Get current state from the icon
            const isCurrentlyLiked = iconElement.classList.contains('liked');
            const newState = !isCurrentlyLiked;

            // Disable the icon during the operation
            iconElement.style.pointerEvents = 'none';
            iconElement.style.opacity = '0.5';

            // Call appropriate API based on item type and new state
            let apiCall;
            switch (itemType) {
                case 'track':
                    apiCall = newState ? SpotifyAPI.saveTracks(itemId) : SpotifyAPI.unsaveTracks(itemId);
                    break;
                case 'album':
                    apiCall = newState ? SpotifyAPI.saveAlbums(itemId) : SpotifyAPI.unsaveAlbums(itemId);
                    break;
                case 'artist':
                    apiCall = newState ? SpotifyAPI.followArtists(itemId) : SpotifyAPI.unfollowArtists(itemId);
                    break;
                case 'playlist':
                    apiCall = newState ? SpotifyAPI.followPlaylist(itemId) : SpotifyAPI.unfollowPlaylist(itemId);
                    break;
                case 'podcast':
                    apiCall = newState ? SpotifyAPI.savePodcasts(itemId) : SpotifyAPI.unsavePodcasts(itemId);
                    break;
                case 'episode':
                    apiCall = newState ? SpotifyAPI.saveEpisodes(itemId) : SpotifyAPI.unsaveEpisodes(itemId);
                    break;
                case 'audiobook':
                    apiCall = newState ? SpotifyAPI.saveAudiobooks(itemId) : SpotifyAPI.unsaveAudiobooks(itemId);
                    break;
                default:
                    console.error('Unknown item type:', itemType);
                    return;
            }

            // Execute the API call
            await apiCall;

            // Update the icon state
            if (newState) {
                iconElement.classList.remove('unliked');
                iconElement.classList.add('liked');
                iconElement.title = 'Liked';
            } else {
                iconElement.classList.remove('liked');
                iconElement.classList.add('unliked');
                iconElement.title = 'Not liked';
            }

            // Update nav tree if needed (only for items that appear in nav tree)
            if (['album', 'artist', 'playlist', 'podcast', 'audiobook'].includes(itemType)) {
                this.updateNavTreeAfterToggle(itemType, itemId, newState, itemData);
            }

        } catch (error) {
            console.error('Error toggling like state:', error);
            alert('Failed to update. Please try again.');
        } finally {
            // Re-enable the icon
            iconElement.style.pointerEvents = '';
            iconElement.style.opacity = '';
        }
    },

    // Update nav tree after toggling an item
    updateNavTreeAfterToggle(itemType, itemId, isNowLiked, itemData) {
        console.log('updateNavTreeAfterToggle called:', { itemType, itemId, isNowLiked, itemData });
        
        // Map item types to their root node IDs
        const rootNodeMap = {
            'album': 'albums',
            'artist': 'artists',
            'playlist': 'playlists',
            'podcast': 'podcasts',
            'audiobook': 'audiobooks'
        };

        const rootNodeId = rootNodeMap[itemType];
        console.log('Root node ID:', rootNodeId);
        if (!rootNodeId) return;

        const rootNode = document.querySelector(`[data-node-id="${rootNodeId}"]`);
        console.log('Root node found:', !!rootNode);
        if (!rootNode) return;

        // Check if the root node has been expanded
        const childrenContainer = rootNode.querySelector('.tree-children');
        console.log('Children container found:', !!childrenContainer);
        if (!childrenContainer) return; // Never been expanded, no need to update

        // Find the specific item in the tree
        const nodeId = itemType === 'playlist' ? `playlist-${itemId}` : 
                      itemType === 'artist' ? `artist-${itemId}` :
                      itemType === 'album' ? `album-${itemId}` :
                      itemType === 'podcast' ? `podcast-${itemId}` :
                      itemType === 'audiobook' ? `audiobook-${itemId}` : null;

        console.log('Looking for node ID:', nodeId);
        if (!nodeId) return;

        const existingNode = document.querySelector(`[data-node-id="${nodeId}"]`);
        console.log('Existing node found:', !!existingNode);

        if (isNowLiked) {
            // Add the item to the tree if it doesn't exist
            if (!existingNode && itemData) {
                console.log('Adding new node to tree:', nodeId, itemData);
                const newNode = {
                    id: nodeId,
                    name: itemData.name,
                    imageUrl: itemData.imageUrl || null,
                    icon: itemType === 'playlist' ? '📋' :
                          itemType === 'artist' ? '🎤' :
                          itemType === 'album' ? '💿' :
                          itemType === 'podcast' ? '🎙️' :
                          itemType === 'audiobook' ? '📚' : '📁'
                };

                // Add type-specific properties
                if (itemType === 'playlist') newNode.playlistId = itemId;
                else if (itemType === 'artist') newNode.artistId = itemId;
                else if (itemType === 'album') newNode.albumId = itemId;
                else if (itemType === 'podcast') newNode.podcastId = itemId;
                else if (itemType === 'audiobook') newNode.audiobookId = itemId;

                const nodeElement = this.createTreeNode(newNode, 1);
                childrenContainer.appendChild(nodeElement);

                // Re-sort the nodes alphabetically (skip Liked Songs if in playlists)
                const nodes = Array.from(childrenContainer.children);
                const firstNode = nodes[0];
                const isLikedSongs = firstNode && firstNode.dataset.nodeId === 'liked-songs';
                
                const nodesToSort = isLikedSongs ? nodes.slice(1) : nodes;
                nodesToSort.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });

                // Rebuild the container
                childrenContainer.innerHTML = '';
                if (isLikedSongs) {
                    childrenContainer.appendChild(firstNode);
                }
                nodesToSort.forEach(node => childrenContainer.appendChild(node));
            } else {
                console.log('Node already exists or no itemData provided');
            }
        } else {
            // Remove the item from the tree if it exists
            if (existingNode) {
                console.log('Removing node from tree:', nodeId);
                existingNode.remove();
            } else {
                console.log('Node to remove not found in tree');
            }
        }
    },

    async loadSavedAlbums(albumsRootNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading saved albums...</div>';

        try {
            let allAlbums = [];
            let childrenContainer = albumsRootNode.querySelector('.tree-children');
            const isFirstLoad = !childrenContainer;
            
            // Create or clear the children container
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                albumsRootNode.appendChild(childrenContainer);
                
                // Show disclosure triangle
                const disclosure = albumsRootNode.querySelector('.tree-disclosure');
                if (disclosure) {
                    disclosure.style.visibility = 'visible';
                }
            } else {
                // Clear existing children for refresh
                childrenContainer.innerHTML = '';
            }
            
            const onPageLoaded = (newSavedAlbums, totalLoaded, hasMore) => {
                // Extract albums and add to the tree
                const newAlbums = newSavedAlbums.map(item => item.album).filter(album => album !== null);
                
                newAlbums.forEach(album => {
                    let imageUrl = null;
                    if (album.images && album.images.length > 0) {
                        imageUrl = album.images[album.images.length - 1]?.url || null;
                    }

                    const albumNode = {
                        id: `album-${album.id}`,
                        albumId: album.id,
                        name: album.name,
                        imageUrl: imageUrl,
                        icon: '💿'
                    };

                    const nodeElement = this.createTreeNode(albumNode, 1);
                    childrenContainer.appendChild(nodeElement);
                });
                
                // Re-sort all nodes alphabetically
                const nodes = Array.from(childrenContainer.children);
                nodes.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });
                nodes.forEach(node => childrenContainer.appendChild(node));
            };
            
            const savedAlbums = await SpotifyAPI.getSavedAlbums(50, onPageLoaded);
            
            if (!savedAlbums || savedAlbums.length === 0) {
                contentPanel.innerHTML = '<div class="empty-message">You have not saved any albums yet.</div>';
                return;
            }

            // Expand the albums node only on first load
            if (isFirstLoad && !albumsRootNode.classList.contains('expanded')) {
                this.toggleTreeNode(albumsRootNode);
            }
            
            // Show the refresh button now that children are populated
            const refreshButton = albumsRootNode.querySelector('.tree-refresh-button');
            if (refreshButton) {
                refreshButton.style.display = 'flex';
            }

            // Extract album objects from the saved albums response
            const albums = savedAlbums.map(item => item.album).filter(album => album !== null);
            allAlbums = albums;

            // Sort albums alphabetically by name
            allAlbums.sort((a, b) => a.name.localeCompare(b.name));

            // Note: Albums are already added via onPageLoaded callback
            // This section is kept for potential future use
            if (false) {
                // Add each album as a child node
                allAlbums.forEach(album => {
                    // Get the smallest image for the tree
                    let imageUrl = null;
                    if (album.images && album.images.length > 0) {
                        // Use the smallest image (last in array)
                        imageUrl = album.images[album.images.length - 1]?.url || null;
                    }

                    const albumNode = {
                        id: `album-${album.id}`,
                        albumId: album.id,
                        name: album.name,
                        imageUrl: imageUrl,
                        icon: '💿'
                    };

                    const nodeElement = this.createTreeNode(albumNode, 1);
                    childrenContainer.appendChild(nodeElement);
                });

                // Expand the albums node
                if (!albumsRootNode.classList.contains('expanded')) {
                    this.toggleTreeNode(albumsRootNode);
                }
            }

            // Display list of albums in content panel
            this.displayAlbumsList(albums);

        } catch (error) {
            console.error('Error loading saved albums:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load saved albums. Please try again.</div>';
        }
    },

    displayAlbumsList(albums) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'albums-list-container';

        const title = document.createElement('h1');
        title.className = 'albums-list-title';
        title.textContent = 'Saved Albums';
        container.appendChild(title);

        const albumsList = document.createElement('div');
        albumsList.className = 'albums-list';

        albums.forEach(album => {
            const albumItem = document.createElement('div');
            albumItem.className = 'album-list-item';

            // Album image (always show, use placeholder if needed)
            const img = document.createElement('img');
            img.className = 'album-list-image';
            img.src = this.getImageUrl(album);
            img.alt = album.name;
            albumItem.appendChild(img);

            // Album name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'album-list-name';
            nameDiv.textContent = album.name;
            albumItem.appendChild(nameDiv);

            // Artist names
            if (album.artists && album.artists.length > 0) {
                const artistsDiv = document.createElement('div');
                artistsDiv.className = 'album-list-artists';
                artistsDiv.textContent = album.artists.map(a => a.name).join(', ');
                albumItem.appendChild(artistsDiv);
            }

            // Click handler
            albumItem.addEventListener('click', () => {
                this.displayAlbumDetails(album.id);
            });

            albumsList.appendChild(albumItem);
        });

        container.appendChild(albumsList);
        contentPanel.appendChild(container);
    },

    createAlbumTrackRow(track, albumUri) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        
        // Store ID for tracking
        if (track.id) {
            row.dataset.itemId = track.id;
            row.dataset.trackId = track.id; // Also store for liked status lookup
        }
        
        // Store track index for selection and drag operations
        const trackIndex = (track.track_number || 1) - 1;
        row.dataset.trackIndex = trackIndex;
        
        // Make row draggable
        row.setAttribute('draggable', 'true');

        // Check if this is the currently playing item
        const isCurrentlyPlaying = track.id && this.isCurrentlyPlayingItem(track.id);
        if (isCurrentlyPlaying) {
            row.classList.add('currently-playing');
        }

        // Check if playable and apply grey styling
        const isPlayable = track.is_playable !== false && !(track.restrictions && track.restrictions.reason);
        const cells = [];

        // Track number (or play/pause icon if currently playing)
        const numCell = document.createElement('td');
        if (isCurrentlyPlaying) {
            numCell.className = 'track-number-cell';
            const isPlaying = this.currentPlaybackState && this.currentPlaybackState.is_playing;
            numCell.innerHTML = `<span class="play-icon-indicator">${isPlaying ? '⏸' : '▶'}</span>`;
        } else {
            numCell.textContent = (track.track_number || '').toString();
        }
        cells.push(numCell);
        row.appendChild(numCell);

        // Title
        const titleCell = document.createElement('td');
        titleCell.textContent = track.name || 'Unknown';
        if (track.explicit) {
            const explicitBadge = document.createElement('span');
            explicitBadge.className = 'explicit-badge';
            explicitBadge.textContent = '🄴';
            explicitBadge.style.marginLeft = '5px';
            titleCell.appendChild(explicitBadge);
        }
        cells.push(titleCell);
        row.appendChild(titleCell);

        // Artist (clickable)
        const artistCell = document.createElement('td');
        if (track.artists && track.artists.length > 0) {
            track.artists.forEach((artist, index) => {
                if (index > 0) {
                    artistCell.appendChild(document.createTextNode(', '));
                }
                const artistSpan = document.createElement('span');
                artistSpan.className = 'clickable-artist';
                artistSpan.textContent = artist.name;
                artistSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (artist.id) {
                        this.displayArtistDetails(artist.id);
                    }
                });
                artistCell.appendChild(artistSpan);
            });
        } else {
            artistCell.textContent = 'Unknown';
        }
        cells.push(artistCell);
        row.appendChild(artistCell);

        // Liked status (placeholder, will be updated after fetch)
        const likedCell = document.createElement('td');
        likedCell.className = 'liked-icon-cell';
        cells.push(likedCell);
        row.appendChild(likedCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = this.formatTime(track.duration_ms || 0);
        cells.push(durationCell);
        row.appendChild(durationCell);

        // Apply grey styling to all cells if not playable
        if (!isPlayable) {
            cells.forEach(cell => {
                cell.style.color = '#666';
            });
            row.style.cursor = 'not-allowed';
        }
        
        // Add drag handlers
        const itemData = {
            id: track.id,
            uri: track.uri,
            type: track.type || 'track',
            trackIndex: trackIndex,
            sourceType: 'album',
            sourceId: albumUri
        };
        
        row.addEventListener('dragstart', (e) => this.handleDragStart(e, row, itemData));
        row.addEventListener('dragend', (e) => this.handleDragEnd(e, row));

        // Row click handler to play track or toggle play/pause if currently playing
        if (isPlayable) {
            row.addEventListener('click', async (e) => {
                if (e.target.classList.contains('clickable-artist')) {
                    return; // Let the child handler handle it
                }
                
                // Handle Ctrl-click for toggle selection
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const trackNumber = track.track_number || 1;
                    this.toggleTrackSelection(row, trackNumber);
                    return;
                }
                
                // Handle Shift-click for range selection
                if (e.shiftKey) {
                    e.preventDefault();
                    const trackNumber = track.track_number || 1;
                    this.selectTrackRange(row, trackNumber);
                    return;
                }
                
                // Normal click: clear selection and play track
                this.clearTrackSelection();
                
                try {
                    // Check if this is the currently playing track at click time
                    const isCurrentlyPlayingNow = track.id && this.isCurrentlyPlayingItem(track.id);
                    if (isCurrentlyPlayingNow) {
                        // Toggle play/pause
                        if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                            await SpotifyAPI.pause();
                            console.log('Paused track:', track.name);
                        } else {
                            await SpotifyAPI.play();
                            console.log('Resumed track:', track.name);
                        }
                    } else {
                        // Play this track with position-based offset
                        const position = (track.track_number || 1) - 1; // 0-based position
                        await SpotifyAPI.playContentUri(track.uri, albumUri, null, position);
                        console.log('Playing track from album:', track.name);
                    }
                } catch (error) {
                    console.error('Error playing track:', error);
                    let errorMessage = 'Failed to play track';
                    if (error.message && error.message.includes('Restriction violated')) {
                        errorMessage = `Cannot play "${track.name}"\n\nThis track may not be available in your region, or may require a Spotify Premium subscription.`;
                    } else if (error.message && error.message.includes('NO_ACTIVE_DEVICE')) {
                        errorMessage = 'No active device found. Please select a device from the devices menu.';
                    } else if (error.message) {
                        errorMessage = `Cannot play "${track.name}"\n\n${error.message}`;
                    }
                    alert(errorMessage);
                }
            });
        }

        return row;
    },

    async displayAlbumDetails(albumId) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        // Push to history
        this.pushHistoryState({
            type: 'album',
            albumId: albumId
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading album details...</div>';

        try {
            let tbody = null;
            let durationDiv = null;
            let currentTrackIndex = 0;
            let totalDuration = 0;
            
            const onPageLoaded = (newTracks, totalLoaded, hasMore) => {
                newTracks.forEach((track) => {
                    if (!track) return;

                    const row = this.createAlbumTrackRow(track, album.uri);
                    tbody.appendChild(row);
                    currentTrackIndex++;
                    
                    totalDuration += (track.duration_ms || 0);
                });
                
                if (durationDiv) {
                    durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}${hasMore ? ' (loading...)' : ''}`;
                }
            };
            
            const album = await SpotifyAPI.getAlbum(albumId, onPageLoaded);
            
            if (!album) {
                contentPanel.innerHTML = '<div class="error">Failed to load album details.</div>';
                return;
            }

            // Fetch first artist's details for image
            let firstArtist = null;
            if (album.artists && album.artists.length > 0 && album.artists[0].id) {
                firstArtist = await SpotifyAPI.getArtist(album.artists[0].id);
            }

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'album-details-container';
            container.style.position = 'relative';

            // Header section with image and info side by side
            const headerSection = document.createElement('div');
            headerSection.className = 'album-details-header';

            // Large album image (left side) - always show with placeholder if needed
            const img = document.createElement('img');
            img.className = 'album-details-image';
            img.src = this.getImageUrl(album);
            img.alt = album.name;
            headerSection.appendChild(img);

            // Album info (right side)
            const infoSection = document.createElement('div');
            infoSection.className = 'album-details-info';

            // Album name
            const name = document.createElement('h1');
            name.className = 'album-details-name';
            name.textContent = album.name || 'Unknown Album';
            infoSection.appendChild(name);

            // Artist info with image
            if (album.artists && album.artists.length > 0) {
                const artistDiv = document.createElement('div');
                artistDiv.className = 'album-details-artist';
                artistDiv.style.cursor = 'pointer';

                // Always add artist image (use placeholder if needed)
                const artistImg = document.createElement('img');
                artistImg.className = 'album-details-artist-image';
                artistImg.src = firstArtist ? this.getImageUrl(firstArtist) : this.placeholderImage;
                artistImg.alt = firstArtist ? firstArtist.name : 'Artist';
                artistDiv.appendChild(artistImg);

                const artistName = document.createElement('span');
                artistName.className = 'album-details-artist-name';
                artistName.textContent = album.artists.map(a => a.name).join(', ');
                artistDiv.appendChild(artistName);
                
                // Click handler to navigate to artist details
                artistDiv.addEventListener('click', () => {
                    if (album.artists[0].id) {
                        this.displayArtistDetails(album.artists[0].id);
                    }
                });

                infoSection.appendChild(artistDiv);
            }

            // Release year
            if (album.release_date) {
                const releaseYearDiv = document.createElement('div');
                releaseYearDiv.className = 'album-details-release-year';
                const year = album.release_date.split('-')[0];
                releaseYearDiv.textContent = year;
                infoSection.appendChild(releaseYearDiv);
            }

            // Track count
            if (album.total_tracks !== null && album.total_tracks !== undefined) {
                const trackCountDiv = document.createElement('div');
                trackCountDiv.className = 'album-details-track-count';
                trackCountDiv.textContent = `${album.total_tracks} ${album.total_tracks === 1 ? 'track' : 'tracks'}`;
                infoSection.appendChild(trackCountDiv);
            }

            // Total duration (initial from first page)
            if (album.tracks && album.tracks.items) {
                totalDuration = album.tracks.items.reduce((sum, track) => sum + (track.duration_ms || 0), 0);
                durationDiv = document.createElement('div');
                durationDiv.className = 'album-details-duration';
                const hasMore = album.tracks.next !== null;
                durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}${hasMore ? ' (loading...)' : ''}`;
                infoSection.appendChild(durationDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add liked/saved icon in top-right
            const likedIconTopRight = this.createLikedIcon(false, 'liked-icon-top-right', 'album', album.id, {
                name: album.name,
                imageUrl: album.images && album.images.length > 0 ? album.images[0]?.url : null
            });
            container.appendChild(likedIconTopRight);
            
            // Fetch album saved status in background
            (async () => {
                try {
                    const savedStatuses = await SpotifyAPI.checkLikedAlbums([album.id]);
                    const icon = container.querySelector('.liked-icon-top-right');
                    if (icon && savedStatuses.length > 0) {
                        icon.className = `liked-icon ${savedStatuses[0] ? 'liked' : 'unliked'} liked-icon-top-right`;
                        icon.title = savedStatuses[0] ? 'Saved' : 'Not saved';
                    }
                } catch (error) {
                    console.error('Error fetching album saved status:', error);
                }
            })();

            // Tracks table
            if (album.tracks && album.tracks.items && album.tracks.items.length > 0) {
                // Add context-specific play button (pass tracks for finding first playable)
                const playButton = this.createContextPlayButton(album.uri, 'album', album.tracks.items);
                container.appendChild(playButton);
                
                // Add context-specific shuffle button below play button
                const shuffleButton = this.createContextShuffleButton(album.uri, 'album');
                container.appendChild(shuffleButton);
                const tracksSection = document.createElement('div');
                tracksSection.className = 'album-details-tracks-section';

                const tracksTable = document.createElement('table');
                tracksTable.className = 'album-tracks-table';

                // Table header
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                
                const headers = [
                    { name: '#', width: 50 },
                    { name: 'Title', width: 300 },
                    { name: 'Artist', width: 200 },
                    { name: 'Liked', width: 60 },
                    { name: 'Duration', width: 100 }
                ];

                headers.forEach((header, index) => {
                    const th = document.createElement('th');
                    th.textContent = header.name;
                    th.style.width = header.width + 'px';
                    
                    // Add resize handle (except for last column)
                    if (index < headers.length - 1) {
                        const resizeHandle = document.createElement('div');
                        resizeHandle.className = 'resize-handle';
                        resizeHandle.addEventListener('mousedown', (e) => {
                            this.initColumnResize(e, th);
                        });
                        th.appendChild(resizeHandle);
                    }
                    
                    headerRow.appendChild(th);
                });

                thead.appendChild(headerRow);
                tracksTable.appendChild(thead);

                // Table body
                tbody = document.createElement('tbody');

                album.tracks.items.forEach((track) => {
                    if (!track) return;

                    const row = this.createAlbumTrackRow(track, album.uri);
                    tbody.appendChild(row);
                    currentTrackIndex++;
                });

                tracksTable.appendChild(tbody);
                tracksSection.appendChild(tracksTable);
                container.appendChild(tracksSection);
                
                // Fetch liked status for all tracks in background
                (async () => {
                    try {
                        // Collect all track IDs from current tracks
                        const trackIds = album.tracks.items
                            .filter(track => track && track.id)
                            .map(track => track.id);
                        
                        if (trackIds.length > 0) {
                            const likedStatuses = await SpotifyAPI.checkLikedTracks(trackIds);
                            
                            // Update liked icons in rows
                            const rows = tbody.querySelectorAll('tr');
                            let statusIndex = 0;
                            rows.forEach((row) => {
                                const trackId = row.dataset.trackId;
                                if (trackId && statusIndex < likedStatuses.length) {
                                    const likedCell = row.querySelector('.liked-icon-cell');
                                    if (likedCell) {
                                        likedCell.innerHTML = '';
                                        const likedIcon = this.createLikedIcon(likedStatuses[statusIndex], '', 'track', trackId);
                                        likedCell.appendChild(likedIcon);
                                    }
                                    statusIndex++;
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching track liked statuses:', error);
                    }
                })();
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying album details:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load album details. Please try again.</div>';
        }
    },

    initColumnResize(e, th) {
        e.preventDefault();
        
        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        
        const doDrag = (e) => {
            const newWidth = startWidth + (e.pageX - startX);
            if (newWidth > 50) { // Minimum column width
                th.style.width = newWidth + 'px';
            }
        };
        
        const stopDrag = () => {
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
        };
        
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    },

    formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    },

    async displayNewPlaylistForm(prePopulatedItems = []) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'new-playlist-container';

        // Title
        const title = document.createElement('h1');
        title.className = 'new-playlist-title';
        title.textContent = prePopulatedItems.length > 0 ? 'Create Playlist with Tracks' : 'Create New Playlist';
        container.appendChild(title);

        // Form
        const form = document.createElement('div');
        form.className = 'new-playlist-form';

        // Image upload section
        const imageSection = document.createElement('div');
        imageSection.className = 'new-playlist-image-section';

        const imagePreview = document.createElement('div');
        imagePreview.className = 'new-playlist-image-preview';
        imagePreview.innerHTML = '<span class="placeholder-icon">📋</span>';
        imagePreview.title = 'Click to select image or drag & drop';
        
        let selectedImageFile = null;
        let croppedImageBlob = null;
        let cropData = { isDragging: false, dragHappened: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0, scale: 1 };
        
        // Process and display image with cropping UI
        const processImage = async (file) => {
            const img = new Image();
            const reader = new FileReader();
            
            reader.onload = (e) => {
                img.onload = async () => {
                    const isSquare = img.width === img.height;
                    
                    if (isSquare) {
                        // Square image - just show preview and process
                        imagePreview.style.backgroundImage = `url(${e.target.result})`;
                        imagePreview.style.backgroundSize = 'cover';
                        imagePreview.style.backgroundPosition = 'center';
                        imagePreview.innerHTML = '';
                        
                        // Process and compress
                        croppedImageBlob = await this.cropAndCompressImage(img, 0, 0, img.width, img.height);
                    } else {
                        // Non-square image - show crop UI
                        imagePreview.innerHTML = '';
                        
                        const imgElement = document.createElement('img');
                        imgElement.src = e.target.result;
                        imgElement.className = 'crop-image';
                        imagePreview.appendChild(imgElement);
                        
                        const cropOverlay = document.createElement('div');
                        cropOverlay.className = 'crop-overlay';
                        imagePreview.appendChild(cropOverlay);
                        
                        const cropInfo = document.createElement('div');
                        cropInfo.className = 'crop-info';
                        cropInfo.textContent = 'Drag to position image';
                        imagePreview.appendChild(cropInfo);
                        
                        // Scale image so shortest dimension is 300px
                        const minDim = Math.min(img.width, img.height);
                        cropData.scale = 300 / minDim;
                        const displayWidth = img.width * cropData.scale;
                        const displayHeight = img.height * cropData.scale;
                        
                        imgElement.style.width = displayWidth + 'px';
                        imgElement.style.height = displayHeight + 'px';
                        
                        // Calculate initial centered position
                        cropData.offsetX = displayWidth > 300 ? (300 - displayWidth) / 2 : 0;
                        cropData.offsetY = displayHeight > 300 ? (300 - displayHeight) / 2 : 0;
                        imgElement.style.left = cropData.offsetX + 'px';
                        imgElement.style.top = cropData.offsetY + 'px';
                        
                        // Initial crop (convert display coordinates back to original image coordinates)
                        const cropX = -cropData.offsetX / cropData.scale;
                        const cropY = -cropData.offsetY / cropData.scale;
                        croppedImageBlob = await this.cropAndCompressImage(img, cropX, cropY, minDim, minDim);
                        
                        // Setup drag handlers
                        const startDrag = (clientX, clientY) => {
                            cropData.isDragging = true;
                            cropData.dragHappened = false;
                            cropData.startX = clientX - cropData.offsetX;
                            cropData.startY = clientY - cropData.offsetY;
                            imgElement.style.cursor = 'grabbing';
                        };
                        
                        const doDrag = (clientX, clientY) => {
                            if (!cropData.isDragging) return;
                            
                            const newX = clientX - cropData.startX;
                            const newY = clientY - cropData.startY;
                            
                            // Mark that dragging actually occurred
                            if (newX !== cropData.offsetX || newY !== cropData.offsetY) {
                                cropData.dragHappened = true;
                            }
                            
                            // Constrain dragging so you can't drag too far (using display dimensions)
                            const displayWidth = img.width * cropData.scale;
                            const displayHeight = img.height * cropData.scale;
                            const maxX = 0;
                            const minX = 300 - displayWidth;
                            const maxY = 0;
                            const minY = 300 - displayHeight;
                            
                            cropData.offsetX = Math.max(minX, Math.min(maxX, newX));
                            cropData.offsetY = Math.max(minY, Math.min(maxY, newY));
                            
                            imgElement.style.left = cropData.offsetX + 'px';
                            imgElement.style.top = cropData.offsetY + 'px';
                        };
                        
                        const endDrag = async () => {
                            if (!cropData.isDragging) return;
                            cropData.isDragging = false;
                            imgElement.style.cursor = 'grab';
                            
                            // Update cropped image (convert display coordinates back to original image coordinates)
                            const minDim = Math.min(img.width, img.height);
                            const cropX = Math.round(-cropData.offsetX / cropData.scale);
                            const cropY = Math.round(-cropData.offsetY / cropData.scale);
                            croppedImageBlob = await this.cropAndCompressImage(img, cropX, cropY, minDim, minDim);
                        };
                        
                        // Mouse events
                        imgElement.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                            startDrag(e.clientX, e.clientY);
                        });
                        
                        document.addEventListener('mousemove', (e) => {
                            doDrag(e.clientX, e.clientY);
                        });
                        
                        document.addEventListener('mouseup', endDrag);
                        
                        // Touch events
                        imgElement.addEventListener('touchstart', (e) => {
                            e.preventDefault();
                            startDrag(e.touches[0].clientX, e.touches[0].clientY);
                        });
                        
                        document.addEventListener('touchmove', (e) => {
                            if (cropData.isDragging) {
                                doDrag(e.touches[0].clientX, e.touches[0].clientY);
                            }
                        });
                        
                        document.addEventListener('touchend', endDrag);
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        };
        
        // File input (hidden)
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/jpeg,image/png';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                selectedImageFile = file;
                processImage(file);
            }
        });
        
        // Click to select
        imagePreview.addEventListener('click', () => {
            // Don't trigger file select if we just finished dragging
            if (cropData.dragHappened) {
                cropData.dragHappened = false;
                return;
            }
            fileInput.click();
        });
        
        // Drag and drop
        imagePreview.addEventListener('dragover', (e) => {
            e.preventDefault();
            imagePreview.style.opacity = '0.7';
        });
        
        imagePreview.addEventListener('dragleave', () => {
            imagePreview.style.opacity = '1';
        });
        
        imagePreview.addEventListener('drop', (e) => {
            e.preventDefault();
            imagePreview.style.opacity = '1';
            
            const file = e.dataTransfer.files[0];
            if (file && file.type.match('image.*')) {
                selectedImageFile = file;
                processImage(file);
            }
        });
        
        imageSection.appendChild(imagePreview);
        imageSection.appendChild(fileInput);

        // Create a fields container for name and description
        const fieldsContainer = document.createElement('div');
        fieldsContainer.className = 'form-fields-container';

        // Name input
        const nameGroup = document.createElement('div');
        nameGroup.className = 'form-group';
        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'Playlist Name';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'form-input';
        nameInput.placeholder = 'Enter playlist name';
        
        // Get next available playlist number
        const nextNumber = await this.getNextPlaylistNumber();
        nameInput.value = `new playlist #${nextNumber}`;
        
        nameGroup.appendChild(nameLabel);
        nameGroup.appendChild(nameInput);
        fieldsContainer.appendChild(nameGroup);

        // Description input
        const descGroup = document.createElement('div');
        descGroup.className = 'form-group';
        const descLabel = document.createElement('label');
        descLabel.textContent = 'Description (optional)';
        const descTextarea = document.createElement('textarea');
        descTextarea.className = 'form-textarea';
        descTextarea.placeholder = 'Add an optional description';
        descTextarea.rows = 4;
        descGroup.appendChild(descLabel);
        descGroup.appendChild(descTextarea);
        fieldsContainer.appendChild(descGroup);

        // Top row container with image and fields side by side
        const topRow = document.createElement('div');
        topRow.className = 'form-top-row';
        topRow.appendChild(imageSection);
        topRow.appendChild(fieldsContainer);
        form.appendChild(topRow);

        // Bottom row container for info and buttons
        const bottomRow = document.createElement('div');
        bottomRow.className = 'form-bottom-row';

        // If we have pre-populated items, show them in a table
        if (prePopulatedItems.length > 0) {
            const itemsSection = document.createElement('div');
            itemsSection.className = 'new-playlist-items-section';
            
            const itemsTitle = document.createElement('div');
            itemsTitle.className = 'new-playlist-items-title';
            itemsTitle.textContent = `${prePopulatedItems.length} item${prePopulatedItems.length > 1 ? 's' : ''} to add:`;
            itemsSection.appendChild(itemsTitle);
            
            // Create table for tracks
            const tracksTable = document.createElement('table');
            tracksTable.className = 'new-playlist-tracks-table';
            
            // Table header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            const headers = ['#', 'Title', 'Artist', 'Album', 'Duration'];
            headers.forEach(headerText => {
                const th = document.createElement('th');
                th.textContent = headerText;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            tracksTable.appendChild(thead);
            
            // Table body with tracks
            const tbody = document.createElement('tbody');
            prePopulatedItems.forEach((item, index) => {
                const row = document.createElement('tr');
                
                // Track number
                const numCell = document.createElement('td');
                numCell.textContent = (index + 1).toString();
                row.appendChild(numCell);
                
                // Title
                const titleCell = document.createElement('td');
                titleCell.textContent = item.name || 'Unknown';
                if (item.explicit) {
                    const explicitBadge = document.createElement('span');
                    explicitBadge.className = 'explicit-badge';
                    explicitBadge.textContent = '🄴';
                    explicitBadge.style.marginLeft = '5px';
                    titleCell.appendChild(explicitBadge);
                }
                row.appendChild(titleCell);
                
                // Artist
                const artistCell = document.createElement('td');
                if (item.artists && item.artists.length > 0) {
                    artistCell.textContent = item.artists.map(a => a.name).join(', ');
                } else {
                    artistCell.textContent = 'Unknown';
                }
                row.appendChild(artistCell);
                
                // Album
                const albumCell = document.createElement('td');
                albumCell.textContent = item.album?.name || 'Unknown';
                row.appendChild(albumCell);
                
                // Duration
                const durationCell = document.createElement('td');
                durationCell.textContent = item.durationText || '';
                row.appendChild(durationCell);
                
                tbody.appendChild(row);
            });
            tracksTable.appendChild(tbody);
            
            itemsSection.appendChild(tracksTable);
            bottomRow.appendChild(itemsSection);
        }

        // Info text (only show if no pre-populated items)
        if (prePopulatedItems.length === 0) {
            const infoText = document.createElement('div');
            infoText.className = 'new-playlist-info';
            infoText.innerHTML = '💡 <strong>Tip:</strong> After creating your playlist, you can add tracks and episodes by dragging them from the content pane onto the playlist in the navigation tree.';
            bottomRow.appendChild(infoText);
        }

        // Buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'form-buttons';
        
        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn btn-secondary';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', async () => {
            const playlistsRootNode = document.querySelector('[data-node-id="playlists"]');
            if (playlistsRootNode) {
                await this.loadUserPlaylists(playlistsRootNode);
            }
        });
        
        const okButton = document.createElement('button');
        okButton.className = 'btn btn-primary';
        okButton.textContent = 'Create Playlist';
        okButton.addEventListener('click', async () => {
            const playlistName = nameInput.value.trim();
            if (!playlistName) {
                alert('Please enter a playlist name');
                return;
            }
            
            try {
                okButton.disabled = true;
                okButton.textContent = 'Creating...';
                
                // Create the playlist
                const description = descTextarea.value.trim() || undefined;
                const newPlaylist = await SpotifyAPI.createPlaylist(playlistName, description);
                
                // Upload image if one was selected
                if (croppedImageBlob && newPlaylist && newPlaylist.id) {
                    try {
                        await SpotifyAPI.uploadPlaylistCoverImage(newPlaylist.id, croppedImageBlob);
                    } catch (error) {
                        console.error('Error uploading playlist cover:', error);
                        // Don't fail the whole operation if image upload fails
                    }
                }
                
                // Add pre-populated items if any
                if (prePopulatedItems.length > 0 && newPlaylist && newPlaylist.id) {
                    try {
                        const uris = prePopulatedItems.map(item => item.uri);
                        await SpotifyAPI.addTracksToPlaylist(newPlaylist.id, uris);
                    } catch (error) {
                        console.error('Error adding tracks to new playlist:', error);
                        alert('Playlist created but failed to add tracks. You can add them manually.');
                    }
                }
                
                // Reload playlists
                const playlistsRootNode = document.querySelector('[data-node-id="playlists"]');
                if (playlistsRootNode) {
                    await this.loadUserPlaylists(playlistsRootNode);
                }
                
                // If items were added, display the new playlist
                if (prePopulatedItems.length > 0 && newPlaylist && newPlaylist.id) {
                    await this.displayPlaylistDetails(newPlaylist.id);
                }
            } catch (error) {
                console.error('Error creating playlist:', error);
                alert('Failed to create playlist. Please try again.');
                okButton.disabled = false;
                okButton.textContent = 'Create Playlist';
            }
        });
        
        buttonGroup.appendChild(cancelButton);
        buttonGroup.appendChild(okButton);
        bottomRow.appendChild(buttonGroup);
        form.appendChild(bottomRow);

        container.appendChild(form);
        contentPanel.appendChild(container);
    },

    async getNextPlaylistNumber() {
        try {
            // Get user's playlists
            const playlists = await SpotifyAPI.getUserPlaylists(50);
            if (!playlists) return 1;
            
            // Find all playlist names matching "new playlist #X" pattern
            const pattern = /^new playlist #(\d+)$/i;
            const numbers = playlists
                .map(p => {
                    const match = p.name.match(pattern);
                    return match ? parseInt(match[1]) : 0;
                })
                .filter(n => n > 0);
            
            if (numbers.length === 0) return 1;
            
            // Find the first missing number in the sequence
            numbers.sort((a, b) => a - b);
            for (let i = 1; i <= numbers.length + 1; i++) {
                if (!numbers.includes(i)) {
                    return i;
                }
            }
            
            return 1;
        } catch (error) {
            console.error('Error getting next playlist number:', error);
            return 1;
        }
    },

    async cropAndCompressImage(img, cropX, cropY, cropWidth, cropHeight) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Target size is 300x300
            const targetSize = 300;
            canvas.width = targetSize;
            canvas.height = targetSize;
            
            // Draw the cropped portion of the image scaled to 300x300
            ctx.drawImage(
                img,
                cropX, cropY, cropWidth, cropHeight,  // Source rectangle
                0, 0, targetSize, targetSize          // Destination rectangle
            );
            
            // Try to compress to under 50KB
            let quality = 0.95;
            const tryCompress = () => {
                canvas.toBlob((blob) => {
                    if (blob.size <= 50 * 1024 || quality <= 0.3) {
                        // Either under 50KB or we've compressed enough
                        resolve(blob);
                    } else {
                        // Try again with lower quality
                        quality -= 0.1;
                        tryCompress();
                    }
                }, 'image/jpeg', quality);
            };
            
            tryCompress();
        });
    },

    async loadUserPlaylists(playlistsRootNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading playlists...</div>';

        try {
            let allPlaylists = [];
            let childrenContainer = playlistsRootNode.querySelector('.tree-children');
            const isFirstLoad = !childrenContainer;
            
            // Create or clear the children container
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                playlistsRootNode.appendChild(childrenContainer);
                
                // Show disclosure triangle
                const disclosure = playlistsRootNode.querySelector('.tree-disclosure');
                if (disclosure) {
                    disclosure.style.visibility = 'visible';
                }
            } else {
                // Clear existing children for refresh
                childrenContainer.innerHTML = '';
            }
            
            // Add "Liked Songs" as the first item
            const likedSongsNode = {
                id: 'liked-songs',
                name: 'Liked Songs',
                icon: '💜',
                isLikedSongs: true
            };
            const likedSongsElement = this.createTreeNode(likedSongsNode, 1);
            childrenContainer.appendChild(likedSongsElement);
            
            const onPageLoaded = (newPlaylists, totalLoaded, hasMore) => {
                // Filter out the shadow playlist
                const filteredPlaylists = newPlaylists.filter(playlist => 
                    playlist.name !== 'DONOTTOUCH_LikedSongsShadow'
                );
                
                // Add new playlists to the tree (after Liked Songs)
                filteredPlaylists.forEach(playlist => {
                    let imageUrl = null;
                    if (playlist.images && playlist.images.length > 0) {
                        imageUrl = playlist.images[playlist.images.length - 1]?.url || null;
                    }

                    const playlistNode = {
                        id: `playlist-${playlist.id}`,
                        playlistId: playlist.id,
                        name: playlist.name,
                        imageUrl: imageUrl,
                        icon: '📋'
                    };

                    const nodeElement = this.createTreeNode(playlistNode, 1, playlist);
                    childrenContainer.appendChild(nodeElement);
                });
                
                // Re-sort all nodes alphabetically (except Liked Songs)
                const nodes = Array.from(childrenContainer.children);
                const likedSongsNode = nodes.find(node => node.querySelector('.tree-name')?.textContent === 'Liked Songs');
                const otherNodes = nodes.filter(node => node.querySelector('.tree-name')?.textContent !== 'Liked Songs');
                
                otherNodes.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });
                
                // Clear and re-add: Liked Songs first, then sorted playlists
                childrenContainer.innerHTML = '';
                if (likedSongsNode) childrenContainer.appendChild(likedSongsNode);
                otherNodes.forEach(node => childrenContainer.appendChild(node));
                
                // Update the content panel display with all loaded playlists so far
                allPlaylists = allPlaylists.concat(filteredPlaylists);
                allPlaylists.sort((a, b) => a.name.localeCompare(b.name));
                this.displayPlaylistsList(allPlaylists);
            };
            
            const playlists = await SpotifyAPI.getUserPlaylists(50, onPageLoaded);
            
            allPlaylists = playlists || [];
            
            // Check if shadow playlist exists in the full list
            const shadowPlaylist = allPlaylists.find(p => p.name === 'DONOTTOUCH_LikedSongsShadow');
            const enabled = this.getSetting('allowLikedSongsContinuousPlayback', true);
            
            if (shadowPlaylist) {
                // Found shadow playlist, initialize if not already done
                if (!this.shadowPlaylist.id) {
                    this.shadowPlaylist.id = shadowPlaylist.id;
                    this.shadowPlaylist.uri = shadowPlaylist.uri;
                    console.log('Found shadow playlist in user playlists');
                }
            } else if (enabled && !this.shadowPlaylist.id) {
                // Shadow playlist doesn't exist but feature is enabled - create it now
                console.log('Shadow playlist not found, creating now...');
                
                // Fetch liked songs, create shadow playlist, and sync
                (async () => {
                    try {
                        const likedSongsData = await SpotifyAPI.getLikedSongs(50);
                        const likedSongsUris = likedSongsData?.items
                            ?.map(item => item.track?.uri)
                            .filter(uri => uri) || [];
                        
                        if (likedSongsUris.length > 0) {
                            const playlist = await SpotifyAPI.createShadowPlaylist();
                            await SpotifyAPI.syncShadowPlaylist(playlist.id, likedSongsUris, []);
                            
                            this.shadowPlaylist.id = playlist.id;
                            this.shadowPlaylist.uri = playlist.uri;
                            this.shadowPlaylist.trackUris = likedSongsUris;
                            this.shadowPlaylist.lastSyncTime = Date.now();
                            console.log('Shadow playlist created and synced at startup');
                        }
                    } catch (error) {
                        console.error('Error creating shadow playlist at startup:', error);
                    }
                })();
            }
            
            // Filter out shadow playlist from final results
            allPlaylists = allPlaylists.filter(playlist => 
                playlist.name !== 'DONOTTOUCH_LikedSongsShadow'
            );

            // Expand the playlists node only on first load
            if (isFirstLoad && !playlistsRootNode.classList.contains('expanded')) {
                this.toggleTreeNode(playlistsRootNode);
            }
            
            // Show the refresh button now that children are populated
            const refreshButton = playlistsRootNode.querySelector('.tree-refresh-button');
            if (refreshButton) {
                refreshButton.style.display = 'flex';
            }

            // Sort playlists alphabetically by name
            allPlaylists.sort((a, b) => a.name.localeCompare(b.name));

            // Note: Playlists are already added via onPageLoaded callback
            // This section is kept for potential future use
            if (false) {
            allPlaylists.forEach(playlist => {
                // Get the smallest image for the tree
                let imageUrl = null;
                if (playlist.images && playlist.images.length > 0) {
                    // Use the smallest image (last in array)
                    imageUrl = playlist.images[playlist.images.length - 1]?.url || null;
                }

                const playlistNode = {
                    id: `playlist-${playlist.id}`,
                    playlistId: playlist.id,
                    name: playlist.name,
                    imageUrl: imageUrl,
                    icon: '📋'
                };

                const nodeElement = this.createTreeNode(playlistNode, 1);
                childrenContainer.appendChild(nodeElement);
            });
            }

            // Display list of playlists in content panel
            this.displayPlaylistsList(allPlaylists);

        } catch (error) {
            console.error('Error loading playlists:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load playlists. Please try again.</div>';
        }
    },

    displayPlaylistsList(playlists) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'playlists-list-container';

        const title = document.createElement('h1');
        title.className = 'playlists-list-title';
        title.textContent = 'Your Playlists';
        container.appendChild(title);

        const playlistsList = document.createElement('div');
        playlistsList.className = 'playlists-list';

        // Add Liked Songs first
        const likedSongsItem = document.createElement('div');
        likedSongsItem.className = 'playlist-list-item';

        // Icon
        const likedIcon = document.createElement('div');
        likedIcon.className = 'playlist-list-image liked-songs-list-icon';
        likedIcon.innerHTML = '💜';
        likedSongsItem.appendChild(likedIcon);

        // Name
        const likedNameDiv = document.createElement('div');
        likedNameDiv.className = 'playlist-list-name';
        likedNameDiv.textContent = 'Liked Songs';
        likedSongsItem.appendChild(likedNameDiv);

        // Click handler
        likedSongsItem.addEventListener('click', () => {
            this.displayLikedSongsDetails();
        });

        playlistsList.appendChild(likedSongsItem);

        // Add regular playlists (already sorted)
        playlists.forEach(playlist => {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'playlist-list-item';

            // Playlist image (always show, use placeholder if needed)
            const img = document.createElement('img');
            img.className = 'playlist-list-image';
            img.src = this.getImageUrl(playlist);
            img.alt = playlist.name;
            playlistItem.appendChild(img);

            // Playlist name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'playlist-list-name';
            nameDiv.textContent = playlist.name;
            playlistItem.appendChild(nameDiv);

            // Track count
            if (playlist.tracks && playlist.tracks.total !== null && playlist.tracks.total !== undefined) {
                const tracksDiv = document.createElement('div');
                tracksDiv.className = 'playlist-list-tracks';
                tracksDiv.textContent = `${playlist.tracks.total} ${playlist.tracks.total === 1 ? 'track' : 'tracks'}`;
                playlistItem.appendChild(tracksDiv);
            }

            // Click handler
            playlistItem.addEventListener('click', () => {
                this.displayPlaylistDetails(playlist.id);
            });

            playlistsList.appendChild(playlistItem);
        });

        container.appendChild(playlistsList);
        contentPanel.appendChild(container);
    },

    createLikedSongTrackRow(track, trackNumber, addedAt) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.setAttribute('data-track-index', trackNumber - 1);
        
        // Store ID for tracking
        if (track.id) {
            row.dataset.itemId = track.id;
        }

        // Check if this is the currently playing item
        const isCurrentlyPlaying = track.id && this.isCurrentlyPlayingItem(track.id);
        if (isCurrentlyPlaying) {
            row.classList.add('currently-playing');
        }

        // Check if playable and apply grey styling
        const isPlayable = track.is_playable !== false && !(track.restrictions && track.restrictions.reason);
        const cells = [];

        // Track number (or play icon if currently playing)
        const numCell = document.createElement('td');
        if (isCurrentlyPlaying) {
            numCell.className = 'track-number-cell';
            numCell.innerHTML = '<span class="play-icon-indicator">▶</span>';
        } else {
            numCell.textContent = trackNumber.toString();
        }
        cells.push(numCell);
        row.appendChild(numCell);

        // Title
        const titleCell = document.createElement('td');
        titleCell.textContent = track.name || 'Unknown';
        if (track.explicit) {
            const explicitBadge = document.createElement('span');
            explicitBadge.className = 'explicit-badge';
            explicitBadge.textContent = '🄴';
            explicitBadge.style.marginLeft = '5px';
            titleCell.appendChild(explicitBadge);
        }
        cells.push(titleCell);
        row.appendChild(titleCell);

        // Artist (clickable)
        const artistCell = document.createElement('td');
        if (track.artists && track.artists.length > 0) {
            track.artists.forEach((artist, index) => {
                if (index > 0) {
                    artistCell.appendChild(document.createTextNode(', '));
                }
                const artistSpan = document.createElement('span');
                artistSpan.className = 'clickable-artist';
                artistSpan.textContent = artist.name;
                artistSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (artist.id) {
                        this.displayArtistDetails(artist.id);
                    }
                });
                artistCell.appendChild(artistSpan);
            });
        } else {
            artistCell.textContent = 'Unknown';
        }
        cells.push(artistCell);
        row.appendChild(artistCell);

        // Album (clickable)
        const albumCell = document.createElement('td');
        if (track.album && track.album.id) {
            const albumSpan = document.createElement('span');
            albumSpan.className = 'clickable-album';
            albumSpan.textContent = track.album.name || 'Unknown';
            albumSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.displayAlbumDetails(track.album.id);
            });
            albumCell.appendChild(albumSpan);
        } else {
            albumCell.textContent = track.album?.name || 'Unknown';
        }
        cells.push(albumCell);
        row.appendChild(albumCell);

        // Added date
        const addedCell = document.createElement('td');
        const date = new Date(addedAt);
        addedCell.textContent = date.toLocaleDateString();
        cells.push(addedCell);
        row.appendChild(addedCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = this.formatTime(track.duration_ms || 0);
        cells.push(durationCell);
        row.appendChild(durationCell);

        // Delete button
        const deleteCell = document.createElement('td');
        deleteCell.className = 'delete-track-cell';
        deleteCell.style.textAlign = 'center';
        deleteCell.style.cursor = 'pointer';
        deleteCell.innerHTML = '🗑️';
        deleteCell.title = 'Unlike this track';
        deleteCell.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await SpotifyAPI.unsaveTracks([track.id]);
                row.remove();
                console.log('Unliked track:', track.name);
            } catch (error) {
                console.error('Error unliking track:', error);
                alert('Failed to unlike track. Please try again.');
            }
        });
        cells.push(deleteCell);
        row.appendChild(deleteCell);

        // Apply grey styling to all cells if not playable
        if (!isPlayable) {
            cells.forEach(cell => {
                cell.style.color = '#666';
            });
            row.style.cursor = 'not-allowed';
        }

        // Row click handler to play track or toggle play/pause if currently playing
        if (isPlayable) {
            row.addEventListener('click', async (e) => {
                if (e.target.classList.contains('clickable-artist') || 
                    e.target.classList.contains('clickable-album') ||
                    e.target.classList.contains('delete-track-cell') ||
                    e.target.closest('.delete-track-cell')) {
                    return; // Let the child handler handle it
                }
                
                // Handle Ctrl-click for toggle selection
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.toggleTrackSelection(row, trackNumber);
                    return;
                }
                
                // Handle Shift-click for range selection
                if (e.shiftKey) {
                    e.preventDefault();
                    this.selectTrackRange(row, trackNumber);
                    return;
                }
                
                // Normal click: clear selection and play track
                this.clearTrackSelection();
                
                try {
                    // Check if this is the currently playing track at click time
                    const isCurrentlyPlayingNow = track.id && this.isCurrentlyPlayingItem(track.id);
                    if (isCurrentlyPlayingNow) {
                        // Toggle play/pause
                        if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                            await SpotifyAPI.pause();
                            console.log('Paused track:', track.name);
                        } else {
                            await SpotifyAPI.play();
                            console.log('Resumed track:', track.name);
                        }
                    } else {
                        // Play this track with shadow playlist context if available
                        const contextUri = this.shadowPlaylist.uri || null;
                        if (contextUri) {
                            // Find the position of this track in the shadow playlist
                            const trackIndex = this.shadowPlaylist.trackUris.indexOf(track.uri);
                            if (trackIndex !== -1) {
                                await SpotifyAPI.playContentUri(track.uri, contextUri, null, trackIndex);
                                console.log('Playing track with context:', track.name);
                            } else {
                                // Track not found in shadow playlist, play without context
                                await SpotifyAPI.playContentUri(track.uri);
                                console.log('Playing track (not in shadow playlist):', track.name);
                            }
                        } else {
                            // No shadow playlist, play without context
                            await SpotifyAPI.playContentUri(track.uri);
                            console.log('Playing track:', track.name);
                        }
                    }
                } catch (error) {
                    console.error('Error playing track:', error);
                }
            });
        }

        return row;
    },

    createPlaylistTrackRow(track, trackNumber, playlistUri, playlistId, isOwned) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.setAttribute('draggable', 'true');
        row.setAttribute('data-track-index', trackNumber - 1);
        row.setAttribute('data-track-number', trackNumber);
        
        // Store ID and URI for tracking and drag operations
        if (track.id) {
            row.dataset.itemId = track.id;
            row.dataset.trackId = track.id; // Also store for liked status lookup
        }
        row.dataset.uri = track.uri;
        row.dataset.itemType = track.type || 'track';

        // Check if this is the currently playing item
        const isCurrentlyPlaying = track.id && this.isCurrentlyPlayingItem(track.id);
        if (isCurrentlyPlaying) {
            row.classList.add('currently-playing');
        }

        // Check if playable and apply grey styling
        const isPlayable = track.is_playable !== false && !(track.restrictions && track.restrictions.reason);
        const cells = [];

        // Track number (or play icon if currently playing)
        const numCell = document.createElement('td');
        if (isCurrentlyPlaying) {
            numCell.className = 'track-number-cell';
            numCell.innerHTML = '<span class="play-icon-indicator">▶</span>';
        } else {
            numCell.textContent = trackNumber.toString();
        }
        cells.push(numCell);
        row.appendChild(numCell);

        // Title
        const titleCell = document.createElement('td');
        titleCell.textContent = track.name || 'Unknown';
        if (track.explicit) {
            const explicitBadge = document.createElement('span');
            explicitBadge.className = 'explicit-badge';
            explicitBadge.textContent = '🄴';
            explicitBadge.style.marginLeft = '5px';
            titleCell.appendChild(explicitBadge);
        }
        cells.push(titleCell);
        row.appendChild(titleCell);

        // Artist (clickable)
        const artistCell = document.createElement('td');
        if (track.artists && track.artists.length > 0) {
            track.artists.forEach((artist, index) => {
                if (index > 0) {
                    artistCell.appendChild(document.createTextNode(', '));
                }
                const artistSpan = document.createElement('span');
                artistSpan.className = 'clickable-artist';
                artistSpan.textContent = artist.name;
                artistSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (artist.id) {
                        this.displayArtistDetails(artist.id);
                    }
                });
                artistCell.appendChild(artistSpan);
            });
        } else {
            artistCell.textContent = 'Unknown';
        }
        cells.push(artistCell);
        row.appendChild(artistCell);

        // Album (clickable)
        const albumCell = document.createElement('td');
        if (track.album && track.album.id) {
            const albumSpan = document.createElement('span');
            albumSpan.className = 'clickable-album';
            albumSpan.textContent = track.album.name || 'Unknown';
            albumSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.displayAlbumDetails(track.album.id);
            });
            albumCell.appendChild(albumSpan);
        } else {
            albumCell.textContent = track.album?.name || 'Unknown';
        }
        cells.push(albumCell);
        row.appendChild(albumCell);

        // Liked status (placeholder, will be updated after fetch)
        const likedCell = document.createElement('td');
        likedCell.className = 'liked-icon-cell';
        cells.push(likedCell);
        row.appendChild(likedCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = this.formatTime(track.duration_ms || 0);
        cells.push(durationCell);
        row.appendChild(durationCell);

        // Delete button (only for owned playlists)
        if (isOwned) {
            const deleteCell = document.createElement('td');
            deleteCell.className = 'delete-track-cell';
            deleteCell.style.textAlign = 'center';
            deleteCell.style.cursor = 'pointer';
            deleteCell.innerHTML = '🗑️';
            deleteCell.title = 'Remove from playlist';
            deleteCell.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await SpotifyAPI.removeTracksFromPlaylist(playlistId, [track.uri]);
                    row.remove();
                    console.log('Removed track from playlist:', track.name);
                } catch (error) {
                    console.error('Error removing track from playlist:', error);
                    alert('Failed to remove track from playlist. Please try again.');
                }
            });
            cells.push(deleteCell);
            row.appendChild(deleteCell);
        }

        // Apply grey styling to all cells if not playable
        if (!isPlayable) {
            cells.forEach(cell => {
                cell.style.color = '#666';
            });
            row.style.cursor = 'not-allowed';
        }

        // Add drag handlers
        const itemData = {
            id: track.id,
            uri: track.uri,
            type: track.type || 'track',
            trackIndex: trackNumber - 1,
            sourceType: 'playlist',
            sourceId: playlistId
        };
        
        row.addEventListener('dragstart', (e) => this.handleDragStart(e, row, itemData));
        row.addEventListener('dragend', (e) => this.handleDragEnd(e, row));
        
        // Only add drop handlers if this is an owned playlist (allows reordering)
        if (isOwned) {
            row.addEventListener('dragover', (e) => this.handleRowDragOver(e, row, 'playlist', playlistId));
            row.addEventListener('drop', (e) => this.handleRowDrop(e, row, 'playlist', playlistId));
        }

        // Row click handler to play track or toggle play/pause if currently playing
        if (isPlayable) {
            row.addEventListener('click', async (e) => {
                if (e.target.classList.contains('clickable-artist') || 
                    e.target.classList.contains('clickable-album') ||
                    e.target.classList.contains('delete-track-cell') ||
                    e.target.closest('.delete-track-cell')) {
                    return; // Let the child handler handle it
                }
                
                // Handle Ctrl-click for toggle selection
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.toggleTrackSelection(row, trackNumber);
                    return;
                }
                
                // Handle Shift-click for range selection
                if (e.shiftKey) {
                    e.preventDefault();
                    this.selectTrackRange(row, trackNumber);
                    return;
                }
                
                // Normal click: clear selection and play track
                this.clearTrackSelection();
                
                try {
                    // Check if this is the currently playing track at click time
                    const isCurrentlyPlayingNow = track.id && this.isCurrentlyPlayingItem(track.id);
                    if (isCurrentlyPlayingNow) {
                        // Toggle play/pause
                        if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                            await SpotifyAPI.pause();
                            console.log('Paused track:', track.name);
                        } else {
                            await SpotifyAPI.play();
                            console.log('Resumed track:', track.name);
                        }
                    } else {
                        // Play this track with position-based offset
                        const position = trackNumber - 1; // 0-based position
                        await SpotifyAPI.playContentUri(track.uri, playlistUri, null, position);
                        console.log('Playing track from playlist:', track.name);
                    }
                } catch (error) {
                    console.error('Error playing track:', error);
                    // Show user-friendly error message
                    let errorMessage = 'Failed to play track';
                    if (error.message && error.message.includes('Restriction violated')) {
                        errorMessage = `Cannot play "${track.name}"\n\nThis track may not be available in your region, or may require a Spotify Premium subscription.`;
                    } else if (error.message && error.message.includes('NO_ACTIVE_DEVICE')) {
                        errorMessage = 'No active device found. Please select a device from the devices menu.';
                    } else if (error.message) {
                        errorMessage = `Cannot play "${track.name}"\n\n${error.message}`;
                    }
                    alert(errorMessage);
                }
            });
        }

        return row;
    },

    toggleTrackSelection(row, trackNumber) {
        const trackKey = `${row.dataset.trackId}_${trackNumber}`;
        
        if (this.selectedTracks.has(trackKey)) {
            this.selectedTracks.delete(trackKey);
            row.classList.remove('selected-track');
        } else {
            this.selectedTracks.add(trackKey);
            row.classList.add('selected-track');
            this.lastSelectedTrackIndex = trackNumber;
        }
    },

    selectTrackRange(row, trackNumber) {
        const tbody = row.parentElement;
        const rows = Array.from(tbody.querySelectorAll('tr.clickable-row'));
        
        let startIndex, endIndex;
        
        if (this.lastSelectedTrackIndex === null) {
            // No previous selection, select from first track to this one
            startIndex = 1;
            endIndex = trackNumber;
        } else {
            // Select range between last selected and this one
            startIndex = Math.min(this.lastSelectedTrackIndex, trackNumber);
            endIndex = Math.max(this.lastSelectedTrackIndex, trackNumber);
        }
        
        // Select all tracks in range
        rows.forEach((r, idx) => {
            const rowTrackNumber = idx + 1;
            if (rowTrackNumber >= startIndex && rowTrackNumber <= endIndex) {
                const trackKey = `${r.dataset.trackId}_${rowTrackNumber}`;
                this.selectedTracks.add(trackKey);
                r.classList.add('selected-track');
            }
        });
        
        this.lastSelectedTrackIndex = trackNumber;
    },

    clearTrackSelection() {
        // Remove visual selection from all tracks
        document.querySelectorAll('.selected-track').forEach(row => {
            row.classList.remove('selected-track');
        });
        
        this.selectedTracks.clear();
        this.lastSelectedTrackIndex = null;
    },

    toggleResultItemSelection(itemDiv) {
        const itemKey = itemDiv.dataset.itemId;
        const itemType = itemDiv.dataset.itemType;
        
        if (this.selectedTracks.has(itemKey)) {
            this.selectedTracks.delete(itemKey);
            itemDiv.classList.remove('selected-track');
        } else {
            this.selectedTracks.add(itemKey);
            itemDiv.classList.add('selected-track');
            // Store reference for range selection
            this.lastSelectedResultItem = itemDiv;
        }
    },

    selectResultItemRange(itemDiv) {
        // Get the parent section
        const section = itemDiv.closest('.result-section, .artist-details-section');
        if (!section) return;
        
        const itemType = itemDiv.dataset.itemType;
        // Select all items of the same type within this section
        const items = Array.from(section.querySelectorAll(`.result-item[data-item-type="${itemType}"]`));
        const clickedIndex = items.indexOf(itemDiv);
        
        let startIndex, endIndex;
        
        if (!this.lastSelectedResultItem || !items.includes(this.lastSelectedResultItem)) {
            // No previous selection in this section, select from first item to this one
            startIndex = 0;
            endIndex = clickedIndex;
        } else {
            // Select range between last selected and this one
            const lastIndex = items.indexOf(this.lastSelectedResultItem);
            startIndex = Math.min(lastIndex, clickedIndex);
            endIndex = Math.max(lastIndex, clickedIndex);
        }
        
        // Select all items in range
        items.forEach((item, idx) => {
            if (idx >= startIndex && idx <= endIndex) {
                const itemKey = item.dataset.itemId;
                this.selectedTracks.add(itemKey);
                item.classList.add('selected-track');
            }
        });
        
        this.lastSelectedResultItem = itemDiv;
    },

    toggleItemSelection(itemDiv) {
        const itemKey = itemDiv.dataset.itemId;
        
        if (this.selectedTracks.has(itemKey)) {
            this.selectedTracks.delete(itemKey);
            itemDiv.classList.remove('selected-track');
        } else {
            this.selectedTracks.add(itemKey);
            itemDiv.classList.add('selected-track');
            // Store reference for range selection
            this.lastSelectedItem = itemDiv;
        }
    },

    selectItemRange(itemDiv, className) {
        // Get the parent container
        const container = itemDiv.parentElement;
        if (!container) return;
        
        const items = Array.from(container.querySelectorAll(`.${className}`));
        const clickedIndex = items.indexOf(itemDiv);
        
        let startIndex, endIndex;
        
        if (!this.lastSelectedItem || !items.includes(this.lastSelectedItem)) {
            // No previous selection, select from first item to this one
            startIndex = 0;
            endIndex = clickedIndex;
        } else {
            // Select range between last selected and this one
            const lastIndex = items.indexOf(this.lastSelectedItem);
            startIndex = Math.min(lastIndex, clickedIndex);
            endIndex = Math.max(lastIndex, clickedIndex);
        }
        
        // Select all items in range
        items.forEach((item, idx) => {
            if (idx >= startIndex && idx <= endIndex) {
                const itemKey = item.dataset.itemId;
                this.selectedTracks.add(itemKey);
                item.classList.add('selected-track');
            }
        });
        
        this.lastSelectedItem = itemDiv;
    },

    async displayPlaylistDetails(playlistId) {
        // Push to history
        this.pushHistoryState({
            type: 'playlist',
            playlistId: playlistId
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading playlist details...</div>';

        try {
            // Variables to track loading state
            let tbody = null;
            let trackCountDiv = null;
            let durationDiv = null;
            let currentTrackIndex = 0;
            let totalDuration = 0;
            let shouldShowLoadingIndicator = false;
            
            // Callback to add tracks progressively
            const onPageLoaded = (newTracks, totalLoaded, hasMore) => {
                // Show loading indicator if needed
                if (shouldShowLoadingIndicator && hasMore) {
                    this.showPaginationLoading();
                }
                
                const startIndex = currentTrackIndex;
                newTracks.forEach((item) => {
                    if (!item || !item.track) return;
                    
                    const track = item.track;
                    const row = this.createPlaylistTrackRow(track, currentTrackIndex + 1, playlist.uri, playlistId, isOwner);
                    tbody.appendChild(row);
                    currentTrackIndex++;
                    
                    // Update running total duration
                    totalDuration += (track.duration_ms || 0);
                });
                
                // Update duration display
                if (durationDiv) {
                    durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}${hasMore ? ' (loading...)' : ''}`;
                }
                
                // Hide loading indicator when complete
                if (!hasMore) {
                    this.hidePaginationLoading();
                }
                
                // Fetch liked status for the new tracks
                (async () => {
                    try {
                        const trackIds = newTracks
                            .filter(item => item && item.track && item.track.id)
                            .map(item => item.track.id);
                        
                        if (trackIds.length > 0) {
                            const likedStatuses = await SpotifyAPI.checkLikedTracks(trackIds);
                            
                            // Update liked icons in the newly added rows
                            const allRows = tbody.querySelectorAll('tr');
                            const newRows = Array.from(allRows).slice(startIndex);
                            
                            newRows.forEach((row, index) => {
                                if (index < likedStatuses.length) {
                                    const likedCell = row.querySelector('.liked-icon-cell');
                                    if (likedCell) {
                                        likedCell.innerHTML = '';
                                        const trackId = row.dataset.trackId;
                                        const likedIcon = this.createLikedIcon(likedStatuses[index], '', 'track', trackId);
                                        likedCell.appendChild(likedIcon);
                                    }
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching track liked statuses for new tracks:', error);
                    }
                })();
            };
            
            const playlist = await SpotifyAPI.getPlaylist(playlistId, onPageLoaded);
            
            if (!playlist) {
                contentPanel.innerHTML = '<div class="error">Failed to load playlist details.</div>';
                return;
            }

            // Check if current user is the owner
            const currentUserId = SpotifyAuth.getUserId();
            const isOwner = playlist.owner && currentUserId && playlist.owner.id === currentUserId;

            // Fetch owner's profile to get their image
            let ownerProfile = null;
            if (playlist.owner && playlist.owner.id) {
                ownerProfile = await SpotifyAPI.getUserById(playlist.owner.id);
            }

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'playlist-details-container';
            container.style.position = 'relative';

            // Determine if we should show pagination loading indicator
            const totalTracks = playlist.tracks?.total || 0;
            shouldShowLoadingIndicator = totalTracks > 200;

            // Header section with image and info side by side
            const headerSection = document.createElement('div');
            headerSection.className = 'playlist-details-header';

            // Large playlist image (left side) - always show with placeholder if needed
            const img = document.createElement('img');
            img.className = 'playlist-details-image';
            img.src = this.getImageUrl(playlist);
            img.alt = playlist.name;
            headerSection.appendChild(img);

            // Playlist info (right side)
            const infoSection = document.createElement('div');
            infoSection.className = 'playlist-details-info';

            // Playlist name
            const name = document.createElement('h1');
            name.className = 'playlist-details-name';
            name.textContent = playlist.name || 'Untitled Playlist';
            infoSection.appendChild(name);

            // Description
            if (playlist.description) {
                const descDiv = document.createElement('div');
                descDiv.className = 'playlist-details-description';
                descDiv.innerHTML = playlist.description; // Spotify sometimes includes HTML
                infoSection.appendChild(descDiv);
            }

            // Owner info with image
            if (playlist.owner) {
                const ownerDiv = document.createElement('div');
                ownerDiv.className = 'playlist-details-owner';
                ownerDiv.style.cursor = 'pointer';
                ownerDiv.title = 'View user profile';

                // Always show owner image (use placeholder if needed)
                const ownerImg = document.createElement('img');
                ownerImg.className = 'playlist-details-owner-image';
                if (ownerProfile) {
                    ownerImg.src = this.getImageUrl(ownerProfile);
                } else if (playlist.owner.images) {
                    ownerImg.src = this.getImageUrl(playlist.owner);
                } else {
                    ownerImg.src = this.placeholderImage;
                }
                ownerImg.alt = playlist.owner.display_name || 'Owner';
                ownerDiv.appendChild(ownerImg);

                const ownerName = document.createElement('span');
                ownerName.className = 'playlist-details-owner-name';
                ownerName.textContent = playlist.owner.display_name || playlist.owner.id || 'Unknown';
                ownerDiv.appendChild(ownerName);
                
                // Click handler to view user profile
                ownerDiv.addEventListener('click', (e) => {
                    // Only if not clicking on dropdown or other interactive elements
                    if (!e.target.classList.contains('playlist-visibility-dropdown')) {
                        this.displayUserProfile(playlist.owner.id);
                    }
                });

                // Check if current user is the owner
                const currentUserId = SpotifyAuth.getUserId();
                const isOwner = playlist.owner && currentUserId && playlist.owner.id === currentUserId;

                // Add visibility information (public/private/collaborative)
                if (isOwner) {
                    // Show dropdown for owned playlists
                    const visibilityDropdown = document.createElement('select');
                    visibilityDropdown.className = 'playlist-visibility-dropdown';
                    
                    // Determine current visibility type
                    let currentType = 'private';
                    if (playlist.collaborative) {
                        currentType = 'collaborative';
                    } else if (playlist.public) {
                        currentType = 'public';
                    }
                    
                    // Create options
                    const options = [
                        { value: 'public', label: 'Public' },
                        { value: 'private', label: 'Private' },
                        { value: 'collaborative', label: 'Collaborative' }
                    ];
                    
                    options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        if (opt.value === currentType) {
                            option.selected = true;
                        }
                        visibilityDropdown.appendChild(option);
                    });
                    
                    // Handle visibility change
                    visibilityDropdown.addEventListener('change', async (e) => {
                        const newType = e.target.value;
                        const dropdown = e.target;
                        const originalValue = currentType;
                        
                        // Disable dropdown during update
                        dropdown.disabled = true;
                        
                        try {
                            // Prepare update based on selection
                            const updates = {};
                            if (newType === 'collaborative') {
                                updates.public = false;
                                updates.collaborative = true;
                            } else if (newType === 'public') {
                                updates.public = true;
                                updates.collaborative = false;
                            } else {
                                updates.public = false;
                                updates.collaborative = false;
                            }
                            
                            // Update via API
                            await SpotifyAPI.updatePlaylistDetails(playlist.id, updates);
                            
                            // Update local state
                            currentType = newType;
                            playlist.public = updates.public;
                            playlist.collaborative = updates.collaborative;
                            
                        } catch (error) {
                            console.error('Error updating playlist visibility:', error);
                            alert('Failed to update playlist visibility. Please try again.');
                            // Revert dropdown to original value
                            dropdown.value = originalValue;
                        } finally {
                            dropdown.disabled = false;
                        }
                    });
                    
                    ownerDiv.appendChild(visibilityDropdown);
                } else {
                    // Show text in brackets for non-owned playlists
                    let visibilityText = 'private playlist';
                    if (playlist.collaborative) {
                        visibilityText = 'collaborative playlist';
                    } else if (playlist.public) {
                        visibilityText = 'public playlist';
                    }
                    
                    const visibilitySpan = document.createElement('span');
                    visibilitySpan.className = 'playlist-visibility-text';
                    visibilitySpan.textContent = ` (${visibilityText})`;
                    ownerDiv.appendChild(visibilitySpan);
                }

                infoSection.appendChild(ownerDiv);
            }

            // Track count
            if (playlist.tracks && playlist.tracks.total !== null && playlist.tracks.total !== undefined) {
                trackCountDiv = document.createElement('div');
                trackCountDiv.className = 'playlist-details-track-count';
                trackCountDiv.textContent = `${playlist.tracks.total} ${playlist.tracks.total === 1 ? 'track' : 'tracks'}`;
                infoSection.appendChild(trackCountDiv);
            }

            // Total duration (initial calculation from first page)
            if (playlist.tracks && playlist.tracks.items) {
                totalDuration = playlist.tracks.items.reduce((sum, item) => {
                    return sum + (item.track?.duration_ms || 0);
                }, 0);
                durationDiv = document.createElement('div');
                durationDiv.className = 'playlist-details-duration';
                const hasMore = playlist.tracks.next !== null;
                durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}${hasMore ? ' (loading...)' : ''}`;
                infoSection.appendChild(durationDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add liked/followed icon OR delete button in top-right (skip for 'Liked Songs' playlist)
            const isLikedSongsPlaylist = playlist.id === 'liked-songs' || (playlist.owner && playlist.owner.id === 'spotify' && playlist.name === 'Liked Songs');
            if (!isLikedSongsPlaylist) {
                // Check if current user is the owner
                const currentUserId = SpotifyAuth.getUserId();
                const isOwner = playlist.owner && currentUserId && playlist.owner.id === currentUserId;
                
                if (isOwner) {
                    // Show delete button for owned playlists
                    const deleteButton = document.createElement('div');
                    deleteButton.className = 'delete-playlist-button';
                    deleteButton.title = 'Delete playlist';
                    deleteButton.innerHTML = '🗑️';
                    deleteButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showDeletePlaylistDialog(playlist.id, playlist.name);
                    });
                    container.appendChild(deleteButton);
                } else {
                    // Show like/follow button for playlists user doesn't own
                    const likedIconTopRight = this.createLikedIcon(false, 'liked-icon-top-right', 'playlist', playlist.id, {
                        name: playlist.name,
                        imageUrl: playlist.images && playlist.images.length > 0 ? playlist.images[0]?.url : null
                    });
                    container.appendChild(likedIconTopRight);
                    
                    // Fetch playlist followed status in background
                    (async () => {
                        try {
                            const isFollowed = await SpotifyAPI.checkFollowedPlaylist(playlist.id);
                            const icon = container.querySelector('.liked-icon-top-right');
                            if (icon) {
                                icon.className = `liked-icon ${isFollowed ? 'liked' : 'unliked'} liked-icon-top-right`;
                                icon.title = isFollowed ? 'Followed' : 'Not followed';
                            }
                        } catch (error) {
                            console.error('Error fetching playlist followed status:', error);
                        }
                    })();
                }
                
                // Add context-specific play button
                const playButton = this.createContextPlayButton(playlist.uri, 'playlist', playlist.tracks?.items?.filter(item => item && item.track).map(item => item.track) || []);
                container.appendChild(playButton);
                
                // Add context-specific shuffle button below play button
                const shuffleButton = this.createContextShuffleButton(playlist.uri, 'playlist');
                container.appendChild(shuffleButton);
            }
            
            // Tracks table
            if (playlist.tracks && playlist.tracks.items && playlist.tracks.items.length > 0) {
                const tracksSection = document.createElement('div');
                tracksSection.className = 'playlist-details-tracks-section';

                const tracksTable = document.createElement('table');
                tracksTable.className = 'playlist-tracks-table';

                // Table header
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                
                const headers = [
                    { name: '#', width: 50 },
                    { name: 'Title', width: 300 },
                    { name: 'Artist', width: 200 },
                    { name: 'Album', width: 250 },
                    { name: 'Liked', width: 60 },
                    { name: 'Duration', width: 100 }
                ];
                
                // Add delete column if user owns the playlist
                if (isOwner) {
                    headers.push({ name: '', width: 50 });
                }

                headers.forEach((header, index) => {
                    const th = document.createElement('th');
                    th.textContent = header.name;
                    th.style.width = header.width + 'px';
                    
                    // Add resize handle (except for last column)
                    if (index < headers.length - 1) {
                        const resizeHandle = document.createElement('div');
                        resizeHandle.className = 'resize-handle';
                        resizeHandle.addEventListener('mousedown', (e) => {
                            this.initColumnResize(e, th);
                        });
                        th.appendChild(resizeHandle);
                    }
                    
                    headerRow.appendChild(th);
                });

                thead.appendChild(headerRow);
                tracksTable.appendChild(thead);

                // Table body
                tbody = document.createElement('tbody');

                // Add initial tracks
                playlist.tracks.items.forEach((item) => {
                    if (!item || !item.track) return;
                    
                    const track = item.track;
                    const row = this.createPlaylistTrackRow(track, currentTrackIndex + 1, playlist.uri, playlistId, isOwner);
                    tbody.appendChild(row);
                    currentTrackIndex++;
                });

                tracksTable.appendChild(tbody);
                tracksSection.appendChild(tracksTable);
                container.appendChild(tracksSection);
                
                // Fetch liked status for all tracks in background
                (async () => {
                    try {
                        // Collect all track IDs from current tracks
                        const trackIds = playlist.tracks.items
                            .filter(item => item && item.track && item.track.id)
                            .map(item => item.track.id);
                        
                        if (trackIds.length > 0) {
                            const likedStatuses = await SpotifyAPI.checkLikedTracks(trackIds);
                            
                            // Update liked icons in rows
                            const rows = tbody.querySelectorAll('tr');
                            let statusIndex = 0;
                            rows.forEach((row) => {
                                const trackId = row.dataset.trackId;
                                if (trackId && statusIndex < likedStatuses.length) {
                                    const likedCell = row.querySelector('.liked-icon-cell');
                                    if (likedCell) {
                                        likedCell.innerHTML = '';
                                        const likedIcon = this.createLikedIcon(likedStatuses[statusIndex], '', 'track', trackId);
                                        likedCell.appendChild(likedIcon);
                                    }
                                    statusIndex++;
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching track liked statuses:', error);
                    }
                })();
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying playlist details:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load playlist details. Please try again.</div>';
        }
    },

    showDeletePlaylistDialog(playlistId, playlistName) {
        // Create dialog overlay
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        
        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'dialog-box';
        
        // Dialog title
        const title = document.createElement('h2');
        title.textContent = 'Delete Playlist?';
        dialog.appendChild(title);
        
        // Dialog message
        const message = document.createElement('p');
        message.innerHTML = `Are you sure you want to delete "${playlistName}"?<br><br>You can recover deleted playlists at:<br><a href="https://www.spotify.com/account/recover-playlists/" target="_blank">https://www.spotify.com/account/recover-playlists/</a>`;
        dialog.appendChild(message);
        
        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'dialog-buttons';
        
        // Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.className = 'dialog-button dialog-button-cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        buttonContainer.appendChild(cancelButton);
        
        // OK button
        const okButton = document.createElement('button');
        okButton.className = 'dialog-button dialog-button-ok';
        okButton.textContent = 'OK';
        okButton.addEventListener('click', async () => {
            // Disable buttons during deletion
            okButton.disabled = true;
            cancelButton.disabled = true;
            okButton.textContent = 'Deleting...';
            
            try {
                // Delete the playlist
                await SpotifyAPI.unfollowPlaylist(playlistId);
                
                // Close dialog
                document.body.removeChild(overlay);
                
                // Reload playlists view (same as clicking on playlists root node)
                const playlistsRootNode = document.querySelector('[data-node-id="playlists"]');
                if (playlistsRootNode) {
                    await this.loadUserPlaylists(playlistsRootNode);
                }
            } catch (error) {
                console.error('Error deleting playlist:', error);
                alert('Failed to delete playlist. Please try again.');
                okButton.disabled = false;
                cancelButton.disabled = false;
                okButton.textContent = 'OK';
            }
        });
        buttonContainer.appendChild(okButton);
        
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
    },
    
    // Show confirmation dialog for disabling continuous playback
    async showContinuousPlaybackDisableDialog() {
        return new Promise((resolve) => {
            // Create dialog overlay
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            
            // Create dialog
            const dialog = document.createElement('div');
            dialog.className = 'dialog-box';
            
            // Dialog title
            const title = document.createElement('h2');
            title.textContent = 'Disable Continuous Playback?';
            dialog.appendChild(title);
            
            // Dialog message
            const message = document.createElement('p');
            message.innerHTML = `Without this feature, the web client cannot stream songs in the 'Liked Songs' playlist with context.<br><br>` +
                `Individual songs can still be played when selected, but continuous playback and shuffle within Liked Songs will not work.<br><br>` +
                `The shadow playlist used for this feature will be deleted.`;
            dialog.appendChild(message);
            
            // Button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'dialog-buttons';
            
            // Cancel button
            const cancelButton = document.createElement('button');
            cancelButton.className = 'dialog-button dialog-button-cancel';
            cancelButton.textContent = 'Cancel';
            cancelButton.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(false);
            });
            buttonContainer.appendChild(cancelButton);
            
            // OK button
            const okButton = document.createElement('button');
            okButton.className = 'dialog-button dialog-button-ok';
            okButton.textContent = 'Disable';
            okButton.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(true);
            });
            buttonContainer.appendChild(okButton);
            
            dialog.appendChild(buttonContainer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            
            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(false);
                }
            });
        });
    },

    async displayLikedSongsDetails() {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        // Push to history
        this.pushHistoryState({
            type: 'liked-songs'
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading Liked Songs...</div>';

        try {
            let tbody = null;
            let trackCountDiv = null;
            let durationDiv = null;
            let currentTrackIndex = 0;
            let totalDuration = 0;
            let allTracksData = [];
            let allLikedSongsForSync = []; // Collect all for shadow playlist sync
            let shouldShowLoadingIndicator = false;
            
            // Callback to add tracks progressively AND collect for shadow playlist
            const onPageLoaded = (newItems, totalLoaded, hasMore) => {
                // Show loading indicator if needed
               if (shouldShowLoadingIndicator && hasMore) {
                    this.showPaginationLoading();
                }
                newItems.forEach((item) => {
                    if (!item || !item.track) return;
                    
                    const track = item.track;
                    const addedAt = item.added_at;
                    
                    // Store track data for sorting
                    allTracksData.push({
                        index: currentTrackIndex + 1,
                        track: track,
                        addedAt: addedAt
                    });
                    
                    if (tbody) {
                        const row = this.createLikedSongTrackRow(track, currentTrackIndex + 1, addedAt);
                        tbody.appendChild(row);
                    }
                    currentTrackIndex++;
                    
                    // Update running total duration
                    totalDuration += (track.duration_ms || 0);
                });
                
                // Collect all items for shadow playlist sync
                allLikedSongsForSync = allLikedSongsForSync.concat(newItems);
                
                // Update duration display
                if (durationDiv) {
                    durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}${hasMore ? ' (loading...)' : ''}`;
                }
                
                // Hide loading indicator when complete
                if (!hasMore) {
                    this.hidePaginationLoading();
                }
                
                // When pagination completes, sync shadow playlist
                if (!hasMore && allLikedSongsForSync.length > 0) {
                    const likedSongsUris = allLikedSongsForSync
                        .map(item => item.track?.uri)
                        .filter(uri => uri);
                    
                    this.ensureShadowPlaylist(likedSongsUris).catch(error => {
                        console.error('Error syncing shadow playlist:', error);
                    });
                }
            };
            
            const likedSongsData = await SpotifyAPI.getLikedSongs(50, onPageLoaded);
            
            if (!likedSongsData || !likedSongsData.items || likedSongsData.items.length === 0) {
                contentPanel.innerHTML = '<div class="empty-message">You have no liked songs yet.</div>';
                return;
            }

            const likedSongs = likedSongsData.items;
            const totalCount = likedSongsData.total;
            
            // IMPORTANT: Include the first page in the collection for shadow playlist sync
            // The onPageLoaded callback only receives subsequent pages
            allLikedSongsForSync = likedSongs.concat(allLikedSongsForSync);

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'playlist-details-container';

            // Determine if we should show pagination loading indicator
            shouldShowLoadingIndicator = totalCount > 200;

            // Header section
            const headerSection = document.createElement('div');
            headerSection.className = 'playlist-details-header';

            // Purple heart icon
            const iconDiv = document.createElement('div');
            iconDiv.className = 'liked-songs-icon';
            iconDiv.innerHTML = '💜';
            headerSection.appendChild(iconDiv);

            // Playlist info
            const infoSection = document.createElement('div');
            infoSection.className = 'playlist-details-info';

            // Title
            const name = document.createElement('h1');
            name.className = 'playlist-details-name';
            name.textContent = 'Liked Songs';
            infoSection.appendChild(name);

            // Track count
            trackCountDiv = document.createElement('div');
            trackCountDiv.className = 'playlist-details-track-count';
            trackCountDiv.textContent = `${totalCount} ${totalCount === 1 ? 'track' : 'tracks'}`;
            infoSection.appendChild(trackCountDiv);

            // Total duration
            totalDuration = likedSongs.reduce((sum, item) => {
                return sum + (item.track?.duration_ms || 0);
            }, 0);
            durationDiv = document.createElement('div');
            durationDiv.className = 'playlist-details-duration';
            durationDiv.textContent = `Total duration: ${this.formatDuration(totalDuration)}`;
            infoSection.appendChild(durationDiv);

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add context-specific play button (using shadow playlist URI)
            // Wait for shadow playlist to be ready
            await this.ensureShadowPlaylist(allLikedSongsForSync.map(item => item.track?.uri).filter(uri => uri));
            
            if (this.shadowPlaylist.uri) {
                // Collect all tracks for the play button (to find first playable)
                const allTracks = likedSongs.map(item => item.track).filter(track => track);
                const playButton = this.createContextPlayButton(this.shadowPlaylist.uri, 'playlist', allTracks);
                container.appendChild(playButton);
                
                // Add context-specific shuffle button below play button
                const shuffleButton = this.createContextShuffleButton(this.shadowPlaylist.uri, 'playlist');
                container.appendChild(shuffleButton);
            }

            // Tracks table
            if (likedSongs.length > 0) {
                const tracksSection = document.createElement('div');
                tracksSection.className = 'playlist-details-tracks-section';

                const tracksTable = document.createElement('table');
                tracksTable.className = 'playlist-tracks-table';

                // Table header
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                
                const headers = [
                    { name: '#', width: 50, sortKey: 'index' },
                    { name: 'Title', width: 300, sortKey: 'title' },
                    { name: 'Artist', width: 200, sortKey: 'artist' },
                    { name: 'Album', width: 200, sortKey: 'album' },
                    { name: 'Added', width: 120, sortKey: 'added' },
                    { name: 'Duration', width: 100, sortKey: 'duration' },
                    { name: '', width: 50 }
                ];

                headers.forEach((header, index) => {
                    const th = document.createElement('th');
                    th.textContent = header.name;
                    th.style.width = header.width + 'px';
                    th.style.cursor = 'pointer';
                    th.setAttribute('data-sort-key', header.sortKey);
                    th.setAttribute('data-sort-dir', 'asc');
                    
                    // Add sort indicator span
                    const sortIndicator = document.createElement('span');
                    sortIndicator.className = 'sort-indicator';
                    sortIndicator.style.marginLeft = '5px';
                    sortIndicator.style.visibility = 'hidden';
                    th.appendChild(sortIndicator);
                    
                    // Add click handler for sorting
                    th.addEventListener('click', () => {
                        this.sortLikedSongsTable(th, tbody, allTracksData);
                    });
                    
                    // Add resize handle (except for last column)
                    if (index < headers.length - 1) {
                        const resizeHandle = document.createElement('div');
                        resizeHandle.className = 'resize-handle';
                        resizeHandle.addEventListener('mousedown', (e) => {
                            this.initColumnResize(e, th);
                        });
                        th.appendChild(resizeHandle);
                    }
                    
                    headerRow.appendChild(th);
                });

                thead.appendChild(headerRow);
                tracksTable.appendChild(thead);

                // Table body
                tbody = document.createElement('tbody');

                // Add initial tracks
                likedSongs.forEach((item) => {
                    if (!item || !item.track) return;
                    
                    const track = item.track;
                    const addedAt = item.added_at;
                    
                    // Store track data for sorting
                    allTracksData.push({
                        index: currentTrackIndex + 1,
                        track: track,
                        addedAt: addedAt
                    });
                    
                    const row = this.createLikedSongTrackRow(track, currentTrackIndex + 1, addedAt);
                    tbody.appendChild(row);
                    currentTrackIndex++;
                });

                tracksTable.appendChild(tbody);
                tracksSection.appendChild(tracksTable);
                container.appendChild(tracksSection);
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying liked songs:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load liked songs. Please try again.</div>';
        }
    },

    sortLikedSongsTable(headerElement, tbody, tracksData) {
        const sortKey = headerElement.getAttribute('data-sort-key');
        let sortDir = headerElement.getAttribute('data-sort-dir');
        
        // Toggle sort direction
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        headerElement.setAttribute('data-sort-dir', sortDir);
        
        // Reset all other headers and hide their indicators
        const allHeaders = headerElement.parentElement.querySelectorAll('th');
        allHeaders.forEach(th => {
            const indicator = th.querySelector('.sort-indicator');
            if (th !== headerElement) {
                th.setAttribute('data-sort-dir', 'asc');
                if (indicator) {
                    indicator.style.visibility = 'hidden';
                }
            } else if (indicator) {
                // Show indicator for current sort column
                indicator.style.visibility = 'visible';
                indicator.textContent = sortDir === 'asc' ? '▲' : '▼';
            }
        });
        
        // Sort the data
        const sortedData = [...tracksData].sort((a, b) => {
            let valA, valB;
            
            switch(sortKey) {
                case 'index':
                    valA = a.index;
                    valB = b.index;
                    break;
                case 'title':
                    valA = (a.track.name || '').toLowerCase();
                    valB = (b.track.name || '').toLowerCase();
                    break;
                case 'artist':
                    valA = (a.track.artists?.map(ar => ar.name).join(', ') || '').toLowerCase();
                    valB = (b.track.artists?.map(ar => ar.name).join(', ') || '').toLowerCase();
                    break;
                case 'album':
                    valA = (a.track.album?.name || '').toLowerCase();
                    valB = (b.track.album?.name || '').toLowerCase();
                    break;
                case 'added':
                    valA = new Date(a.addedAt).getTime();
                    valB = new Date(b.addedAt).getTime();
                    break;
                case 'duration':
                    valA = a.track.duration_ms || 0;
                    valB = b.track.duration_ms || 0;
                    break;
                default:
                    return 0;
            }
            
            if (sortDir === 'asc') {
                return valA < valB ? -1 : valA > valB ? 1 : 0;
            } else {
                return valA > valB ? -1 : valA < valB ? 1 : 0;
            }
        });
        
        // Rebuild tbody with sorted data using helper function
        tbody.innerHTML = '';
        sortedData.forEach((item) => {
            const row = this.createLikedSongTrackRow(item.track, item.index, item.addedAt);
            tbody.appendChild(row);
        });
    },

    async displayUserProfile(userId) {
        // Push to history
        this.pushHistoryState({
            type: 'user-profile',
            userId: userId
        });

        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading user profile...</div>';

        try {
            // Fetch user profile and their public playlists
            const [userProfile, userPlaylists] = await Promise.all([
                SpotifyAPI.getUserById(userId),
                SpotifyAPI.getUserPlaylists(50, null, userId)
            ]);

            if (!userProfile) {
                contentPanel.innerHTML = '<div class="error">Failed to load user profile.</div>';
                return;
            }

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'user-profile-container';

            // Header section with image and info
            const headerSection = document.createElement('div');
            headerSection.className = 'user-profile-header';

            // User image (always show with placeholder if needed)
            const img = document.createElement('img');
            img.className = 'user-profile-image';
            img.src = this.getImageUrl(userProfile);
            img.alt = userProfile.display_name || 'User';
            headerSection.appendChild(img);

            // User info
            const infoSection = document.createElement('div');
            infoSection.className = 'user-profile-info';

            // User name
            const name = document.createElement('h1');
            name.className = 'user-profile-name';
            name.textContent = userProfile.display_name || userProfile.id || 'Unknown User';
            infoSection.appendChild(name);

            // Followers count
            if (userProfile.followers && userProfile.followers.total !== null && userProfile.followers.total !== undefined) {
                const followersDiv = document.createElement('div');
                followersDiv.className = 'user-profile-followers';
                followersDiv.textContent = `${this.formatFollowers(userProfile.followers.total)} followers`;
                infoSection.appendChild(followersDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Public playlists section
            if (userPlaylists && userPlaylists.length > 0) {
                const playlistsSection = document.createElement('div');
                playlistsSection.className = 'user-profile-playlists-section';

                const playlistsTitle = document.createElement('h2');
                playlistsTitle.className = 'user-profile-playlists-title';
                playlistsTitle.textContent = 'Public Playlists';
                playlistsSection.appendChild(playlistsTitle);

                const playlistsList = document.createElement('div');
                playlistsList.className = 'user-profile-playlists-list';

                userPlaylists.forEach(playlist => {
                    const playlistItem = document.createElement('div');
                    playlistItem.className = 'user-profile-playlist-item';

                    // Playlist image (always show, use placeholder if needed)
                    const playlistImg = document.createElement('img');
                    playlistImg.className = 'user-profile-playlist-image';
                    playlistImg.src = this.getImageUrl(playlist);
                    playlistImg.alt = playlist.name;
                    playlistItem.appendChild(playlistImg);

                    // Playlist info
                    const playlistInfo = document.createElement('div');
                    playlistInfo.className = 'user-profile-playlist-info';

                    const playlistName = document.createElement('div');
                    playlistName.className = 'user-profile-playlist-name';
                    playlistName.textContent = playlist.name;
                    playlistInfo.appendChild(playlistName);

                    // Track count
                    if (playlist.tracks && playlist.tracks.total !== null && playlist.tracks.total !== undefined) {
                        const trackCount = document.createElement('div');
                        trackCount.className = 'user-profile-playlist-tracks';
                        trackCount.textContent = `${playlist.tracks.total} ${playlist.tracks.total === 1 ? 'track' : 'tracks'}`;
                        playlistInfo.appendChild(trackCount);
                    }

                    playlistItem.appendChild(playlistInfo);

                    // Click handler to view playlist
                    playlistItem.addEventListener('click', () => {
                        this.displayPlaylistDetails(playlist.id);
                    });

                    playlistsList.appendChild(playlistItem);
                });

                playlistsSection.appendChild(playlistsList);
                container.appendChild(playlistsSection);
            } else {
                const noPlaylists = document.createElement('div');
                noPlaylists.className = 'user-profile-no-playlists';
                noPlaylists.textContent = 'This user has no public playlists.';
                container.appendChild(noPlaylists);
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error loading user profile:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load user profile. Please try again.</div>';
        }
    },

    async loadSavedPodcasts(podcastsRootNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading podcasts...</div>';

        try {
            let allPodcasts = [];
            let childrenContainer = podcastsRootNode.querySelector('.tree-children');
            const isFirstLoad = !childrenContainer;
            
            // Create or clear the children container
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                podcastsRootNode.appendChild(childrenContainer);
                
                // Show disclosure triangle
                const disclosure = podcastsRootNode.querySelector('.tree-disclosure');
                if (disclosure) {
                    disclosure.style.visibility = 'visible';
                }
            } else {
                // Clear existing children for refresh
                childrenContainer.innerHTML = '';
            }
            
            // Add "Liked Episodes" as the first item
            const likedEpisodesNode = {
                id: 'liked-episodes',
                name: 'Liked Episodes',
                icon: '💜',
                isLikedEpisodes: true
            };
            const likedEpisodesElement = this.createTreeNode(likedEpisodesNode, 1);
            childrenContainer.appendChild(likedEpisodesElement);
            
            const onPageLoaded = (newShows, totalLoaded, hasMore) => {
                // Extract shows from the saved shows response and add to the tree
                const newPodcasts = newShows.map(item => item.show).filter(show => show !== null);
                
                newPodcasts.forEach(podcast => {
                    let imageUrl = null;
                    if (podcast.images && podcast.images.length > 0) {
                        imageUrl = podcast.images[podcast.images.length - 1]?.url || null;
                    }

                    const podcastNode = {
                        id: `podcast-${podcast.id}`,
                        podcastId: podcast.id,
                        name: podcast.name,
                        imageUrl: imageUrl,
                        icon: '🎙️'
                    };

                    const nodeElement = this.createTreeNode(podcastNode, 1);
                    childrenContainer.appendChild(nodeElement);
                });
                
                // Re-sort all nodes alphabetically (except Liked Episodes)
                const nodes = Array.from(childrenContainer.children);
                const likedEpisodesNode = nodes.find(node => node.querySelector('.tree-name')?.textContent === 'Liked Episodes');
                const otherNodes = nodes.filter(node => node.querySelector('.tree-name')?.textContent !== 'Liked Episodes');
                
                otherNodes.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });
                
                // Clear and re-add: Liked Episodes first, then sorted podcasts
                childrenContainer.innerHTML = '';
                if (likedEpisodesNode) childrenContainer.appendChild(likedEpisodesNode);
                otherNodes.forEach(node => childrenContainer.appendChild(node));
                
                // Update the content panel display with all loaded podcasts so far
                allPodcasts = allPodcasts.concat(newPodcasts);
                allPodcasts.sort((a, b) => a.name.localeCompare(b.name));
                this.displayPodcastsList(allPodcasts);
            };
            
            const savedShows = await SpotifyAPI.getSavedPodcasts(50, onPageLoaded);
            
            if (!savedShows || savedShows.length === 0) {
                // Still show Liked Episodes even if no podcasts
                this.displayPodcastsList([]);
                return;
            }

            // Expand the podcasts node only on first load
            if (isFirstLoad && !podcastsRootNode.classList.contains('expanded')) {
                this.toggleTreeNode(podcastsRootNode);
            }
            
            // Show the refresh button now that children are populated
            const refreshButton = podcastsRootNode.querySelector('.tree-refresh-button');
            if (refreshButton) {
                refreshButton.style.display = 'flex';
            }

            // Extract podcast objects from the saved shows response
            const podcasts = savedShows.map(item => item.show).filter(show => show !== null);
            allPodcasts = podcasts;

            // Sort podcasts alphabetically by name
            allPodcasts.sort((a, b) => a.name.localeCompare(b.name));

            // Note: Podcasts are already added via onPageLoaded callback
            // This section is kept for potential future use
            if (false) {
            allPodcasts.forEach(podcast => {
                // Get the smallest image for the tree
                let imageUrl = null;
                if (podcast.images && podcast.images.length > 0) {
                    // Use the smallest image (last in array)
                    imageUrl = podcast.images[podcast.images.length - 1]?.url || null;
                }

                const podcastNode = {
                    id: `podcast-${podcast.id}`,
                    podcastId: podcast.id,
                    name: podcast.name,
                    imageUrl: imageUrl,
                    icon: '🎙️'
                };

                const nodeElement = this.createTreeNode(podcastNode, 1);
                childrenContainer.appendChild(nodeElement);
            });
            }

            // Display list of podcasts in content panel
            this.displayPodcastsList(allPodcasts);

        } catch (error) {
            console.error('Error loading podcasts:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load podcasts. Please try again.</div>';
        }
    },

    displayPodcastsList(podcasts) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'podcasts-list-container';

        const title = document.createElement('h1');
        title.className = 'podcasts-list-title';
        title.textContent = 'Your Podcasts';
        container.appendChild(title);

        const podcastsList = document.createElement('div');
        podcastsList.className = 'podcasts-list';

        // Add Liked Episodes first
        const likedEpisodesItem = document.createElement('div');
        likedEpisodesItem.className = 'podcast-list-item';

        // Icon
        const likedIcon = document.createElement('div');
        likedIcon.className = 'podcast-list-image liked-episodes-list-icon';
        likedIcon.innerHTML = '💜';
        likedEpisodesItem.appendChild(likedIcon);

        // Name
        const likedNameDiv = document.createElement('div');
        likedNameDiv.className = 'podcast-list-name';
        likedNameDiv.textContent = 'Liked Episodes';
        likedEpisodesItem.appendChild(likedNameDiv);

        // Click handler
        likedEpisodesItem.addEventListener('click', () => {
            this.displayLikedEpisodesDetails();
        });

        podcastsList.appendChild(likedEpisodesItem);

        // Add regular podcasts
        podcasts.forEach(podcast => {
            const podcastItem = document.createElement('div');
            podcastItem.className = 'podcast-list-item';

            // Podcast image (always show, use placeholder if needed)
            const img = document.createElement('img');
            img.className = 'podcast-list-image';
            img.src = this.getImageUrl(podcast);
            img.alt = podcast.name;
            podcastItem.appendChild(img);

            // Podcast name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'podcast-list-name';
            nameDiv.textContent = podcast.name;
            podcastItem.appendChild(nameDiv);

            // Publisher name
            if (podcast.publisher) {
                const publisherDiv = document.createElement('div');
                publisherDiv.className = 'podcast-list-publisher';
                publisherDiv.textContent = podcast.publisher;
                podcastItem.appendChild(publisherDiv);
            }

            // Click handler
            podcastItem.addEventListener('click', () => {
                this.displayPodcastDetails(podcast.id);
            });

            podcastsList.appendChild(podcastItem);
        });

        container.appendChild(podcastsList);
        contentPanel.appendChild(container);
    },

    async loadSavedAudiobooks(audiobooksRootNode) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading audiobooks...</div>';

        try {
            let allAudiobooks = [];
            let childrenContainer = audiobooksRootNode.querySelector('.tree-children');
            const isFirstLoad = !childrenContainer;
            
            // Create or clear the children container
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'tree-children';
                audiobooksRootNode.appendChild(childrenContainer);
                
                // Show disclosure triangle
                const disclosure = audiobooksRootNode.querySelector('.tree-disclosure');
                if (disclosure) {
                    disclosure.style.visibility = 'visible';
                }
            } else {
                // Clear existing children for refresh
                childrenContainer.innerHTML = '';
            }
            
            const onPageLoaded = (newItems, totalLoaded, hasMore) => {
                // Extract audiobooks from the saved audiobooks response and add to the tree
                const newAudiobooks = newItems.map(item => item.audiobook || item).filter(audiobook => audiobook !== null);
                
                newAudiobooks.forEach(audiobook => {
                    let imageUrl = null;
                    if (audiobook.images && audiobook.images.length > 0) {
                        imageUrl = audiobook.images[audiobook.images.length - 1]?.url || null;
                    }

                    const audiobookNode = {
                        id: `audiobook-${audiobook.id}`,
                        audiobookId: audiobook.id,
                        name: audiobook.name,
                        imageUrl: imageUrl,
                        icon: '📚'
                    };

                    const nodeElement = this.createTreeNode(audiobookNode, 1);
                    childrenContainer.appendChild(nodeElement);
                });
                
                // Re-sort all nodes alphabetically
                const nodes = Array.from(childrenContainer.children);
                
                nodes.sort((a, b) => {
                    const nameA = a.querySelector('.tree-name')?.textContent || '';
                    const nameB = b.querySelector('.tree-name')?.textContent || '';
                    return nameA.localeCompare(nameB);
                });
                
                // Clear and re-add sorted audiobooks
                childrenContainer.innerHTML = '';
                nodes.forEach(node => childrenContainer.appendChild(node));
                
                // Update the content panel display with all loaded audiobooks so far
                allAudiobooks = allAudiobooks.concat(newAudiobooks);
                allAudiobooks.sort((a, b) => a.name.localeCompare(b.name));
                this.displayAudiobooksList(allAudiobooks);
            };
            
            const savedAudiobooks = await SpotifyAPI.getSavedAudiobooks(50, onPageLoaded);
            
            if (!savedAudiobooks || savedAudiobooks.length === 0) {
                this.displayAudiobooksList([]);
                return;
            }

            // Expand the audiobooks node only on first load
            if (isFirstLoad && !audiobooksRootNode.classList.contains('expanded')) {
                this.toggleTreeNode(audiobooksRootNode);
            }
            
            // Show the refresh button now that children are populated
            const refreshButton = audiobooksRootNode.querySelector('.tree-refresh-button');
            if (refreshButton) {
                refreshButton.style.display = 'flex';
            }

            // Extract audiobook objects from the saved audiobooks response
            const audiobooks = savedAudiobooks.map(item => item.audiobook || item).filter(audiobook => audiobook !== null);
            allAudiobooks = audiobooks;

            // Sort audiobooks alphabetically by name
            allAudiobooks.sort((a, b) => a.name.localeCompare(b.name));

            // Note: Audiobooks are already added via onPageLoaded callback
            // This section is kept for potential future use
            if (false) {
            allAudiobooks.forEach(audiobook => {
                // Get the smallest image for the tree
                let imageUrl = null;
                if (audiobook.images && audiobook.images.length > 0) {
                    // Use the smallest image (last in array)
                    imageUrl = audiobook.images[audiobook.images.length - 1]?.url || null;
                }

                const audiobookNode = {
                    id: `audiobook-${audiobook.id}`,
                    audiobookId: audiobook.id,
                    name: audiobook.name,
                    imageUrl: imageUrl,
                    icon: '📚'
                };

                const nodeElement = this.createTreeNode(audiobookNode, 1);
                childrenContainer.appendChild(nodeElement);
            });
            }

            // Display list of audiobooks in content panel
            this.displayAudiobooksList(allAudiobooks);

        } catch (error) {
            console.error('Error loading audiobooks:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load audiobooks. Please try again.</div>';
        }
    },

    displayAudiobooksList(audiobooks) {
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'audiobooks-list-container';

        const title = document.createElement('h1');
        title.className = 'audiobooks-list-title';
        title.textContent = 'Your Audiobooks';
        container.appendChild(title);

        const audiobooksList = document.createElement('div');
        audiobooksList.className = 'audiobooks-list';

        if (audiobooks.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-message';
            emptyMsg.textContent = 'No audiobooks saved yet.';
            audiobooksList.appendChild(emptyMsg);
        } else {
            // Add audiobooks
            audiobooks.forEach(audiobook => {
                const audiobookItem = document.createElement('div');
                audiobookItem.className = 'audiobook-list-item';

                // Audiobook image - use medium size for better quality
                if (audiobook.images && audiobook.images.length > 0) {
                    const img = document.createElement('img');
                    img.className = 'audiobook-list-image';
                    // Use middle-sized image (index 1) if available, otherwise use first
                    img.src = audiobook.images[1]?.url || audiobook.images[0]?.url || '';
                    img.alt = audiobook.name;
                    audiobookItem.appendChild(img);
                }

                // Audiobook name
                const nameDiv = document.createElement('div');
                nameDiv.className = 'audiobook-list-name';
                nameDiv.textContent = audiobook.name;
                audiobookItem.appendChild(nameDiv);

                // Authors
                if (audiobook.authors && audiobook.authors.length > 0) {
                    const authorsDiv = document.createElement('div');
                    authorsDiv.className = 'audiobook-list-authors';
                    authorsDiv.textContent = audiobook.authors.map(a => a.name).join(', ');
                    audiobookItem.appendChild(authorsDiv);
                }

                // Click handler
                audiobookItem.addEventListener('click', () => {
                    this.displayAudiobookDetails(audiobook.id);
                });

                audiobooksList.appendChild(audiobookItem);
            });
        }

        container.appendChild(audiobooksList);
        contentPanel.appendChild(container);
    },

    async displayAudiobookDetails(audiobookId) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        // Push to history
        this.pushHistoryState({
            type: 'audiobook',
            audiobookId: audiobookId
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading audiobook details...</div>';

        try {
            // Fetch audiobook details
            const audiobook = await SpotifyAPI.getAudiobook(audiobookId);
            
            if (!audiobook) {
                contentPanel.innerHTML = '<div class="error">Failed to load audiobook details.</div>';
                return;
            }

            let chaptersContainer = null;
            let allChapters = [];
            
            const onPageLoaded = (newChapters, totalLoaded, hasMore) => {
                newChapters.forEach(chapter => {
                    if (!chapter) return; // Skip null chapters
                    allChapters.push(chapter); // Add to allChapters array
                });
                
                // Re-display chapters in order
                if (chaptersContainer) {
                    chaptersContainer.innerHTML = '';
                    allChapters.forEach(chapter => {
                        const chapterElement = this.createChapterElement(chapter);
                        chaptersContainer.appendChild(chapterElement);
                    });
                }
            };

            const chapters = await SpotifyAPI.getAudiobookChapters(audiobookId, 50, onPageLoaded);
            allChapters = chapters || [];

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'audiobook-details-container';
            container.style.position = 'relative';

            // Header section with image and info side by side
            const headerSection = document.createElement('div');
            headerSection.className = 'audiobook-details-header';

            // Large audiobook image (left side)
            if (audiobook.images && audiobook.images.length > 0 && audiobook.images[0]?.url) {
                const img = document.createElement('img');
                img.className = 'audiobook-details-image';
                img.src = audiobook.images[0].url;
                img.alt = audiobook.name;
                headerSection.appendChild(img);
            }

            // Audiobook info (right side)
            const infoSection = document.createElement('div');
            infoSection.className = 'audiobook-details-info';

            // Audiobook name with explicit badge
            const nameContainer = document.createElement('div');
            nameContainer.className = 'audiobook-details-name-container';
            
            const name = document.createElement('h1');
            name.className = 'audiobook-details-name';
            name.textContent = audiobook.name || 'Untitled Audiobook';
            nameContainer.appendChild(name);
            
            if (audiobook.explicit) {
                const explicitBadge = document.createElement('span');
                explicitBadge.className = 'explicit-badge-large';
                explicitBadge.textContent = '🄴';
                nameContainer.appendChild(explicitBadge);
            }
            
            infoSection.appendChild(nameContainer);

            // Authors
            if (audiobook.authors && audiobook.authors.length > 0) {
                const authorsDiv = document.createElement('div');
                authorsDiv.className = 'audiobook-details-authors';
                authorsDiv.textContent = audiobook.authors.map(a => a.name).join(', ');
                infoSection.appendChild(authorsDiv);
            }

            // Narrators, Publisher, and Chapter count
            const metaDiv = document.createElement('div');
            metaDiv.className = 'audiobook-details-meta';
            
            let metaText = '';
            if (audiobook.narrators && audiobook.narrators.length > 0) {
                metaText += `Narrator(s): ${audiobook.narrators.map(n => n.name).join(', ')}`;
            }
            if (audiobook.publisher) {
                if (metaText) metaText += ', ';
                metaText += `Publisher: ${audiobook.publisher}`;
            }
            if (audiobook.total_chapters !== null && audiobook.total_chapters !== undefined) {
                if (metaText) metaText += ', ';
                metaText += `Chapters: ${audiobook.total_chapters}`;
            }
            metaDiv.textContent = metaText;
            infoSection.appendChild(metaDiv);

            // Description
            if (audiobook.html_description || audiobook.description) {
                const descDiv = document.createElement('div');
                descDiv.className = 'audiobook-details-description';
                descDiv.innerHTML = audiobook.html_description || audiobook.description;
                infoSection.appendChild(descDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add liked/saved icon in top-right
            const likedIconTopRight = this.createLikedIcon(false, 'liked-icon-top-right', 'audiobook', audiobook.id, {
                name: audiobook.name,
                imageUrl: audiobook.images && audiobook.images.length > 0 ? audiobook.images[0]?.url : null
            });
            container.appendChild(likedIconTopRight);
            
            // Fetch audiobook saved status in background
            (async () => {
                try {
                    const savedStatuses = await SpotifyAPI.checkLikedAudiobooks([audiobook.id]);
                    const icon = container.querySelector('.liked-icon-top-right');
                    if (icon && savedStatuses.length > 0) {
                        icon.className = `liked-icon ${savedStatuses[0] ? 'liked' : 'unliked'} liked-icon-top-right`;
                        icon.title = savedStatuses[0] ? 'Saved' : 'Not saved';
                    }
                } catch (error) {
                    console.error('Error fetching audiobook saved status:', error);
                }
            })();

            // Chapters section
            if (allChapters.length > 0) {
                const chaptersSection = document.createElement('div');
                chaptersSection.className = 'audiobook-chapters-section';

                const chaptersTitle = document.createElement('h2');
                chaptersTitle.className = 'audiobook-chapters-title';
                chaptersTitle.textContent = 'Chapters';
                chaptersSection.appendChild(chaptersTitle);

                chaptersContainer = document.createElement('div');
                chaptersContainer.className = 'audiobook-chapters-list';

                // Display chapters
                allChapters.forEach(chapter => {
                    const chapterElement = this.createChapterElement(chapter);
                    chaptersContainer.appendChild(chapterElement);
                });

                chaptersSection.appendChild(chaptersContainer);
                container.appendChild(chaptersSection);
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying audiobook details:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load audiobook details. Please try again.</div>';
        }
    },

    createChapterElement(chapter) {
        if (!chapter) return document.createElement('div'); // Return empty div for null chapters
        
        const chapterItem = document.createElement('div');
        chapterItem.className = 'chapter-item clickable-chapter';
        
        // Store ID for tracking
        if (chapter.id) {
            chapterItem.dataset.itemId = chapter.id;
        }

        // Check if this is the currently playing item
        const isCurrentlyPlaying = chapter.id && this.isCurrentlyPlayingItem(chapter.id);
        if (isCurrentlyPlaying) {
            chapterItem.classList.add('currently-playing');
        }

        // Check if playable and apply grey styling
        const isPlayable = chapter.is_playable !== false && !(chapter.restrictions && chapter.restrictions.reason);
        if (!isPlayable) {
            chapterItem.style.color = '#666';
            chapterItem.style.cursor = 'not-allowed';
        }

        // Chapter image (with play icon overlay if currently playing)
        if (chapter.images && Array.isArray(chapter.images) && chapter.images.length > 0 && chapter.images[0]?.url) {
            const img = document.createElement('img');
            img.className = 'chapter-image';
            img.src = chapter.images[0].url;
            img.alt = chapter.name || 'Chapter';
            
            if (isCurrentlyPlaying) {
                const imageContainer = document.createElement('div');
                imageContainer.className = 'chapter-image-container';
                const playIconOverlay = document.createElement('div');
                playIconOverlay.className = 'play-icon-overlay';
                playIconOverlay.innerHTML = '▶';
                imageContainer.appendChild(img);
                imageContainer.appendChild(playIconOverlay);
                chapterItem.appendChild(imageContainer);
            } else {
                chapterItem.appendChild(img);
            }
        }

        // Chapter info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'chapter-info';

        // Chapter name and metadata on same line
        const headerDiv = document.createElement('div');
        headerDiv.className = 'chapter-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'chapter-name';
        nameSpan.textContent = chapter.name || 'Untitled Chapter';
        headerDiv.appendChild(nameSpan);

        const metaSpan = document.createElement('span');
        metaSpan.className = 'chapter-meta';
        
        // Chapter number and duration
        let metaText = '';
        if (chapter.chapter_number !== null && chapter.chapter_number !== undefined) {
            metaText += `Chapter ${chapter.chapter_number}`;
        }
        if (chapter.duration_ms) {
            const duration = this.formatDuration(chapter.duration_ms);
            if (metaText) metaText += ' • ';
            metaText += duration;
        }
        
        metaSpan.textContent = metaText;
        headerDiv.appendChild(metaSpan);

        infoDiv.appendChild(headerDiv);

        // Resume point badges and description
        const descriptionContainer = document.createElement('div');
        descriptionContainer.className = 'chapter-description-container';
        
        // Check resume point
        const resumePoint = chapter.resume_point || {};
        const fullyPlayed = resumePoint.fully_played || false;
        const resumePosition = resumePoint.resume_position_ms || 0;
        
        if (fullyPlayed) {
            const playedBadge = document.createElement('span');
            playedBadge.className = 'chapter-status-badge';
            playedBadge.textContent = 'played';
            descriptionContainer.appendChild(playedBadge);
        } else if (resumePosition > 0 && chapter.duration_ms) {
            const timeLeft = chapter.duration_ms - resumePosition;
            const timeLeftFormatted = this.formatDuration(timeLeft);
            const leftBadge = document.createElement('span');
            leftBadge.className = 'chapter-status-badge';
            leftBadge.textContent = `${timeLeftFormatted} left`;
            descriptionContainer.appendChild(leftBadge);
        }

        // Description
        if (chapter.html_description || chapter.description) {
            const descDiv = document.createElement('span');
            descDiv.className = 'chapter-description-text';
            descDiv.innerHTML = chapter.html_description || chapter.description;
            descriptionContainer.appendChild(descDiv);
        }
        
        infoDiv.appendChild(descriptionContainer);

        chapterItem.appendChild(infoDiv);

        // Add click handler to play chapter or toggle play/pause if currently playing
        if (isPlayable) {
            chapterItem.addEventListener('click', async (e) => {
                // Handle Ctrl-click for toggle selection
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.toggleItemSelection(chapterItem);
                    return;
                }
                
                // Handle Shift-click for range selection
                if (e.shiftKey) {
                    e.preventDefault();
                    this.selectItemRange(chapterItem, 'chapter-item');
                    return;
                }
                
                // Normal click: clear selection and play
                this.clearTrackSelection();
                
                try {
                    // Check if this is the currently playing chapter at click time
                    const isCurrentlyPlayingNow = chapter.id && this.isCurrentlyPlayingItem(chapter.id);
                    if (isCurrentlyPlayingNow) {
                        // Toggle play/pause
                        if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                            await SpotifyAPI.pause();
                            console.log('Paused chapter:', chapter.name);
                        } else {
                            await SpotifyAPI.play();
                            console.log('Resumed chapter:', chapter.name);
                        }
                    } else {
                        // Play this chapter
                        await SpotifyAPI.playContentUri(chapter.uri);
                        console.log('Playing chapter:', chapter.name);
                    }
                } catch (error) {
                    console.error('Error playing chapter:', error);
                }
            });
        }

        return chapterItem;
    },

    async displayLikedEpisodesDetails() {
        // Push to history
        this.pushHistoryState({
            type: 'liked-episodes'
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading Liked Episodes...</div>';

        try {
            let episodesContainer = null;
            let allEpisodes = [];
            let filterSelectRef = null;
            let sortButtonRef = null;
            
            // Function to filter and display episodes (defined early so callback can use it)
            const displayFilteredEpisodes = (filter, sortOrder) => {
                if (!episodesContainer) return;
                
                // Filter episodes - extract episode from saved episode response
                let filteredEpisodes = allEpisodes.map(item => item.episode).filter(episode => {
                    if (!episode) return false;
                    
                    if (filter === 'all') return true;
                    
                    const resumePoint = item.episode?.resume_point || {};
                    const fullyPlayed = resumePoint.fully_played || false;
                    const resumePosition = resumePoint.resume_position_ms || 0;
                    
                    if (filter === 'in-progress') {
                        // In progress: NOT fully played AND has resume position
                        return !fullyPlayed && resumePosition > 0;
                    } else if (filter === 'unplayed') {
                        // Unplayed: NOT fully played AND no resume position
                        return !fullyPlayed && resumePosition === 0;
                    }
                    
                    return true;
                });
                
                // Sort episodes
                filteredEpisodes.sort((a, b) => {
                    const dateA = new Date(a.release_date);
                    const dateB = new Date(b.release_date);
                    return sortOrder === 'newest-first' ? dateB - dateA : dateA - dateB;
                });
                
                // Clear and repopulate
                episodesContainer.innerHTML = '';
                filteredEpisodes.forEach(episode => {
                    const episodeElement = this.createEpisodeElement(episode, true);
                    episodesContainer.appendChild(episodeElement);
                });
            };
            
            const onPageLoaded = (newItems, totalLoaded, hasMore) => {
                newItems.forEach(item => {
                    if (!item) return;
                    allEpisodes.push(item);
                });
                
                // Re-apply current filter and sort
                if (filterSelectRef && sortButtonRef && episodesContainer) {
                    const currentFilter = filterSelectRef.value;
                    const currentSort = sortButtonRef.dataset.sortOrder;
                    displayFilteredEpisodes(currentFilter, currentSort);
                }
            };

            const savedEpisodes = await SpotifyAPI.getLikedEpisodes(50, onPageLoaded);
            allEpisodes = savedEpisodes || [];

            if (allEpisodes.length === 0) {
                contentPanel.innerHTML = '<div class="empty-message">You have no liked episodes yet.</div>';
                return;
            }

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'podcast-details-container';

            // Header section
            const headerSection = document.createElement('div');
            headerSection.className = 'podcast-details-header';

            // Purple heart icon
            const iconDiv = document.createElement('div');
            iconDiv.className = 'liked-songs-icon';
            iconDiv.innerHTML = '\ud83d\udc9c';
            headerSection.appendChild(iconDiv);

            // Info section
            const infoSection = document.createElement('div');
            infoSection.className = 'podcast-details-info';

            // Title
            const name = document.createElement('h1');
            name.className = 'podcast-details-name';
            name.textContent = 'Liked Episodes';
            infoSection.appendChild(name);

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Episodes section
            if (allEpisodes.length > 0) {
                const episodesSection = document.createElement('div');
                episodesSection.className = 'podcast-episodes-section';

                // Header with title, filter dropdown, and sort button
                const episodesHeader = document.createElement('div');
                episodesHeader.className = 'podcast-episodes-header';

                const episodesTitle = document.createElement('h2');
                episodesTitle.className = 'podcast-episodes-title';
                episodesTitle.textContent = 'Episodes';
                episodesHeader.appendChild(episodesTitle);

                const episodesControls = document.createElement('div');
                episodesControls.className = 'podcast-episodes-controls';

                // Filter dropdown
                const filterSelect = document.createElement('select');
                filterSelect.className = 'episode-filter-dropdown';
                filterSelectRef = filterSelect;
                
                const filterOptions = [
                    { value: 'all', text: 'All episodes' },
                    { value: 'unplayed', text: 'Unplayed' },
                    { value: 'in-progress', text: 'In Progress' }
                ];
                
                filterOptions.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.text;
                    filterSelect.appendChild(option);
                });
                
                episodesControls.appendChild(filterSelect);

                // Sort toggle button
                const sortButton = document.createElement('button');
                sortButton.className = 'episode-sort-button';
                sortButton.textContent = 'Newest at the top';
                sortButton.dataset.sortOrder = 'newest-first';
                sortButtonRef = sortButton;
                episodesControls.appendChild(sortButton);

                episodesHeader.appendChild(episodesControls);
                episodesSection.appendChild(episodesHeader);

                episodesContainer = document.createElement('div');
                episodesContainer.className = 'podcast-episodes-list';

                // Initial display
                displayFilteredEpisodes('all', 'newest-first');

                // Filter change handler
                filterSelect.addEventListener('change', () => {
                    displayFilteredEpisodes(filterSelect.value, sortButton.dataset.sortOrder);
                });

                // Sort button click handler
                sortButton.addEventListener('click', () => {
                    const currentOrder = sortButton.dataset.sortOrder;
                    const newOrder = currentOrder === 'newest-first' ? 'oldest-first' : 'newest-first';
                    sortButton.dataset.sortOrder = newOrder;
                    sortButton.textContent = newOrder === 'newest-first' ? 'Newest at the top' : 'Oldest at the top';
                    displayFilteredEpisodes(filterSelect.value, newOrder);
                });

                episodesSection.appendChild(episodesContainer);
                container.appendChild(episodesSection);
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying liked episodes:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load liked episodes. Please try again.</div>';
        }
    },

    async displayPodcastDetails(podcastId) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        // Push to history
        this.pushHistoryState({
            type: 'podcast',
            podcastId: podcastId
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '<div class="loading">Loading podcast details...</div>';

        try {
            // Fetch podcast details and episodes in parallel
            const podcast = await SpotifyAPI.getPodcast(podcastId);
            
            if (!podcast) {
                contentPanel.innerHTML = '<div class="error">Failed to load podcast details.</div>';
                return;
            }

            let episodesContainer = null;
            let allEpisodes = [];
            let episodeLikedStatuses = new Map(); // Store liked statuses by episode ID
            let filterSelectRef = null;
            let sortButtonRef = null;
            
            // Function to filter and display episodes (defined early so callback can use it)
            const displayFilteredEpisodes = (filter, sortOrder) => {
                if (!episodesContainer) return;
                
                // Filter episodes
                let filteredEpisodes = allEpisodes.filter(episode => {
                    if (!episode) return false;
                    
                    if (filter === 'all') return true;
                    
                    const resumePoint = episode.resume_point || {};
                    const fullyPlayed = resumePoint.fully_played || false;
                    const resumePosition = resumePoint.resume_position_ms || 0;
                    
                    if (filter === 'in-progress') {
                        // In progress: NOT fully played AND has resume position
                        return !fullyPlayed && resumePosition > 0;
                    } else if (filter === 'unplayed') {
                        // Unplayed: NOT fully played AND no resume position
                        return !fullyPlayed && resumePosition === 0;
                    }
                    
                    return true;
                });
                
                // Sort episodes
                filteredEpisodes.sort((a, b) => {
                    const dateA = new Date(a.release_date);
                    const dateB = new Date(b.release_date);
                    return sortOrder === 'newest-first' ? dateB - dateA : dateA - dateB;
                });
                
                // Clear and repopulate
                episodesContainer.innerHTML = '';
                filteredEpisodes.forEach(episode => {
                    const episodeElement = this.createEpisodeElement(episode);
                    episodesContainer.appendChild(episodeElement);
                    
                    // Restore liked status if we have it
                    if (episode.id && episodeLikedStatuses.has(episode.id)) {
                        const likedPlaceholder = episodeElement.querySelector('.liked-icon-placeholder');
                        if (likedPlaceholder) {
                            likedPlaceholder.innerHTML = '';
                            const likedIcon = this.createLikedIcon(episodeLikedStatuses.get(episode.id), 'liked-icon-inline', 'episode', episode.id);
                            likedPlaceholder.appendChild(likedIcon);
                        }
                    }
                });
            };
            
            const onPageLoaded = (newEpisodes, totalLoaded, hasMore) => {
                newEpisodes.forEach(episode => {
                    if (!episode) return; // Skip null episodes
                    allEpisodes.push(episode); // Add to allEpisodes array
                });
                
                // Fetch liked status for new episodes
                (async () => {
                    try {
                        const episodeIds = newEpisodes
                            .filter(episode => episode && episode.id)
                            .map(episode => episode.id);
                        
                        if (episodeIds.length > 0) {
                            const likedStatuses = await SpotifyAPI.checkLikedEpisodes(episodeIds);
                            
                            // Store in the map
                            newEpisodes.forEach((episode, index) => {
                                if (episode && episode.id && index < likedStatuses.length) {
                                    episodeLikedStatuses.set(episode.id, likedStatuses[index]);
                                }
                            });
                            
                            // Re-apply current filter and sort (will now include liked icons)
                            if (filterSelectRef && sortButtonRef && episodesContainer) {
                                const currentFilter = filterSelectRef.value;
                                const currentSort = sortButtonRef.dataset.sortOrder;
                                displayFilteredEpisodes(currentFilter, currentSort);
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching liked statuses for new episodes:', error);
                    }
                })();
            };

            const episodes = await SpotifyAPI.getPodcastEpisodes(podcastId, 50, onPageLoaded);
            allEpisodes = episodes || [];

            // Sort episodes by release date (newest to oldest)
            allEpisodes.sort((a, b) => {
                const dateA = new Date(a.release_date);
                const dateB = new Date(b.release_date);
                return dateB - dateA;
            });

            contentPanel.innerHTML = '';
            const container = document.createElement('div');
            container.className = 'podcast-details-container';
            container.style.position = 'relative';

            // Header section with image and info side by side
            const headerSection = document.createElement('div');
            headerSection.className = 'podcast-details-header';

            // Large podcast image (left side)
            if (podcast.images && podcast.images.length > 0 && podcast.images[0]?.url) {
                const img = document.createElement('img');
                img.className = 'podcast-details-image';
                img.src = podcast.images[0].url;
                img.alt = podcast.name;
                headerSection.appendChild(img);
            }

            // Podcast info (right side)
            const infoSection = document.createElement('div');
            infoSection.className = 'podcast-details-info';

            // Podcast name with explicit badge
            const nameContainer = document.createElement('div');
            nameContainer.className = 'podcast-details-name-container';
            
            const name = document.createElement('h1');
            name.className = 'podcast-details-name';
            name.textContent = podcast.name || 'Untitled Podcast';
            nameContainer.appendChild(name);
            
            if (podcast.explicit) {
                const explicitBadge = document.createElement('span');
                explicitBadge.className = 'explicit-badge-large';
                explicitBadge.textContent = '🄴';
                nameContainer.appendChild(explicitBadge);
            }
            
            infoSection.appendChild(nameContainer);

            // Publisher
            if (podcast.publisher) {
                const publisherDiv = document.createElement('div');
                publisherDiv.className = 'podcast-details-publisher';
                publisherDiv.textContent = podcast.publisher;
                infoSection.appendChild(publisherDiv);
            }

            // Languages and episode count
            const metaDiv = document.createElement('div');
            metaDiv.className = 'podcast-details-meta';
            
            let metaText = '';
            if (podcast.languages && podcast.languages.length > 0) {
                metaText += `Languages: ${podcast.languages.join(', ')}`;
            }
            if (podcast.total_episodes !== null && podcast.total_episodes !== undefined) {
                if (metaText) metaText += ', ';
                metaText += `Episodes: ${podcast.total_episodes}`;
            }
            metaDiv.textContent = metaText;
            infoSection.appendChild(metaDiv);

            // Description
            if (podcast.html_description || podcast.description) {
                const descDiv = document.createElement('div');
                descDiv.className = 'podcast-details-description';
                descDiv.innerHTML = podcast.html_description || podcast.description;
                infoSection.appendChild(descDiv);
            }

            headerSection.appendChild(infoSection);
            container.appendChild(headerSection);

            // Add liked/followed icon in top-right (note: we check if this is from the "Liked Episodes" root)
            // For now we'll add it always and can skip if needed later based on calling context
            const likedIconTopRight = this.createLikedIcon(false, 'liked-icon-top-right', 'podcast', podcast.id, {
                name: podcast.name,
                imageUrl: podcast.images && podcast.images.length > 0 ? podcast.images[0]?.url : null
            });
            container.appendChild(likedIconTopRight);
            
            // Fetch podcast saved status in background
            (async () => {
                try {
                    const savedStatuses = await SpotifyAPI.checkLikedPodcasts([podcast.id]);
                    const icon = container.querySelector('.liked-icon-top-right');
                    if (icon && savedStatuses.length > 0) {
                        icon.className = `liked-icon ${savedStatuses[0] ? 'liked' : 'unliked'} liked-icon-top-right`;
                        icon.title = savedStatuses[0] ? 'Saved' : 'Not saved';
                    }
                } catch (error) {
                    console.error('Error fetching podcast saved status:', error);
                }
            })();

            // Episodes section
            if (allEpisodes.length > 0) {
                const episodesSection = document.createElement('div');
                episodesSection.className = 'podcast-episodes-section';

                // Header with title, filter dropdown, and sort button
                const episodesHeader = document.createElement('div');
                episodesHeader.className = 'podcast-episodes-header';

                const episodesTitle = document.createElement('h2');
                episodesTitle.className = 'podcast-episodes-title';
                episodesTitle.textContent = 'Episodes';
                episodesHeader.appendChild(episodesTitle);

                const episodesControls = document.createElement('div');
                episodesControls.className = 'podcast-episodes-controls';

                // Filter dropdown
                const filterSelect = document.createElement('select');
                filterSelect.className = 'episode-filter-dropdown';
                filterSelectRef = filterSelect; // Store reference
                
                const filterOptions = [
                    { value: 'all', text: 'All episodes' },
                    { value: 'unplayed', text: 'Unplayed' },
                    { value: 'in-progress', text: 'In Progress' }
                ];
                
                filterOptions.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.text;
                    filterSelect.appendChild(option);
                });
                
                episodesControls.appendChild(filterSelect);

                // Sort toggle button
                const sortButton = document.createElement('button');
                sortButton.className = 'episode-sort-button';
                sortButton.textContent = 'Newest at the top';
                sortButton.dataset.sortOrder = 'newest-first'; // Current state
                sortButtonRef = sortButton; // Store reference
                episodesControls.appendChild(sortButton);

                episodesHeader.appendChild(episodesControls);
                episodesSection.appendChild(episodesHeader);

                episodesContainer = document.createElement('div');
                episodesContainer.className = 'podcast-episodes-list';

                // Initial display
                displayFilteredEpisodes('all', 'newest-first');

                // Filter change handler
                filterSelect.addEventListener('change', () => {
                    displayFilteredEpisodes(filterSelect.value, sortButton.dataset.sortOrder);
                });

                // Sort button click handler
                sortButton.addEventListener('click', () => {
                    const currentOrder = sortButton.dataset.sortOrder;
                    const newOrder = currentOrder === 'newest-first' ? 'oldest-first' : 'newest-first';
                    sortButton.dataset.sortOrder = newOrder;
                    sortButton.textContent = newOrder === 'newest-first' ? 'Newest at the top' : 'Oldest at the top';
                    displayFilteredEpisodes(filterSelect.value, newOrder);
                });

                episodesSection.appendChild(episodesContainer);
                container.appendChild(episodesSection);
                
                // Fetch liked status for all episodes in background
                (async () => {
                    try {
                        // Collect all episode IDs
                        const episodeIds = allEpisodes
                            .filter(episode => episode && episode.id)
                            .map(episode => episode.id);
                        
                        if (episodeIds.length > 0) {
                            const likedStatuses = await SpotifyAPI.checkLikedEpisodes(episodeIds);
                            
                            // Store liked statuses in the Map for persistence across filtering
                            allEpisodes.forEach((episode, index) => {
                                if (episode && episode.id && index < likedStatuses.length) {
                                    episodeLikedStatuses.set(episode.id, likedStatuses[index]);
                                }
                            });
                            
                            // Update liked icons in episode items
                            const episodeItems = episodesContainer.querySelectorAll('.episode-item');
                            let statusIndex = 0;
                            episodeItems.forEach((item) => {
                                const episodeId = item.dataset.episodeId;
                                if (episodeId && statusIndex < likedStatuses.length) {
                                    const likedPlaceholder = item.querySelector('.liked-icon-placeholder');
                                    if (likedPlaceholder) {
                                        likedPlaceholder.innerHTML = '';
                                        const likedIcon = this.createLikedIcon(likedStatuses[statusIndex], 'liked-icon-inline', 'episode', episodeId);
                                        likedPlaceholder.appendChild(likedIcon);
                                    }
                                    statusIndex++;
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching episode liked statuses:', error);
                    }
                })();
            }

            contentPanel.appendChild(container);

        } catch (error) {
            console.error('Error displaying podcast details:', error);
            contentPanel.innerHTML = '<div class="error">Failed to load podcast details. Please try again.</div>';
        }
    },

    createEpisodeElement(episode, showDeleteButton = false) {
        if (!episode) return document.createElement('div'); // Return empty div for null episodes
        
        const episodeItem = document.createElement('div');
        episodeItem.className = 'episode-item clickable-episode';
        
        // Store ID and URI for tracking and drag operations
        if (episode.id) {
            episodeItem.dataset.itemId = episode.id;
            episodeItem.dataset.episodeId = episode.id; // Also store for liked status lookup
        }
        if (episode.uri) {
            episodeItem.dataset.uri = episode.uri;
        }
        episodeItem.dataset.itemType = 'episodes';
        
        // Make episode draggable
        episodeItem.setAttribute('draggable', 'true');
        
        // Prepare item data for drag operations
        const episodeData = {
            id: episode.id,
            uri: episode.uri,
            type: 'episode',
            name: episode.name,
            imageUrl: episode.images && episode.images[0]?.url,
            duration_ms: episode.duration_ms
        };
        
        // Attach drag event handlers
        episodeItem.addEventListener('dragstart', (e) => this.handleDragStart(e, episodeItem, episodeData));
        episodeItem.addEventListener('dragend', (e) => this.handleDragEnd(e, episodeItem));

        // Check if this is the currently playing item
        const isCurrentlyPlaying = episode.id && this.isCurrentlyPlayingItem(episode.id);
        if (isCurrentlyPlaying) {
            episodeItem.classList.add('currently-playing');
        }

        // Check if playable and apply grey styling
        const isPlayable = episode.is_playable !== false && !(episode.restrictions && episode.restrictions.reason);
        if (!isPlayable) {
            episodeItem.style.color = '#666';
            episodeItem.style.cursor = 'not-allowed';
        }

        // Episode image (with play icon overlay if currently playing)
        if (episode.images && Array.isArray(episode.images) && episode.images.length > 0 && episode.images[0]?.url) {
            const img = document.createElement('img');
            img.className = 'episode-image';
            img.src = episode.images[0].url;
            img.alt = episode.name || 'Episode';
            
            if (isCurrentlyPlaying) {
                const imageContainer = document.createElement('div');
                imageContainer.className = 'episode-image-container';
                const playIconOverlay = document.createElement('div');
                playIconOverlay.className = 'play-icon-overlay';
                playIconOverlay.innerHTML = '▶';
                imageContainer.appendChild(img);
                imageContainer.appendChild(playIconOverlay);
                episodeItem.appendChild(imageContainer);
            } else {
                episodeItem.appendChild(img);
            }
        }

        // Episode info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'episode-info';

        // Episode name and metadata on same line
        const headerDiv = document.createElement('div');
        headerDiv.className = 'episode-header';

        // Liked icon placeholder (will be filled in after fetch)
        const likedPlaceholder = document.createElement('span');
        likedPlaceholder.className = 'liked-icon-placeholder';
        headerDiv.appendChild(likedPlaceholder);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'episode-name';
        nameSpan.textContent = episode.name || 'Untitled Episode';
        headerDiv.appendChild(nameSpan);

        const metaSpan = document.createElement('span');
        metaSpan.className = 'episode-meta';
        
        // Release date
        const releaseDate = new Date(episode.release_date);
        const formattedDate = releaseDate.toLocaleDateString();
        
        // Duration
        const duration = this.formatDuration(episode.duration_ms);
        
        metaSpan.textContent = `${formattedDate} • ${duration}`;
        headerDiv.appendChild(metaSpan);

        // Add delete button if requested (for liked episodes)
        if (showDeleteButton) {
            const deleteButton = document.createElement('span');
            deleteButton.className = 'delete-episode-button';
            deleteButton.style.marginLeft = 'auto';
            deleteButton.style.cursor = 'pointer';
            deleteButton.style.fontSize = '1.2em';
            deleteButton.innerHTML = '🗑️';
            deleteButton.title = 'Unlike this episode';
            deleteButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await SpotifyAPI.unsaveEpisodes([episode.id]);
                    episodeItem.remove();
                    console.log('Unliked episode:', episode.name);
                } catch (error) {
                    console.error('Error unliking episode:', error);
                    alert('Failed to unlike episode. Please try again.');
                }
            });
            headerDiv.appendChild(deleteButton);
        }

        infoDiv.appendChild(headerDiv);

        // Resume point badges and description
        const descriptionContainer = document.createElement('div');
        descriptionContainer.className = 'episode-description-container';
        
        // Check resume point
        const resumePoint = episode.resume_point || {};
        const fullyPlayed = resumePoint.fully_played || false;
        const resumePosition = resumePoint.resume_position_ms || 0;
        
        if (fullyPlayed) {
            const playedBadge = document.createElement('span');
            playedBadge.className = 'episode-status-badge';
            playedBadge.textContent = 'played';
            descriptionContainer.appendChild(playedBadge);
        } else if (resumePosition > 0 && episode.duration_ms) {
            const timeLeft = episode.duration_ms - resumePosition;
            const timeLeftFormatted = this.formatDuration(timeLeft);
            const leftBadge = document.createElement('span');
            leftBadge.className = 'episode-status-badge';
            leftBadge.textContent = `${timeLeftFormatted} left`;
            descriptionContainer.appendChild(leftBadge);
        }

        // Description (first two lines, using text description)
        if (episode.description) {
            const descDiv = document.createElement('span');
            descDiv.className = 'episode-description-text';
            descDiv.textContent = episode.description;
            descriptionContainer.appendChild(descDiv);
        }
        
        infoDiv.appendChild(descriptionContainer);

        episodeItem.appendChild(infoDiv);

        // Add click handler to play episode or toggle play/pause if currently playing
        if (isPlayable) {
            episodeItem.addEventListener('click', async (e) => {
                // Handle Ctrl-click for toggle selection
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.toggleItemSelection(episodeItem);
                    return;
                }
                
                // Handle Shift-click for range selection
                if (e.shiftKey) {
                    e.preventDefault();
                    this.selectItemRange(episodeItem, 'episode-item');
                    return;
                }
                
                // Normal click: clear selection and play
                this.clearTrackSelection();
                
                try {
                    // Check if this is the currently playing episode at click time
                    const isCurrentlyPlayingNow = episode.id && this.isCurrentlyPlayingItem(episode.id);
                    if (isCurrentlyPlayingNow) {
                        // Toggle play/pause
                        if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                            await SpotifyAPI.pause();
                            console.log('Paused episode:', episode.name);
                        } else {
                            await SpotifyAPI.play();
                            console.log('Resumed episode:', episode.name);
                        }
                    } else {
                        // Play this episode
                        await SpotifyAPI.playContentUri(episode.uri);
                        console.log('Playing episode:', episode.name);
                    }
                } catch (error) {
                    console.error('Error playing episode:', error);
                }
            });
        }

        return episodeItem;
    },

    async performSearch(query) {
        try {
            // Show loading state
            const contentPanel = document.querySelector('.content-panel');
            contentPanel.innerHTML = '<div class="loading">Searching...</div>';

            // Store references to result sections for progressive loading
            const resultSectionsByType = {};
            
            const onPageLoaded = (newItems, totalLoaded, hasMore, type) => {
                // Get the section for this type
                const typeKey = type + 's'; // Convert 'track' to 'tracks', etc.
                const section = resultSectionsByType[typeKey];
                
                if (section) {
                    // Add new items to the section
                    newItems.forEach(item => {
                        if (!item) return;
                        const resultItem = this.createResultItem(item, typeKey);
                        section.appendChild(resultItem);
                    });
                }
            };

            // Perform search
            const results = await SpotifyAPI.search(query, ['album', 'artist', 'playlist', 'track', 'show', 'episode', 'audiobook'], 20, onPageLoaded);
            
            if (!results) {
                contentPanel.innerHTML = '<div class="error">Search failed. Please try again.</div>';
                return;
            }

            // Add search result node to tree and get reference to it
            const queryNode = this.addSearchResultNode(query);

            // Display initial results and store section references
            contentPanel.innerHTML = '';

            // Create results container
            const resultsContainer = document.createElement('div');
            resultsContainer.className = 'search-results-container';

            // Add title
            const title = document.createElement('h1');
            title.className = 'search-results-title';
            title.textContent = `Search Results for "${query}"`;
            resultsContainer.appendChild(title);

            // Define result types and their display names
            const resultTypes = [
                { key: 'tracks', name: 'Tracks' },
                { key: 'albums', name: 'Albums' },
                { key: 'artists', name: 'Artists' },
                { key: 'playlists', name: 'Playlists' },
                { key: 'shows', name: 'Podcasts' },
                { key: 'episodes', name: 'Episodes' },
                { key: 'audiobooks', name: 'Audiobooks' }
            ];

            resultTypes.forEach(type => {
                if (results[type.key] && results[type.key].items && results[type.key].items.length > 0) {
                    const section = this.createResultSection(type.name, results[type.key].items, type.key);
                    resultsContainer.appendChild(section);
                    
                    // Store reference to the content div for progressive loading
                    const contentDiv = section.querySelector('.result-section-content');
                    if (contentDiv) {
                        resultSectionsByType[type.key] = contentDiv;
                    }
                }
            });

            contentPanel.appendChild(resultsContainer);
            
            // Fetch liked/followed statuses for initial results
            this.fetchAndUpdateSearchLikedStatuses(resultsContainer, results);
            
            // Store the search results data on the node instead of HTML
            if (queryNode) {
                queryNode.searchResultsData = {
                    query: query,
                    results: results
                };
            }
            
            // Push to history for browser back/forward support
            this.pushHistoryState({
                type: 'search-results',
                searchData: {
                    query: query,
                    results: results
                }
            });

        } catch (error) {
            console.error('Search error:', error);
            const contentPanel = document.querySelector('.content-panel');
            contentPanel.innerHTML = '<div class="error">Search failed. Please try again.</div>';
        }
    },

    addSearchResultNode(query) {
        // Find the search-results root node
        const searchResultsNode = document.querySelector('[data-node-id="search-results"]');
        if (!searchResultsNode) return;

        // Check if this query already exists
        let childrenContainer = searchResultsNode.querySelector('.tree-children');
        if (childrenContainer) {
            const existingNode = Array.from(childrenContainer.children).find(
                child => child.querySelector('.tree-name')?.textContent === query
            );
            if (existingNode) {
                // Select existing node
                document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
                existingNode.classList.add('selected');
                return existingNode;
            }
        } else {
            // Create children container
            childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            searchResultsNode.appendChild(childrenContainer);
            
            // Show disclosure triangle
            const disclosure = searchResultsNode.querySelector('.tree-disclosure');
            if (disclosure) {
                disclosure.style.visibility = 'visible';
            }
        }

        // Create new child node for this query (no icon)
        const queryNode = document.createElement('div');
        queryNode.className = 'tree-node';
        queryNode.style.paddingLeft = '30px';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'tree-node-content';
        
        // No disclosure triangle for leaf nodes
        const disclosure = document.createElement('span');
        disclosure.className = 'tree-disclosure';
        disclosure.style.visibility = 'hidden';
        
        // Tree icon container with trash button
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        
        // Trash can button inside icon
        const trashBtn = document.createElement('button');
        trashBtn.className = 'tree-delete-btn';
        trashBtn.innerHTML = '🗑️';
        trashBtn.title = 'Delete search result';
        trashBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteSearchResultNode(queryNode, childrenContainer);
        });
        
        icon.appendChild(trashBtn);
        
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = query;
        
        contentDiv.appendChild(disclosure);
        contentDiv.appendChild(icon);
        contentDiv.appendChild(name);
        queryNode.appendChild(contentDiv);
        
        // Click handler (exclude trash button)
        const clickHandler = (e) => {
            // Don't trigger if clicking the trash button
            if (e.target.closest('.tree-delete-btn')) return;
            
            document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
            queryNode.classList.add('selected');
            // Re-display the search results with proper event handlers
            if (queryNode.searchResultsData) {
                this.redisplaySearchResults(queryNode.searchResultsData);
            }
        };
        contentDiv.addEventListener('click', clickHandler);
        
        childrenContainer.appendChild(queryNode);
        
        // Expand the search-results node
        if (!searchResultsNode.classList.contains('expanded')) {
            this.toggleTreeNode(searchResultsNode);
        }
        
        // Select the new query node
        document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
        queryNode.classList.add('selected');
        
        // Return the query node so we can store HTML on it
        return queryNode;
    },

    deleteSearchResultNode(nodeToDelete, childrenContainer) {
        const wasSelected = nodeToDelete.classList.contains('selected');
        
        // If this was the selected node, select the previous sibling or parent
        if (wasSelected) {
            const allNodes = Array.from(document.querySelectorAll('.tree-node'));
            const currentIndex = allNodes.indexOf(nodeToDelete);
            
            // Try to select the node above (previous in the list)
            if (currentIndex > 0) {
                const nodeAbove = allNodes[currentIndex - 1];
                nodeAbove.classList.add('selected');
                
                // Trigger click to display content if it has stored data
                const clickEvent = new Event('click', { bubbles: true });
                nodeAbove.querySelector('.tree-node-content')?.dispatchEvent(clickEvent);
            }
        }
        
        // Clear stored search results from memory
        if (nodeToDelete.searchResultsData) {
            delete nodeToDelete.searchResultsData;
        }
        
        // Remove the node from the DOM
        nodeToDelete.remove();
        
        // If no children left, hide the disclosure triangle on the parent
        if (childrenContainer.children.length === 0) {
            const searchResultsNode = document.querySelector('[data-node-id="search-results"]');
            const disclosure = searchResultsNode?.querySelector('.tree-disclosure');
            if (disclosure) {
                disclosure.style.visibility = 'hidden';
            }
            
            // Collapse the parent node
            if (searchResultsNode?.classList.contains('expanded')) {
                this.toggleTreeNode(searchResultsNode);
            }
        }
    },

    displaySearchResults(query, results) {
        // Clear any track selection from previous view
        this.clearTrackSelection();
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        // Create results container
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'search-results-container';

        // Add title
        const title = document.createElement('h1');
        title.className = 'search-results-title';
        title.textContent = `Search Results for "${query}"`;
        resultsContainer.appendChild(title);

        // Define result types and their display names
        const resultTypes = [
            { key: 'tracks', name: 'Tracks' },
            { key: 'albums', name: 'Albums' },
            { key: 'artists', name: 'Artists' },
            { key: 'playlists', name: 'Playlists' },
            { key: 'shows', name: 'Podcasts' },
            { key: 'episodes', name: 'Episodes' },
            { key: 'audiobooks', name: 'Audiobooks' }
        ];

        resultTypes.forEach(type => {
            if (results[type.key] && results[type.key].items && results[type.key].items.length > 0) {
                const section = this.createResultSection(type.name, results[type.key].items, type.key);
                resultsContainer.appendChild(section);
            }
        });

        contentPanel.appendChild(resultsContainer);
        
        // Fetch liked/followed statuses for all items in background
        this.fetchAndUpdateSearchLikedStatuses(resultsContainer, results);
    },

    redisplaySearchResults(searchData) {
        // Push to history
        this.pushHistoryState({
            type: 'search-results',
            searchData: searchData
        });
        
        const contentPanel = document.querySelector('.content-panel');
        contentPanel.innerHTML = '';

        // Create results container
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'search-results-container';

        // Add title
        const title = document.createElement('h1');
        title.className = 'search-results-title';
        title.textContent = `Search Results for "${searchData.query}"`;
        resultsContainer.appendChild(title);

        // Define result types and their display names
        const resultTypes = [
            { key: 'tracks', name: 'Tracks' },
            { key: 'albums', name: 'Albums' },
            { key: 'artists', name: 'Artists' },
            { key: 'playlists', name: 'Playlists' },
            { key: 'shows', name: 'Podcasts' },
            { key: 'episodes', name: 'Episodes' },
            { key: 'audiobooks', name: 'Audiobooks' }
        ];

        resultTypes.forEach(type => {
            if (searchData.results[type.key] && searchData.results[type.key].items && searchData.results[type.key].items.length > 0) {
                const section = this.createResultSection(type.name, searchData.results[type.key].items, type.key);
                resultsContainer.appendChild(section);
            }
        });

        contentPanel.appendChild(resultsContainer);
        
        // Fetch liked/followed statuses for all items in background
        this.fetchAndUpdateSearchLikedStatuses(resultsContainer, searchData.results);
    },

    async fetchAndUpdateSearchLikedStatuses(resultsContainer, results) {
        try {
            // Collect IDs for each type
            const trackIds = results.tracks?.items?.filter(t => t && t.id).map(t => t.id) || [];
            const albumIds = results.albums?.items?.filter(a => a && a.id).map(a => a.id) || [];
            const artistIds = results.artists?.items?.filter(a => a && a.id).map(a => a.id) || [];
            const playlistIds = results.playlists?.items?.filter(p => p && p.id).map(p => p.id) || [];
            const showIds = results.shows?.items?.filter(s => s && s.id).map(s => s.id) || [];
            const episodeIds = results.episodes?.items?.filter(e => e && e.id).map(e => e.id) || [];
            const audiobookIds = results.audiobooks?.items?.filter(a => a && a.id).map(a => a.id) || [];
            
            // Fetch all statuses in parallel
            const [trackStatuses, albumStatuses, artistStatuses, playlistStatuses, showStatuses, episodeStatuses, audiobookStatuses] = await Promise.all([
                trackIds.length > 0 ? SpotifyAPI.checkLikedTracks(trackIds) : Promise.resolve([]),
                albumIds.length > 0 ? SpotifyAPI.checkLikedAlbums(albumIds) : Promise.resolve([]),
                artistIds.length > 0 ? SpotifyAPI.checkFollowedArtists(artistIds) : Promise.resolve([]),
                playlistIds.length > 0 ? Promise.all(playlistIds.map(id => SpotifyAPI.checkFollowedPlaylist(id))) : Promise.resolve([]),
                showIds.length > 0 ? SpotifyAPI.checkLikedPodcasts(showIds) : Promise.resolve([]),
                episodeIds.length > 0 ? SpotifyAPI.checkLikedEpisodes(episodeIds) : Promise.resolve([]),
                audiobookIds.length > 0 ? SpotifyAPI.checkLikedAudiobooks(audiobookIds) : Promise.resolve([])
            ]);
            
            // Update icons for each type
            const updateIcons = (typeKey, statuses, items) => {
                // Filter out null items first
                const validItems = items.filter(item => item && item.id);
                
                const itemElements = resultsContainer.querySelectorAll(`.result-item[data-item-type="${typeKey}"]`);
                itemElements.forEach((itemElement) => {
                    const itemId = itemElement.dataset.itemId;
                    if (!itemId) return;
                    
                    // Find the matching item and its index in the valid items array
                    const itemIndex = validItems.findIndex(item => item.id === itemId);
                    if (itemIndex === -1 || itemIndex >= statuses.length) return;
                    
                    const placeholder = itemElement.querySelector('.liked-icon-placeholder');
                    if (placeholder) {
                        placeholder.innerHTML = '';
                        const item = validItems[itemIndex];
                        
                        // Determine item type for toggle
                        let itemType;
                        if (typeKey === 'tracks') itemType = 'track';
                        else if (typeKey === 'albums') itemType = 'album';
                        else if (typeKey === 'artists') itemType = 'artist';
                        else if (typeKey === 'playlists') itemType = 'playlist';
                        else if (typeKey === 'shows') itemType = 'podcast';
                        else if (typeKey === 'episodes') itemType = 'episode';
                        else if (typeKey === 'audiobooks') itemType = 'audiobook';
                        
                        const itemData = {
                            name: item.name,
                            imageUrl: item.images && item.images.length > 0 ? item.images[0]?.url : null
                        };
                        
                        const likedIcon = this.createLikedIcon(statuses[itemIndex], 'liked-icon-inline', itemType, item.id, itemData);
                        placeholder.appendChild(likedIcon);
                    }
                });
            };
            
            if (trackIds.length > 0) {
                console.log('Updating tracks icons:', trackIds.length, 'items');
                updateIcons('tracks', trackStatuses, results.tracks.items);
            }
            if (albumIds.length > 0) {
                console.log('Updating albums icons:', albumIds.length, 'items');
                updateIcons('albums', albumStatuses, results.albums.items);
            }
            if (artistIds.length > 0) {
                console.log('Updating artists icons:', artistIds.length, 'items');
                updateIcons('artists', artistStatuses, results.artists.items);
            }
            if (playlistIds.length > 0) {
                console.log('Updating playlists icons:', playlistIds.length, 'items');
                updateIcons('playlists', playlistStatuses, results.playlists.items);
            }
            if (showIds.length > 0) {
                console.log('Updating shows icons:', showIds.length, 'items');
                updateIcons('shows', showStatuses, results.shows.items);
            }
            if (episodeIds.length > 0) {
                console.log('Updating episodes icons:', episodeIds.length, 'items');
                updateIcons('episodes', episodeStatuses, results.episodes.items);
            }
            if (audiobookIds.length > 0) {
                console.log('Updating audiobooks icons:', audiobookIds.length, 'items');
                updateIcons('audiobooks', audiobookStatuses, results.audiobooks.items);
            }
            
        } catch (error) {
            console.error('Error fetching search result liked statuses:', error);
        }
    },

    createResultSection(typeName, items, typeKey) {
        const section = document.createElement('div');
        section.className = 'result-section';

        // Header with show/hide button
        const header = document.createElement('div');
        header.className = 'result-section-header';
        
        const headerTitle = document.createElement('h2');
        headerTitle.textContent = typeName;
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-section-btn';
        toggleBtn.textContent = '−';
        toggleBtn.addEventListener('click', () => {
            const content = section.querySelector('.result-section-content');
            const isHidden = content.style.display === 'none';
            content.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? '−' : '+';
        });
        
        header.appendChild(headerTitle);
        header.appendChild(toggleBtn);
        section.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = 'result-section-content';

        items.forEach(item => {
            // Skip null or undefined items
            if (!item) {
                console.warn('Null item in results, skipping');
                return;
            }
            const resultItem = this.createResultItem(item, typeKey);
            content.appendChild(resultItem);
        });

        section.appendChild(content);
        return section;
    },

    createResultItem(item, typeKey) {
        // Skip null or undefined items
        if (!item) {
            console.warn('Null item encountered in createResultItem');
            const emptyDiv = document.createElement('div');
            emptyDiv.style.display = 'none';
            return emptyDiv;
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = 'result-item clickable-item';
        itemDiv.dataset.itemType = typeKey; // Store type for liked status updates
        
        // Store ID and URI for tracking and drag operations
        if (item.id) {
            itemDiv.dataset.itemId = item.id;
        }
        if (item.uri) {
            itemDiv.dataset.uri = item.uri;
        }
        
        // Make only tracks and episodes draggable
        if (['tracks', 'episodes'].includes(typeKey)) {
            itemDiv.setAttribute('draggable', 'true');
            
            // Prepare item data for drag operations
            const itemData = {
                id: item.id,
                uri: item.uri,
                type: typeKey.slice(0, -1), // Remove 's' to get singular form
                name: item.name,
                imageUrl: this.getImageUrl(item),
                // Include additional data based on type
                ...(typeKey === 'tracks' && item.artists ? { artists: item.artists } : {}),
                ...(typeKey === 'tracks' && item.album ? { album: item.album } : {}),
                ...(typeKey === 'tracks' && item.duration_ms ? { duration_ms: item.duration_ms } : {}),
                ...(typeKey === 'episodes' && item.duration_ms ? { duration_ms: item.duration_ms } : {})
            };
            
            // Attach drag event handlers
            itemDiv.addEventListener('dragstart', (e) => this.handleDragStart(e, itemDiv, itemData));
            itemDiv.addEventListener('dragend', (e) => this.handleDragEnd(e, itemDiv));
        }

        // Check if this is the currently playing item
        const isCurrentlyPlaying = item.id && this.isCurrentlyPlayingItem(item.id);
        if (isCurrentlyPlaying) {
            itemDiv.classList.add('currently-playing');
        }

        // Image
        const img = document.createElement('img');
        img.className = 'result-item-image';
        
        let imageUrl = this.getImageUrl(item);
        
        img.src = imageUrl;
        img.alt = item.name || '';
        img.src = imageUrl;
        img.alt = item.name || '';
        
        // Add play icon overlay if this is currently playing
        if (isCurrentlyPlaying && (typeKey === 'tracks' || typeKey === 'episodes')) {
            const playIconOverlay = document.createElement('div');
            playIconOverlay.className = 'play-icon-overlay';
            playIconOverlay.innerHTML = '▶';
            const imageContainer = document.createElement('div');
            imageContainer.className = 'result-item-image-container';
            imageContainer.appendChild(img);
            imageContainer.appendChild(playIconOverlay);
            itemDiv.appendChild(imageContainer);
        } else {
            itemDiv.appendChild(img);
        }

        // Text content
        const textDiv = document.createElement('div');
        textDiv.className = 'result-item-text';

        // Primary text (name)
        const primaryText = document.createElement('div');
        primaryText.className = 'result-item-primary';
        
        // Liked icon placeholder (will be filled in for artist and search views)
        const likedPlaceholder = document.createElement('span');
        likedPlaceholder.className = 'liked-icon-placeholder';
        primaryText.appendChild(likedPlaceholder);
        
        if (item.explicit) {
            const explicitBadge = document.createElement('span');
            explicitBadge.className = 'explicit-badge';
            explicitBadge.textContent = '🄴';
            primaryText.appendChild(explicitBadge);
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;
        primaryText.appendChild(nameSpan);

        // Secondary text (depends on type) - now with clickable parts
        const secondaryText = document.createElement('div');
        secondaryText.className = 'result-item-secondary';
        this.populateSecondaryText(secondaryText, item, typeKey);

        textDiv.appendChild(primaryText);
        textDiv.appendChild(secondaryText);

        itemDiv.appendChild(textDiv);

        // Add click handler based on item type
        this.addResultItemClickHandler(itemDiv, item, typeKey);

        return itemDiv;
    },

    populateSecondaryText(secondaryTextElement, item, typeKey) {
        switch (typeKey) {
            case 'tracks':
                // Artists (clickable) • Album (clickable)
                if (item.artists && item.artists.length > 0) {
                    item.artists.forEach((artist, index) => {
                        if (index > 0) {
                            secondaryTextElement.appendChild(document.createTextNode(', '));
                        }
                        const artistSpan = document.createElement('span');
                        artistSpan.className = 'clickable-artist';
                        artistSpan.textContent = artist.name;
                        artistSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (artist.id) {
                                this.displayArtistDetails(artist.id);
                            }
                        });
                        secondaryTextElement.appendChild(artistSpan);
                    });
                } else {
                    secondaryTextElement.appendChild(document.createTextNode('Unknown Artist'));
                }
                
                secondaryTextElement.appendChild(document.createTextNode(' • '));
                
                if (item.album && item.album.id) {
                    const albumSpan = document.createElement('span');
                    albumSpan.className = 'clickable-album';
                    albumSpan.textContent = item.album.name || 'Unknown Album';
                    albumSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.displayAlbumDetails(item.album.id);
                    });
                    secondaryTextElement.appendChild(albumSpan);
                } else {
                    secondaryTextElement.appendChild(document.createTextNode(item.album?.name || 'Unknown Album'));
                }
                break;
            
            case 'albums':
                // Artists (clickable) • Year
                if (item.artists && item.artists.length > 0) {
                    item.artists.forEach((artist, index) => {
                        if (index > 0) {
                            secondaryTextElement.appendChild(document.createTextNode(', '));
                        }
                        const artistSpan = document.createElement('span');
                        artistSpan.className = 'clickable-artist';
                        artistSpan.textContent = artist.name;
                        artistSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (artist.id) {
                                this.displayArtistDetails(artist.id);
                            }
                        });
                        secondaryTextElement.appendChild(artistSpan);
                    });
                    
                    const albumYear = item.release_date ? item.release_date.split('-')[0] : '';
                    if (albumYear) {
                        secondaryTextElement.appendChild(document.createTextNode(' • ' + albumYear));
                    }
                } else {
                    const albumYear = item.release_date ? item.release_date.split('-')[0] : '';
                    secondaryTextElement.textContent = albumYear;
                }
                break;
            
            case 'playlists':
                secondaryTextElement.innerHTML = item.description || item.owner?.display_name || '&nbsp;';
                break;
            
            case 'artists':
                secondaryTextElement.textContent = item.genres?.join(', ') || '';
                // If empty, add nbsp for alignment
                if (!secondaryTextElement.textContent) {
                    secondaryTextElement.innerHTML = '&nbsp;';
                }
                break;
            
            case 'shows':
            case 'episodes':
            case 'audiobooks':
                secondaryTextElement.innerHTML = item.description || '&nbsp;';
                break;
            
            default:
                secondaryTextElement.innerHTML = '&nbsp;';
        }
    },

    addResultItemClickHandler(itemDiv, item, typeKey) {
        // Check if item is playable for tracks, episodes, and chapters
        let isPlayable = true;
        if (typeKey === 'tracks' || typeKey === 'episodes') {
            isPlayable = item.is_playable !== false && !(item.restrictions && item.restrictions.reason);
            if (!isPlayable) {
                itemDiv.style.color = '#666';
                itemDiv.style.cursor = 'not-allowed';
                itemDiv.classList.remove('clickable-item');
            }
        }

        switch (typeKey) {
            case 'tracks':
                // Clicking anywhere (except artist/album) plays the track or toggles play/pause (only if playable)
                if (isPlayable) {
                    itemDiv.addEventListener('click', async (e) => {
                        if (e.target.classList.contains('clickable-artist') || 
                            e.target.classList.contains('clickable-album')) {
                            return; // Let the child handler handle it
                        }
                        
                        // Handle Ctrl-click for toggle selection
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.toggleResultItemSelection(itemDiv);
                            return;
                        }
                        
                        // Handle Shift-click for range selection
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.selectResultItemRange(itemDiv);
                            return;
                        }
                        
                        // Normal click: clear selection and play track
                        this.clearTrackSelection();
                        
                        try {
                            // Check if this is the currently playing track at click time
                            const isCurrentlyPlayingNow = item.id && this.isCurrentlyPlayingItem(item.id);
                            if (isCurrentlyPlayingNow) {
                                // Toggle play/pause
                                if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                                    await SpotifyAPI.pause();
                                    console.log('Paused track:', item.name);
                                } else {
                                    await SpotifyAPI.play();
                                    console.log('Resumed track:', item.name);
                                }
                            } else {
                                // Play this track
                                await SpotifyAPI.playContentUri(item.uri);
                                console.log('Playing track:', item.name);
                            }
                        } catch (error) {
                            console.error('Error playing track:', error);
                        }
                    });
                }
                break;
            
            case 'albums':
                // Clicking anywhere (except artist) shows album details
                itemDiv.addEventListener('click', async (e) => {
                    if (e.target.classList.contains('clickable-artist')) {
                        return; // Let the child handler handle it
                    }
                    
                    await this.displayAlbumDetails(item.id);
                });
                break;
            
            case 'artists':
                // Clicking anywhere shows artist details
                itemDiv.addEventListener('click', async (e) => {
                    await this.displayArtistDetails(item.id);
                });
                break;
            
            case 'playlists':
                // Clicking anywhere shows playlist details
                itemDiv.addEventListener('click', async (e) => {
                    await this.displayPlaylistDetails(item.id);
                });
                break;
            
            case 'shows':
                // Clicking anywhere shows podcast details
                itemDiv.addEventListener('click', async (e) => {
                    await this.displayPodcastDetails(item.id);
                });
                break;
            
            case 'episodes':
                // Clicking anywhere plays the episode or toggles play/pause (only if playable)
                if (isPlayable) {
                    itemDiv.addEventListener('click', async (e) => {
                        // Handle Ctrl-click for toggle selection
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.toggleResultItemSelection(itemDiv);
                            return;
                        }
                        
                        // Handle Shift-click for range selection
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.selectResultItemRange(itemDiv);
                            return;
                        }
                        
                        // Normal click: clear selection and play
                        this.clearTrackSelection();
                        
                        try {
                            // Check if this is the currently playing episode at click time
                            const isCurrentlyPlayingNow = item.id && this.isCurrentlyPlayingItem(item.id);
                            if (isCurrentlyPlayingNow) {
                                // Toggle play/pause
                                if (this.currentPlaybackState && this.currentPlaybackState.is_playing) {
                                    await SpotifyAPI.pause();
                                    console.log('Paused episode:', item.name);
                                } else {
                                    await SpotifyAPI.play();
                                    console.log('Resumed episode:', item.name);
                                }
                            } else {
                                // Play this episode
                                await SpotifyAPI.playContentUri(item.uri);
                                console.log('Playing episode:', item.name);
                            }
                        } catch (error) {
                            console.error('Error playing episode:', error);
                        }
                    });
                }
                break;
            
            case 'audiobooks':
                // Clicking anywhere shows audiobook details
                itemDiv.addEventListener('click', async (e) => {
                    await this.displayAudiobookDetails(item.id);
                });
                break;
        }
    },

    toggleFilter() {
        if (this.filterState.isActive) {
            // Deactivate filter
            this.deactivateFilter();
        } else {
            // Activate filter
            this.activateFilter();
        }
    },
    
    activateFilter() {
        const contentPanel = document.querySelector('.content-panel');
        
        // Check if filter bar already exists
        let filterBar = contentPanel.querySelector('.filter-bar');
        
        if (!filterBar) {
            // Create filter bar
            filterBar = document.createElement('div');
            filterBar.className = 'filter-bar';
            
            const filterContent = document.createElement('div');
            filterContent.className = 'filter-bar-content';
            
            const label = document.createElement('div');
            label.className = 'filter-bar-label';
            label.textContent = 'Filter:';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'filter-bar-input';
            input.placeholder = 'Type to filter... (use * for wildcard, ? for single char)';
            
            // Add input handler
            input.addEventListener('input', (e) => {
                this.filterState.filterText = e.target.value;
                this.applyFilter();
            });
            
            filterContent.appendChild(label);
            filterContent.appendChild(input);
            filterBar.appendChild(filterContent);
            
            // Insert at the top of content panel
            contentPanel.insertBefore(filterBar, contentPanel.firstChild);
            
            this.filterState.filterBar = filterBar;
            this.filterState.filterInput = input;
        }
        
        // Activate and show
        this.filterState.isActive = true;
        filterBar.classList.add('active');
        
        // Focus input after animation
        setTimeout(() => {
            this.filterState.filterInput.focus();
        }, 100);
    },
    
    deactivateFilter() {
        if (this.filterState.filterBar) {
            this.filterState.filterBar.classList.remove('active');
        }
        
        this.filterState.isActive = false;
        this.filterState.filterText = '';
        
        if (this.filterState.filterInput) {
            this.filterState.filterInput.value = '';
        }
        
        // Show all elements
        this.applyFilter();
    },
    
    applyFilter() {
        const filterText = this.filterState.filterText.trim();
        const contentPanel = document.querySelector('.content-panel');
        
        // If no filter text, show everything
        if (!filterText) {
            this.showAllFilterableElements(contentPanel);
            return;
        }
        
        // Convert glob pattern to regex (case-insensitive)
        const pattern = this.globToRegex(filterText);
        
        // Find and filter various content types
        this.filterElements(contentPanel, pattern);
    },
    
    globToRegex(glob) {
        // Escape special regex characters except * and ?
        let pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        
        // Convert glob wildcards to regex
        pattern = pattern.replace(/\*/g, '.*');  // * = 0 or more chars
        pattern = pattern.replace(/\?/g, '.');   // ? = exactly 1 char
        
        // Case-insensitive, match anywhere in string
        return new RegExp(pattern, 'i');
    },
    
    filterElements(contentPanel, pattern) {
        // Filter playlist/liked songs tracks
        const playlistRows = contentPanel.querySelectorAll('.playlist-tracks-table tbody tr, .album-tracks-table tbody tr');
        playlistRows.forEach(row => {
            const text = this.getRowText(row);
            if (pattern.test(text)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
        
        // Filter artist sections (popular tracks, albums, etc.)
        const artistSections = contentPanel.querySelectorAll('.artist-section');
        artistSections.forEach(section => {
            const items = section.querySelectorAll('.result-item, .episode-item');
            let visibleCount = 0;
            
            items.forEach(item => {
                const text = this.getItemText(item);
                if (pattern.test(text)) {
                    item.style.display = '';
                    visibleCount++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Hide section if no visible items
            if (visibleCount === 0) {
                section.style.display = 'none';
            } else {
                section.style.display = '';
            }
        });
        
        // Filter search results
        const resultSections = contentPanel.querySelectorAll('.result-section');
        resultSections.forEach(section => {
            const items = section.querySelectorAll('.result-item');
            let visibleCount = 0;
            
            items.forEach(item => {
                const text = this.getItemText(item);
                if (pattern.test(text)) {
                    item.style.display = '';
                    visibleCount++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Hide section if no visible items
            if (visibleCount === 0) {
                section.style.display = 'none';
            } else {
                section.style.display = '';
            }
        });
        
        // Filter podcast episodes
        const episodeItems = contentPanel.querySelectorAll('.episode-item');
        episodeItems.forEach(item => {
            const text = this.getItemText(item);
            if (pattern.test(text)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
        
        // Filter audiobook chapters (if they exist)
        const chapterItems = contentPanel.querySelectorAll('.chapter-item');
        chapterItems.forEach(item => {
            const text = this.getItemText(item);
            if (pattern.test(text)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    },
    
    showAllFilterableElements(contentPanel) {
        // Show all tracks/rows
        const rows = contentPanel.querySelectorAll('.playlist-tracks-table tbody tr, .album-tracks-table tbody tr');
        rows.forEach(row => row.style.display = '');
        
        // Show all result items
        const resultItems = contentPanel.querySelectorAll('.result-item');
        resultItems.forEach(item => item.style.display = '');
        
        // Show all sections
        const sections = contentPanel.querySelectorAll('.result-section, .artist-section');
        sections.forEach(section => section.style.display = '');
        
        // Show all episodes
        const episodes = contentPanel.querySelectorAll('.episode-item');
        episodes.forEach(item => item.style.display = '');
        
        // Show all chapters
        const chapters = contentPanel.querySelectorAll('.chapter-item');
        chapters.forEach(item => item.style.display = '');
    },
    
    getRowText(row) {
        // Get all visible text from a table row
        const cells = row.querySelectorAll('td');
        const texts = [];
        
        cells.forEach(cell => {
            // Skip cells that are just icons or buttons
            if (!cell.classList.contains('liked-icon-cell') && 
                !cell.classList.contains('delete-track-cell')) {
                const text = cell.textContent.trim();
                if (text) texts.push(text);
            }
        });
        
        return texts.join(' ');
    },
    
    getItemText(item) {
        // Get all visible text from an item (result-item, episode-item, etc.)
        const textElements = item.querySelectorAll('.result-item-primary, .result-item-secondary, .episode-title, .episode-description, .chapter-title');
        const texts = [];
        
        textElements.forEach(el => {
            const text = el.textContent.trim();
            if (text) texts.push(text);
        });
        
        // If no specific text elements found, just use all text content
        if (texts.length === 0) {
            return item.textContent.trim();
        }
        
        return texts.join(' ');
    },

    initializeSplitter() {
        const splitter = document.getElementById('splitter');
        const navPanel = document.querySelector('.nav-panel');
        const contentPanel = document.querySelector('.content-panel');
        
        let isResizing = false;
        
        splitter.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const containerRect = navPanel.parentElement.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            const minWidth = 200;
            const maxWidth = containerRect.width - 200; // Leave space for content panel
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                navPanel.style.width = newWidth + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    },

    initializePlayerControls() {
        // Store reference to App for use in event handlers
        const app = this;
        
        // State for controls
        let isPlaying = false;
        let loopMode = 0; // 0 = off, 1 = track, 2 = context
        let shuffleEnabled = false;
        let currentVolume = 70;
        let currentSeekPosition = 0;

        // Play/Pause button
        const playPauseBtn = document.getElementById('btn-play-pause');
        playPauseBtn.addEventListener('click', async () => {
            try {
                if (WebPlaybackSDK.isActivePlayer) {
                    // Use SDK for playback control
                    await WebPlaybackSDK.togglePlay();
                    console.log('Toggled playback via SDK');
                } else {
                    // Use API for playback control
                    if (app.currentPlaybackState && app.currentPlaybackState.is_playing) {
                        await SpotifyAPI.pause();
                        console.log('Paused playback via API');
                    } else {
                        await SpotifyAPI.play();
                        console.log('Started playback via API');
                    }
                    // Immediately fetch updated state
                    await app.fetchAndUpdatePlaybackState();
                }
            } catch (error) {
                console.error('Play/Pause error:', error);
            }
        });

        // Previous button
        document.getElementById('btn-previous').addEventListener('click', async () => {
            try {
                if (WebPlaybackSDK.isActivePlayer) {
                    await WebPlaybackSDK.previousTrack();
                    console.log('Previous track via SDK');
                } else {
                    await SpotifyAPI.skipToPrevious();
                    console.log('Previous track via API');
                    await app.fetchAndUpdatePlaybackState();
                }
            } catch (error) {
                console.error('Previous track error:', error);
            }
        });

        // Next button
        document.getElementById('btn-next').addEventListener('click', async () => {
            try {
                if (WebPlaybackSDK.isActivePlayer) {
                    await WebPlaybackSDK.nextTrack();
                    console.log('Next track via SDK');
                } else {
                    await SpotifyAPI.skipToNext();
                    console.log('Next track via API');
                    await app.fetchAndUpdatePlaybackState();
                }
            } catch (error) {
                console.error('Next track error:', error);
            }
        });

        // Shuffle button
        const shuffleBtn = document.getElementById('btn-shuffle');
        shuffleBtn.addEventListener('click', async () => {
            try {
                const newState = !shuffleBtn.classList.contains('active');
                
                if (WebPlaybackSDK.isActivePlayer) {
                    // For SDK, we need to use the API to set shuffle
                    await SpotifyAPI.setShuffle(newState);
                    console.log(`Shuffle ${newState ? 'enabled' : 'disabled'} via API`);
                } else {
                    await SpotifyAPI.setShuffle(newState);
                    console.log(`Shuffle ${newState ? 'enabled' : 'disabled'}`);
                    await app.fetchAndUpdatePlaybackState();
                }
            } catch (error) {
                console.error('Shuffle error:', error);
            }
        });

        // Loop button
        const loopBtn = document.getElementById('btn-loop');
        loopBtn.addEventListener('click', async () => {
            try {
                const modes = ['off', 'context', 'track'];
                const currentMode = app.currentPlaybackState?.repeat_state || 'off';
                const currentIndex = modes.indexOf(currentMode);
                const nextIndex = (currentIndex + 1) % 3;
                const nextMode = modes[nextIndex];
                
                if (WebPlaybackSDK.isActivePlayer) {
                    // For SDK, we need to use the API to set repeat mode
                    await SpotifyAPI.setRepeatMode(nextMode);
                    console.log(`Loop mode: ${nextMode} via API`);
                } else {
                    await SpotifyAPI.setRepeatMode(nextMode);
                    console.log(`Loop mode: ${nextMode}`);
                    await app.fetchAndUpdatePlaybackState();
                }
            } catch (error) {
                console.error('Loop error:', error);
            }
        });

        // Seek bar with drag support
        const seekBar = document.getElementById('seek-bar');
        const seekProgress = document.getElementById('seek-progress');
        let isDraggingSeek = false;

        const updateSeekPosition = (e) => {
            const rect = seekBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
            seekProgress.style.width = `${percent}%`;
            currentSeekPosition = percent;
            return percent;
        };

        const sendSeekCommand = async (percent) => {
            if (!app.currentPlaybackState?.item) return;
            
            const totalMs = app.currentPlaybackState.item.duration_ms;
            const positionMs = Math.floor((percent / 100) * totalMs);
            
            try {
                if (WebPlaybackSDK.isActivePlayer) {
                    await WebPlaybackSDK.seek(positionMs);
                    console.log(`Seeked to ${positionMs}ms via SDK`);
                } else {
                    await SpotifyAPI.seek(positionMs);
                    console.log(`Seeked to ${positionMs}ms via API`);
                }
            } catch (error) {
                console.error('Seek error:', error);
            }
        };

        seekBar.addEventListener('mousedown', (e) => {
            isDraggingSeek = true;
            seekBar.classList.add('dragging');
            updateSeekPosition(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (isDraggingSeek) {
                updateSeekPosition(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingSeek) {
                isDraggingSeek = false;
                seekBar.classList.remove('dragging');
                const finalPercent = currentSeekPosition;
                
                // Debounce the API call
                clearTimeout(app.seekDebounceTimer);
                app.seekDebounceTimer = setTimeout(() => {
                    sendSeekCommand(finalPercent);
                }, 100);
            }
        });

        // Volume bar with drag support
        const volumeBar = document.getElementById('volume-bar');
        const volumeProgress = document.getElementById('volume-progress');
        let isDraggingVolume = false;

        const updateVolumePosition = (e) => {
            const rect = volumeBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
            volumeProgress.style.width = `${percent}%`;
            currentVolume = percent;
            return percent;
        };

        const sendVolumeCommand = async (percent) => {
            const volumeInt = Math.round(percent);
            try {
                if (WebPlaybackSDK.isActivePlayer) {
                    // SDK expects 0.0 to 1.0
                    await WebPlaybackSDK.setVolume(volumeInt / 100);
                    console.log(`Volume set to ${volumeInt}% via SDK`);
                    // Save to localStorage for our web player
                    localStorage.setItem('spotify_web_player_volume', volumeInt.toString());
                } else {
                    await SpotifyAPI.setVolume(volumeInt);
                    console.log(`Volume set to ${volumeInt}% via API`);
                }
            } catch (error) {
                console.error('Volume error:', error);
            }
        };

        volumeBar.addEventListener('mousedown', (e) => {
            // Don't allow volume change if device doesn't support it
            if (volumeBar.classList.contains('disabled')) return;
            
            isDraggingVolume = true;
            volumeBar.classList.add('dragging');
            updateVolumePosition(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (isDraggingVolume) {
                updateVolumePosition(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingVolume) {
                isDraggingVolume = false;
                volumeBar.classList.remove('dragging');
                const finalPercent = currentVolume;
                
                // Debounce the API call
                clearTimeout(app.volumeDebounceTimer);
                app.volumeDebounceTimer = setTimeout(() => {
                    sendVolumeCommand(finalPercent);
                }, 100);
            }
        });

        // Volume icon mute/unmute toggle
        const volumeIcon = document.querySelector('.volume-icon');
        if (volumeIcon) {
            volumeIcon.addEventListener('click', async () => {
                // Don't allow mute toggle if device doesn't support volume
                if (volumeBar.classList.contains('disabled')) return;
                
                const currentVolume = parseFloat(volumeProgress.style.width) || 0;
                
                if (app.isMuted || currentVolume === 0) {
                    // Unmute: restore previous volume
                    const restoreVolume = app.volumeBeforeMute || 70;
                    volumeProgress.style.width = `${restoreVolume}%`;
                    app.isMuted = false;
                    volumeIcon.textContent = restoreVolume > 66 ? '🔊' : (restoreVolume > 33 ? '🔉' : '🔈');
                    
                    // Send volume command
                    try {
                        if (WebPlaybackSDK.isActivePlayer) {
                            await WebPlaybackSDK.setVolume(restoreVolume / 100);
                            localStorage.setItem('spotify_web_player_volume', restoreVolume.toString());
                        } else {
                            await SpotifyAPI.setVolume(Math.round(restoreVolume));
                        }
                    } catch (error) {
                        console.error('Error unmuting:', error);
                    }
                } else {
                    // Mute: save current volume and set to 0
                    app.volumeBeforeMute = currentVolume;
                    volumeProgress.style.width = '0%';
                    app.isMuted = true;
                    volumeIcon.textContent = '🔇';
                    
                    // Send mute command
                    try {
                        if (WebPlaybackSDK.isActivePlayer) {
                            await WebPlaybackSDK.setVolume(0);
                            localStorage.setItem('spotify_web_player_volume', '0');
                        } else {
                            await SpotifyAPI.setVolume(0);
                        }
                    } catch (error) {
                        console.error('Error muting:', error);
                    }
                }
            });
        }

        // Track artist/album click handler for navigation
        // Use event delegation since we rebuild the content on each update
        const trackArtistElement = document.getElementById('track-artist');
        if (trackArtistElement) {
            trackArtistElement.addEventListener('click', async (e) => {
                const target = e.target;
                
                // Check if clicked on artist span
                if (target.dataset.artistId && target.dataset.artistId !== '') {
                    await app.displayArtistDetails(target.dataset.artistId);
                }
                // Check if clicked on album span
                else if (target.dataset.albumId && target.dataset.albumId !== '') {
                    await app.displayAlbumDetails(target.dataset.albumId);
                }
                // Check if clicked on show span (podcast)
                else if (target.dataset.showId && target.dataset.showId !== '') {
                    await app.displayPodcastDetails(target.dataset.showId);
                }
                // Check if clicked on audiobook span
                else if (target.dataset.audiobookId && target.dataset.audiobookId !== '') {
                    await app.displayAudiobookDetails(target.dataset.audiobookId);
                }
                // Check if clicked on context link
                else if (target.dataset.contextUri && target.dataset.contextType && target.dataset.contextId) {
                    const contextType = target.dataset.contextType;
                    const contextId = target.dataset.contextId;
                    const isShadowPlaylist = target.dataset.isShadowPlaylist === 'true';
                    
                    // If this is the shadow playlist, show liked songs instead
                    if (isShadowPlaylist) {
                        await app.displayLikedSongsDetails();
                    } else if (contextType === 'playlist') {
                        await app.displayPlaylistDetails(contextId);
                    } else if (contextType === 'artist') {
                        await app.displayArtistDetails(contextId);
                    } else if (contextType === 'show') {
                        await app.displayPodcastDetails(contextId);
                    } else if (contextType === 'album') {
                        await app.displayAlbumDetails(contextId);
                    }
                }
            });
        }

        // Search input and button
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        
        const performSearch = async () => {
            const query = searchInput.value.trim();
            if (query) {
                console.log(`Search for: "${query}"`);
                await app.performSearch(query);
            }
        };

        searchBtn.addEventListener('click', performSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        // Devices button and dropdown
        const devicesBtn = document.getElementById('btn-devices');
        const devicesDropdown = document.getElementById('devices-dropdown');
        
        devicesBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isVisible = devicesDropdown.classList.contains('show');
            
            if (!isVisible) {
                await app.showDevicesDropdown();
            } else {
                devicesDropdown.classList.remove('show');
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!devicesDropdown.contains(e.target) && e.target !== devicesBtn) {
                devicesDropdown.classList.remove('show');
            }
        });

        // Account button and menu
        const accountBtn = document.getElementById('btn-account');
        const accountMenu = document.getElementById('account-menu');
        
        accountBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = accountMenu.classList.contains('show');
            
            // Close devices dropdown if open
            devicesDropdown.classList.remove('show');
            
            if (!isVisible) {
                accountMenu.classList.add('show');
            } else {
                accountMenu.classList.remove('show');
            }
        });

        // Close account menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!accountMenu.contains(e.target) && e.target !== accountBtn) {
                accountMenu.classList.remove('show');
            }
        });

        // Logout menu item
        document.getElementById('menu-logout').addEventListener('click', () => {
            // Clear all auth data and app lock
            SpotifyAuth.clearAuthData();
            localStorage.removeItem('spotify_app_lock');
            // Reload page to show login screen
            location.reload();
        });
        
        // Continuous playback checkbox
        const continuousPlaybackCheckbox = document.getElementById('checkbox-continuous-playback');
        
        // Initialize checkbox state from settings (default: true)
        const continuousPlaybackEnabled = app.getSetting('allowLikedSongsContinuousPlayback', true);
        continuousPlaybackCheckbox.checked = continuousPlaybackEnabled;
        
        continuousPlaybackCheckbox.addEventListener('change', async (e) => {
            const newValue = e.target.checked;
            
            if (!newValue) {
                // User is disabling - show confirmation dialog
                const confirmed = await app.showContinuousPlaybackDisableDialog();
                
                if (confirmed) {
                    // User confirmed - disable the feature
                    app.setSetting('allowLikedSongsContinuousPlayback', false);
                    
                    // Delete shadow playlist if it exists
                    if (app.shadowPlaylist.id) {
                        try {
                            await SpotifyAPI.deleteShadowPlaylist(app.shadowPlaylist.id);
                            app.shadowPlaylist.id = null;
                            app.shadowPlaylist.uri = null;
                            app.shadowPlaylist.trackUris = [];
                            console.log('Continuous playback disabled, shadow playlist deleted');
                        } catch (error) {
                            console.error('Error deleting shadow playlist:', error);
                        }
                    }
                } else {
                    // User cancelled - revert checkbox
                    e.target.checked = true;
                }
            } else {
                // User is enabling
                app.setSetting('allowLikedSongsContinuousPlayback', true);
                console.log('Continuous playback enabled');
                
                // Initialize shadow playlist on next liked songs access
                app.shadowPlaylist.id = null;
                app.shadowPlaylist.uri = null;
                app.shadowPlaylist.trackUris = [];
            }
        });

        // Filter button
        document.getElementById('btn-filter').addEventListener('click', () => {
            app.toggleFilter();
        });

        // Album art click handler for enlarged view
        const albumArt = document.getElementById('album-art');
        albumArt.addEventListener('click', () => {
            app.showAlbumArtOverlay();
        });
    },

    showAlbumArtOverlay() {
        // Get the current album art image
        const albumArt = document.getElementById('album-art');
        const img = albumArt.querySelector('img');
        
        if (!img) {
            return; // No album art to show
        }

        // Get the highest resolution image (640x640 or best available)
        let imageUrl = img.src;
        if (this.currentPlaybackState?.item?.album?.images) {
            const images = this.currentPlaybackState.item.album.images;
            // Try to find 640x640 or largest available
            const largeImage = images.find(i => i.width >= 512) || images[0];
            imageUrl = largeImage.url;
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'album-overlay';
        overlay.id = 'album-overlay';
        
        overlay.innerHTML = `
            <div class="album-overlay-content">
                <img src="${imageUrl}" alt="Album art" class="album-overlay-image">
                <button class="album-overlay-close" title="Close">×</button>
            </div>
        `;

        document.body.appendChild(overlay);

        // Trigger animation
        requestAnimationFrame(() => {
            overlay.classList.add('show');
        });

        // Close handlers
        const closeOverlay = () => {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
            }, 300); // Wait for fade out animation
        };

        // Close button
        overlay.querySelector('.album-overlay-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeOverlay();
        });

        // Click anywhere to close
        overlay.addEventListener('click', closeOverlay);

        // Keypress to close
        const keyHandler = (e) => {
            closeOverlay();
            document.removeEventListener('keydown', keyHandler);
        };
        document.addEventListener('keydown', keyHandler);

        // Prevent clicks on the image from closing
        overlay.querySelector('.album-overlay-image').addEventListener('click', (e) => {
            e.stopPropagation();
        });
    },

    async showDevicesDropdown() {
        const dropdown = document.getElementById('devices-dropdown');
        const devicesList = document.getElementById('devices-list');
        
        try {
            // Clear previous contents
            devicesList.innerHTML = '';
            
            const devices = await SpotifyAPI.getDevices();
            
            // Filter out our own device from the REST API results
            const otherDevices = devices.filter(device => !WebPlaybackSDK.isOurDevice(device.id));
            
            // Add our Web Playback SDK device at the top if initialized
            if (WebPlaybackSDK.isReady) {
                const ourDeviceItem = document.createElement('div');
                ourDeviceItem.className = 'device-item' + (WebPlaybackSDK.isActivePlayer ? ' active' : '');
                
                ourDeviceItem.innerHTML = `
                    <span class="device-item-icon">🌐</span>
                    <div class="device-item-info">
                        <div class="device-item-name">Spotify Web Client</div>
                        <div class="device-item-type">This Browser</div>
                    </div>
                `;
                
                const app = this;
                ourDeviceItem.addEventListener('click', async () => {
                    if (!WebPlaybackSDK.isActivePlayer) {
                        try {
                            // Transfer playback to our SDK player
                            const shouldPlay = app.currentPlaybackState?.is_playing || false;
                            await WebPlaybackSDK.transferPlaybackHere(shouldPlay);
                            console.log('Manually transferred playback to this device');
                            dropdown.classList.remove('show');
                        } catch (error) {
                            console.error('Error transferring to web player:', error);
                        }
                    }
                });
                
                devicesList.appendChild(ourDeviceItem);
            }
            
            if (otherDevices.length === 0 && !WebPlaybackSDK.isReady) {
                devicesList.innerHTML = '<div class="devices-empty">No devices found.<br>Open Spotify on another device.</div>';
            } else if (otherDevices.length > 0) {
                otherDevices.forEach(device => {
                    const deviceItem = document.createElement('div');
                    deviceItem.className = 'device-item' + (device.is_active ? ' active' : '');
                    
                    const icon = this.getDeviceIcon(device.type);
                    
                    deviceItem.innerHTML = `
                        <span class="device-item-icon">${icon}</span>
                        <div class="device-item-info">
                            <div class="device-item-name">${device.name}</div>
                            <div class="device-item-type">${device.type}</div>
                        </div>
                    `;
                    
                    // Store reference to this for use in the event handler
                    const app = this;
                    
                    deviceItem.addEventListener('click', async () => {
                        if (!device.is_active) {
                            try {
                                // Preserve play/pause state when transferring
                                const shouldPlay = app.currentPlaybackState?.is_playing || false;
                                await SpotifyAPI.transferPlayback(device.id, shouldPlay);
                                console.log(`Switched to device: ${device.name} (${shouldPlay ? 'playing' : 'paused'})`);
                                dropdown.classList.remove('show');
                                
                                // Wait 2 seconds for Spotify to sync device state, then poll
                                setTimeout(async () => {
                                    await app.fetchAndUpdatePlaybackState();
                                    // Force a shorter poll interval for the next few polls to catch up
                                    app.updatePollingInterval();
                                }, 2000);
                            } catch (error) {
                                console.error('Error transferring playback:', error);
                            }
                        }
                    });
                    
                    devicesList.appendChild(deviceItem);
                });
            }
            
            dropdown.classList.add('show');
        } catch (error) {
            console.error('Error loading devices:', error);
            devicesList.innerHTML = '<div class="devices-empty">Error loading devices</div>';
            dropdown.classList.add('show');
        }
    },

    getDeviceIcon(type) {
        const icons = {
            'Computer': '💻',
            'Smartphone': '📱',
            'Speaker': '🔊',
            'TV': '📺',
            'AVR': '🎛',
            'STB': '📦',
            'AudioDongle': '🎧',
            'GameConsole': '🎮',
            'CastVideo': '📺',
            'CastAudio': '🔊',
            'Automobile': '🚗',
            'Unknown': '📱'
        };
        return icons[type] || icons['Unknown'];
    },

    // ============= Drag and Drop Handlers =============
    
    handleDragStart(e, element, itemData) {
        e.stopPropagation();
        
        // Determine what items to drag
        const itemId = element.dataset.trackId || element.dataset.itemId;
        const trackIndex = element.dataset.trackIndex;
        let itemsToDrag = [];
        
        // Construct the selection key in the same format as toggleTrackSelection
        // For playlist tracks: trackId_trackNumber
        let itemKey = null;
        if (itemId && trackIndex !== undefined) {
            const trackNumber = parseInt(trackIndex) + 1;
            itemKey = `${itemId}_${trackNumber}`;
        } else if (itemId) {
            itemKey = itemId;
        }
        
        // If this element is selected and part of a multi-selection
        if (itemKey && this.selectedTracks.has(itemKey)) {
            // Drag all selected items
            const selectedElements = document.querySelectorAll('.selected-track');
            selectedElements.forEach(el => {
                const data = this.extractItemDataFromElement(el);
                if (data) itemsToDrag.push(data);
            });
        } else {
            // Drag only this single item
            itemsToDrag.push(itemData);
        }
        
        // Store drag state
        this.dragState.isDragging = true;
        this.dragState.draggedItems = itemsToDrag;
        this.dragState.dragSourceType = itemData.sourceType;
        this.dragState.dragSourceId = itemData.sourceId;
        
        // Set drag data
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            items: itemsToDrag,
            sourceType: itemData.sourceType,
            sourceId: itemData.sourceId
        }));
        
        // Create custom drag image showing count
        const dragImage = document.createElement('div');
        dragImage.className = 'drag-ghost';
        dragImage.textContent = `${itemsToDrag.length} item${itemsToDrag.length > 1 ? 's' : ''}`;
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 0, 0);
        
        // Remove drag image after drag starts
        setTimeout(() => dragImage.remove(), 0);
        
        // Add dragging class to original element
        element.classList.add('dragging');
    },
    
    handleDragEnd(e, element) {
        e.preventDefault();
        e.stopPropagation();
        
        // Clean up drag state
        this.dragState.isDragging = false;
        this.dragState.draggedItems = [];
        this.dragState.dragSourceType = null;
        this.dragState.dragSourceId = null;
        this.dragState.currentDropTarget = null;
        this.dragState.isReordering = false;
        
        // Remove drag classes
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        document.querySelectorAll('.drag-over-valid').forEach(el => el.classList.remove('drag-over-valid'));
        document.querySelectorAll('.greyed-out').forEach(el => el.classList.remove('greyed-out'));
        
        // Remove drop indicator if it exists
        if (this.dragState.dropIndicator) {
            this.dragState.dropIndicator.remove();
            this.dragState.dropIndicator = null;
        }
    },
    
    extractItemDataFromElement(element) {
        // Extract item data from a DOM element (track row, result item div, or episode item div)
        const itemId = element.dataset.trackId || element.dataset.itemId || element.dataset.episodeId;
        const itemType = element.dataset.itemType || 'track';
        const uri = element.dataset.uri;
        const trackIndex = element.dataset.trackIndex;
        const trackNumber = element.dataset.trackNumber;
        
        if (!itemId && !uri) return null;
        
        // Check if this is an episode-item div
        if (element.classList.contains('episode-item')) {
            const nameSpan = element.querySelector('.episode-name');
            const img = element.querySelector('.episode-image');
            
            return {
                id: itemId,
                uri: uri,
                type: 'episode',
                name: nameSpan?.textContent?.trim() || 'Unknown Episode',
                imageUrl: img?.src || null,
                element: element
            };
        }
        
        // Check if this is a result-item div (albums, artists, playlists, shows, audiobooks, tracks, episodes)
        if (element.classList.contains('result-item')) {
            // Extract data from result item div
            const nameSpan = element.querySelector('.result-item-primary span:not(.explicit-badge):not(.liked-icon-placeholder)');
            const secondaryDiv = element.querySelector('.result-item-secondary');
            const img = element.querySelector('.result-item-image');
            
            const itemData = {
                id: itemId,
                uri: uri,
                type: itemType === 'albums' ? 'album' :
                      itemType === 'artists' ? 'artist' :
                      itemType === 'playlists' ? 'playlist' :
                      itemType === 'shows' ? 'show' :
                      itemType === 'audiobooks' ? 'audiobook' :
                      itemType === 'tracks' ? 'track' :
                      itemType === 'episodes' ? 'episode' : itemType,
                name: nameSpan?.textContent?.trim() || 'Unknown',
                imageUrl: img?.src || null,
                element: element
            };
            
            // Add type-specific data
            if (itemType === 'albums' || itemType === 'tracks') {
                const artistSpans = secondaryDiv?.querySelectorAll('.clickable-artist');
                if (artistSpans && artistSpans.length > 0) {
                    itemData.artists = Array.from(artistSpans).map(span => ({
                        name: span.textContent?.trim() || 'Unknown'
                    }));
                }
            }
            
            if (itemType === 'tracks') {
                // Try to extract album name for tracks
                const albumSpan = secondaryDiv?.querySelector('.clickable-album');
                if (albumSpan) {
                    itemData.album = {
                        name: albumSpan.textContent?.trim() || 'Unknown'
                    };
                }
            }
            
            return itemData;
        }
        
        // This is a track row with table cells - extract from cells
        const cells = element.querySelectorAll('td');
        let trackData = {
            id: itemId,
            uri: uri || `spotify:track:${itemId}`,
            type: itemType,
            trackIndex: trackIndex ? parseInt(trackIndex) : null,
            trackNumber: trackNumber ? parseInt(trackNumber) : null,
            element: element
        };
        
        // If this is a track row with cells, extract display information
        if (cells.length >= 4) {
            // Extract track number from first cell (skip if it has play icon)
            const numCell = cells[0];
            const hasPlayIcon = numCell?.querySelector('.play-icon-indicator');
            if (!hasPlayIcon && numCell?.textContent) {
                trackData.trackNumber = numCell.textContent.trim();
            }
            
            // Title (may include explicit badge) - cell index 1
            const titleCell = cells[1];
            if (titleCell) {
                const explicitBadge = titleCell.querySelector('.explicit-badge');
                // Clone the cell content and remove the explicit badge to get clean text
                const titleClone = titleCell.cloneNode(true);
                const badgeInClone = titleClone.querySelector('.explicit-badge');
                if (badgeInClone) badgeInClone.remove();
                trackData.name = titleClone.textContent?.trim() || 'Unknown';
                trackData.explicit = !!explicitBadge;
            }
            
            // Artists - cell index 2
            const artistCell = cells[2];
            if (artistCell) {
                const artistSpans = artistCell.querySelectorAll('.clickable-artist');
                if (artistSpans && artistSpans.length > 0) {
                    trackData.artists = Array.from(artistSpans).map(span => ({
                        name: span.textContent?.trim() || 'Unknown'
                    }));
                } else {
                    const artistText = artistCell.textContent?.trim();
                    trackData.artists = artistText ? [{ name: artistText }] : [{ name: 'Unknown' }];
                }
            }
            
            // Album - cell index 3
            const albumCell = cells[3];
            if (albumCell) {
                const albumSpan = albumCell.querySelector('.clickable-album');
                const albumText = albumSpan?.textContent?.trim() || albumCell.textContent?.trim();
                trackData.album = {
                    name: albumText || 'Unknown'
                };
            }
            
            // Duration - last cell
            const durationCell = cells[cells.length - 1];
            if (durationCell) {
                trackData.durationText = durationCell.textContent?.trim() || '';
            }
        }
        
        return trackData;
    },
    
    handleRowDragOver(e, row, sourceType, sourceId) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if we're reordering within the same playlist
        const isReordering = sourceType === this.dragState.dragSourceType && 
                             sourceId === this.dragState.dragSourceId;
        
        if (!isReordering) return; // Only allow reordering within same playlist
        
        // Get the tbody and all rows
        const tbody = row.parentElement;
        const rows = Array.from(tbody.querySelectorAll('tr.clickable-row'));
        const rowIndex = rows.indexOf(row);
        
        // Determine if we should insert before or after this row
        const rect = row.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midpoint;
        
        // Create or update drop indicator
        if (!this.dragState.dropIndicator) {
            this.dragState.dropIndicator = document.createElement('div');
            this.dragState.dropIndicator.className = 'drop-indicator';
        }
        
        // Position the drop indicator
        if (insertBefore) {
            row.parentElement.insertBefore(this.dragState.dropIndicator, row);
        } else {
            const nextRow = row.nextElementSibling;
            if (nextRow) {
                row.parentElement.insertBefore(this.dragState.dropIndicator, nextRow);
            } else {
                row.parentElement.appendChild(this.dragState.dropIndicator);
            }
        }
    },
    
    async handleRowDrop(e, row, sourceType, sourceId) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if we're reordering within the same playlist
        const isReordering = sourceType === this.dragState.dragSourceType && 
                             sourceId === this.dragState.dragSourceId;
        
        if (!isReordering) {
            this.handleDragEnd(e, row);
            return;
        }
        
        try {
            // Get the tbody and all rows
            const tbody = row.parentElement;
            const rows = Array.from(tbody.querySelectorAll('tr.clickable-row'));
            const dropIndex = rows.indexOf(row);
            
            // Determine if we should insert before or after this row
            const rect = row.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;
            const insertPosition = insertBefore ? dropIndex : dropIndex + 1;
            
            // Get the indices of dragged tracks (sorted)
            const draggedIndices = this.dragState.draggedItems
                .map(item => item.trackIndex)
                .filter(idx => idx !== null)
                .sort((a, b) => a - b);
            
            if (draggedIndices.length === 0) return;
            
            // If all dragged items are contiguous
            const isContiguous = draggedIndices.every((idx, i) => i === 0 || idx === draggedIndices[i - 1] + 1);
            
            if (isContiguous) {
                // Simple case: move contiguous block
                const rangeStart = draggedIndices[0];
                const rangeLength = draggedIndices.length;
                
                // Adjust insert position if we're moving items down
                let adjustedInsertPosition = insertPosition;
                if (insertPosition > rangeStart) {
                    adjustedInsertPosition = insertPosition - rangeLength;
                }
                
                // Don't do anything if we're dropping in the same place
                if (rangeStart === adjustedInsertPosition) {
                    this.handleDragEnd(e, row);
                    return;
                }
                
                await SpotifyAPI.reorderPlaylistTracks(sourceId, rangeStart, adjustedInsertPosition, rangeLength);
            } else {
                // Complex case: multiple non-contiguous selections
                // We need to move them one by one, in reverse order if moving up
                const shouldReverse = insertPosition < draggedIndices[0];
                const orderedIndices = shouldReverse ? [...draggedIndices].reverse() : draggedIndices;
                
                for (let i = 0; i < orderedIndices.length; i++) {
                    const originalIndex = orderedIndices[i];
                    const currentPosition = this.calculateCurrentPosition(originalIndex, orderedIndices, i, insertPosition);
                    await SpotifyAPI.reorderPlaylistTracks(sourceId, currentPosition, insertPosition, 1);
                }
            }
            
            // Refresh the playlist display
            await this.displayPlaylistDetails(sourceId);
            
        } catch (error) {
            console.error('Error reordering tracks:', error);
            alert('Failed to reorder tracks. Please try again.');
        } finally {
            this.handleDragEnd(e, row);
        }
    },
    
    calculateCurrentPosition(originalIndex, allIndices, currentStep, targetPosition) {
        // Calculate where an item is after previous moves
        let position = originalIndex;
        
        for (let i = 0; i < currentStep; i++) {
            const movedIndex = allIndices[i];
            if (movedIndex < originalIndex && targetPosition > originalIndex) {
                position--;
            } else if (movedIndex > originalIndex && targetPosition < originalIndex) {
                position++;
            }
        }
        
        return position;
    },
    
    async handlePlaylistNodeDrop(e, playlistNode, playlistId, isOwned) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Only allow drops on owned playlists
        if (!isOwned) {
            this.handleDragEnd(e, playlistNode);
            return;
        }
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (!allTracksOrEpisodes) {
            this.handleDragEnd(e, playlistNode);
            return;
        }
        
        try {
            // Extract URIs
            const uris = this.dragState.draggedItems.map(item => item.uri);
            
            // Add tracks to playlist
            await SpotifyAPI.addTracksToPlaylist(playlistId, uris);
            
            // Success - no alert needed
            console.log(`Added ${uris.length} item${uris.length > 1 ? 's' : ''} to playlist`);
            
        } catch (error) {
            console.error('Error adding tracks to playlist:', error);
            alert('Failed to add items to playlist. Please try again.');
        } finally {
            this.handleDragEnd(e, playlistNode);
        }
    },
    
    async handlePlaylistRootDrop(e, playlistsRootNode) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (!allTracksOrEpisodes) {
            this.handleDragEnd(e, playlistsRootNode);
            return;
        }
        
        try {
            // Show the new playlist dialog with pre-populated tracks
            // Pass all track data including name, artists, album, duration
            this.displayNewPlaylistForm(this.dragState.draggedItems);
            
        } catch (error) {
            console.error('Error creating playlist:', error);
        } finally {
            this.handleDragEnd(e, playlistsRootNode);
        }
    },
    
    handlePlaylistNodeDragOver(e, playlistNode, isOwned) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (!allTracksOrEpisodes) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        
        if (isOwned) {
            e.dataTransfer.dropEffect = 'copy';
            playlistNode.classList.add('drag-over-valid');
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    },
    
    handlePlaylistNodeDragLeave(e, playlistNode) {
        playlistNode.classList.remove('drag-over-valid');
    },
    
    handlePlaylistRootDragOver(e) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (allTracksOrEpisodes) {
            e.dataTransfer.dropEffect = 'copy';
            
            // Grey out non-owned playlists
            const playlistNodes = document.querySelectorAll('[data-playlist-id]');
            playlistNodes.forEach(node => {
                const isOwned = node.dataset.playlistOwned === 'true';
                if (!isOwned) {
                    node.classList.add('greyed-out');
                } else {
                    node.classList.remove('greyed-out');
                }
            });
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    },
    
    handleNavTreeDragOver(e) {
        if (!this.dragState.isDragging) return;
        
        // Only handle albums, artists, playlists, shows, audiobooks
        const validTypes = ['album', 'artist', 'playlist', 'show', 'audiobook'];
        const allValidTypes = this.dragState.draggedItems.every(item => 
            validTypes.includes(item.type)
        );
        
        if (!allValidTypes) {
            return; // Let other handlers manage tracks/episodes
        }
        
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    },
    
    async handleNavTreeDrop(e) {
        if (!this.dragState.isDragging) return;
        
        // Only handle albums, artists, playlists, shows, audiobooks
        const validTypes = ['album', 'artist', 'playlist', 'show', 'audiobook'];
        const allValidTypes = this.dragState.draggedItems.every(item => 
            validTypes.includes(item.type)
        );
        
        if (!allValidTypes) {
            return; // Let other handlers manage tracks/episodes
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        try {
            // Group items by type
            const itemsByType = {
                album: [],
                artist: [],
                playlist: [],
                show: [],
                audiobook: []
            };
            
            this.dragState.draggedItems.forEach(item => {
                if (itemsByType[item.type]) {
                    itemsByType[item.type].push(item.id);
                }
            });
            
            // Process each type
            const promises = [];
            
            if (itemsByType.album.length > 0) {
                promises.push(
                    SpotifyAPI.saveAlbums(itemsByType.album)
                        .then(() => console.log(`Saved ${itemsByType.album.length} album${itemsByType.album.length > 1 ? 's' : ''}`))
                );
            }
            
            if (itemsByType.artist.length > 0) {
                promises.push(
                    SpotifyAPI.followArtists(itemsByType.artist)
                        .then(() => console.log(`Followed ${itemsByType.artist.length} artist${itemsByType.artist.length > 1 ? 's' : ''}`))
                );
            }
            
            if (itemsByType.playlist.length > 0) {
                promises.push(
                    SpotifyAPI.followPlaylists(itemsByType.playlist)
                        .then(() => console.log(`Followed ${itemsByType.playlist.length} playlist${itemsByType.playlist.length > 1 ? 's' : ''}`))
                );
            }
            
            if (itemsByType.show.length > 0) {
                promises.push(
                    SpotifyAPI.saveShows(itemsByType.show)
                        .then(() => console.log(`Saved ${itemsByType.show.length} podcast${itemsByType.show.length > 1 ? 's' : ''}`))
                );
            }
            
            if (itemsByType.audiobook.length > 0) {
                promises.push(
                    SpotifyAPI.saveAudiobooks(itemsByType.audiobook)
                        .then(() => console.log(`Saved ${itemsByType.audiobook.length} audiobook${itemsByType.audiobook.length > 1 ? 's' : ''}`))
                );
            }
            
            // Execute all save/follow operations
            await Promise.all(promises);
            
            // Show success message
            const totalItems = this.dragState.draggedItems.length;
            console.log(`Successfully added ${totalItems} item${totalItems > 1 ? 's' : ''} to your library`);
            
        } catch (error) {
            console.error('Error saving items to library:', error);
            alert('Failed to save some items to your library. Please try again.');
        } finally {
            this.handleDragEnd(e, e.target);
        }
    },
    
    handleLikedNodeDragOver(e, likedNode) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (allTracksOrEpisodes) {
            e.dataTransfer.dropEffect = 'copy';
            likedNode.classList.add('drag-over-valid');
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    },
    
    handleLikedNodeDragLeave(e, likedNode) {
        likedNode.classList.remove('drag-over-valid');
    },
    
    async handleLikedNodeDrop(e, likedNode, nodeId) {
        if (!this.dragState.isDragging) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if all dragged items are tracks or episodes
        const allTracksOrEpisodes = this.dragState.draggedItems.every(item => 
            item.type === 'track' || item.type === 'episode'
        );
        
        if (!allTracksOrEpisodes) {
            this.handleDragEnd(e, likedNode);
            return;
        }
        
        try {
            // Separate tracks and episodes
            const trackIds = [];
            const episodeIds = [];
            
            this.dragState.draggedItems.forEach(item => {
                if (item.type === 'track' && item.id) {
                    trackIds.push(item.id);
                } else if (item.type === 'episode' && item.id) {
                    episodeIds.push(item.id);
                }
            });
            
            // Like all tracks and episodes
            const promises = [];
            
            if (trackIds.length > 0) {
                promises.push(
                    SpotifyAPI.saveTracks(trackIds)
                        .then(() => console.log(`Liked ${trackIds.length} track${trackIds.length > 1 ? 's' : ''}`))
                );
            }
            
            if (episodeIds.length > 0) {
                promises.push(
                    SpotifyAPI.saveEpisodes(episodeIds)
                        .then(() => console.log(`Liked ${episodeIds.length} episode${episodeIds.length > 1 ? 's' : ''}`))
                );
            }
            
            await Promise.all(promises);
            
            // Success - update any visible liked icons
            const totalItems = this.dragState.draggedItems.length;
            console.log(`Successfully liked ${totalItems} item${totalItems > 1 ? 's' : ''}`);
            
            // Update liked icons in the current view if they exist
            this.dragState.draggedItems.forEach(item => {
                if (item.element) {
                    const likedIcon = item.element.querySelector('.liked-icon-inline, .liked-icon-placeholder .liked-icon');
                    if (likedIcon) {
                        likedIcon.className = likedIcon.className.replace('unliked', 'liked');
                        likedIcon.title = item.type === 'track' ? 'Liked' : 'Saved';
                    }
                }
            });
            
        } catch (error) {
            console.error('Error liking items:', error);
            alert('Failed to like some items. Please try again.');
        } finally {
            this.handleDragEnd(e, likedNode);
        }
    },

    showLoading(message) {
        this.contentElement.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <div class="loading">
                        ${message}
                    </div>
                </div>
            </div>
        `;
    },

    showError(message) {
        this.contentElement.innerHTML = `
            <div class="auth-container">
                <div class="auth-card">
                    <div class="error">
                        <strong>Error:</strong><br>
                        ${message}
                    </div>
                </div>
            </div>
        `;
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

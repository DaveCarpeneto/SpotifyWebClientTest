// Spotify Web Playback SDK Wrapper

const WebPlaybackSDK = {
    player: null,
    deviceId: null,
    deviceIds: [], // Track last 2 device IDs for Spotify's weirdness
    isReady: false,
    isActivePlayer: false,
    currentState: null,
    sdkReady: false,
    sdkReadyPromise: null,
    sdkReadyResolve: null,
    
    // Watchdog for tracking SDK events
    lastSDKEventTime: null,
    watchdogTimer: null,
    watchdogInterval: 60000, // 60 seconds
    
    // Callbacks
    onStateChange: null,
    onActivePlayerChange: null,
    
    // Wait for SDK to be ready
    waitForSDKReady() {
        if (this.sdkReady) {
            return Promise.resolve();
        }
        
        if (!this.sdkReadyPromise) {
            this.sdkReadyPromise = new Promise((resolve) => {
                this.sdkReadyResolve = resolve;
            });
        }
        
        return this.sdkReadyPromise;
    },
    
    async init(accessToken) {
        // Wait for SDK to be loaded
        await this.waitForSDKReady();
        
        return new Promise((resolve, reject) => {
            // If player already exists, disconnect and recreate
            if (this.player) {
                this.player.disconnect();
                this.player = null;
            }
            
            // Create the player
            this.player = new Spotify.Player({
                name: 'Spotify Web Client',
                getOAuthToken: async (cb) => {
                    // Always fetch the current valid token
                    // Check if token is expired and refresh if needed
                    if (SpotifyAuth.isTokenExpired()) {
                        const refreshToken = SpotifyAuth.getRefreshToken();
                        if (refreshToken) {
                            try {
                                console.log('Web Playback SDK: Token expired, refreshing...');
                                await SpotifyAuth.refreshAccessToken();
                            } catch (error) {
                                console.error('Web Playback SDK: Failed to refresh token:', error);
                            }
                        }
                    }
                    
                    // Get the current (possibly refreshed) token
                    const currentToken = SpotifyAuth.getAccessToken();
                    cb(currentToken);
                },
                volume: 0.7
            });

            // Error handling
            this.player.addListener('initialization_error', ({ message }) => {
                console.error('Failed to initialize:', message);
                reject(new Error(message));
            });

            this.player.addListener('authentication_error', ({ message }) => {
                console.error('Failed to authenticate:', message);
                // The getOAuthToken callback handles token refresh automatically,
                // so if we get here, it's a more serious auth issue
                reject(new Error(message));
            });

            this.player.addListener('account_error', ({ message }) => {
                console.error('Failed to validate Spotify account:', message);
                reject(new Error(message));
            });

            this.player.addListener('playback_error', ({ message }) => {
                console.error('Failed to perform playback:', message);
            });

            // Ready
            this.player.addListener('ready', ({ device_id }) => {
                console.log('Ready with Device ID', device_id);
                this.deviceId = device_id;
                this.isReady = true;
                
                // Track this device ID
                this.addDeviceId(device_id);
                
                resolve(device_id);
            });

            // Not Ready
            this.player.addListener('not_ready', ({ device_id }) => {
                console.log('Device ID has gone offline', device_id);
                this.isReady = false;
            });

            // Player state changed
            this.player.addListener('player_state_changed', state => {
                // Update last SDK event time
                this.updateLastSDKEventTime();
                
                if (!state) {
                    console.log('Player state is null - triggering watchdog check');
                    this.currentState = null;
                    
                    // Trigger watchdog check when we get null state
                    if (this.isActivePlayer) {
                        this.performWatchdogCheck();
                    }
                    
                    if (this.onStateChange) {
                        this.onStateChange(null);
                    }
                    return;
                }

                console.log('Player state changed:', state);
                this.currentState = state;
                
                // Check if we became the active player
                if (!this.isActivePlayer && state.paused === false) {
                    // We're playing, so we're probably the active player
                    this.setActivePlayer(true);
                }
                
                // Trigger the callback
                if (this.onStateChange) {
                    this.onStateChange(state);
                }
            });

            // Connect to the player
            this.player.connect().then(success => {
                if (success) {
                    console.log('The Web Playback SDK successfully connected to Spotify!');
                } else {
                    console.error('The Web Playback SDK could not connect to Spotify');
                    reject(new Error('Could not connect to Spotify'));
                }
            });
        });
    },
    
    addDeviceId(deviceId) {
        // Add to the front of the array
        this.deviceIds.unshift(deviceId);
        
        // Keep only the last 2 device IDs
        if (this.deviceIds.length > 2) {
            this.deviceIds = this.deviceIds.slice(0, 2);
        }
        
        console.log('Tracked device IDs:', this.deviceIds);
    },
    
    isOurDevice(deviceId) {
        // Check if the device ID is one of our last 2 device IDs
        return this.deviceIds.includes(deviceId);
    },
    
    setActivePlayer(isActive) {
        if (this.isActivePlayer !== isActive) {
            this.isActivePlayer = isActive;
            console.log(`Active player status: ${isActive}`);
            
            if (isActive) {
                // Start watchdog when we become active player
                this.startWatchdog();
            } else {
                // Stop watchdog when we're no longer active player
                this.stopWatchdog();
            }
            
            if (this.onActivePlayerChange) {
                this.onActivePlayerChange(isActive);
            }
        }
    },
    
    updateLastSDKEventTime() {
        this.lastSDKEventTime = Date.now();
    },
    
    startWatchdog() {
        // Initialize the last event time
        this.updateLastSDKEventTime();
        
        // Clear any existing watchdog timer
        this.stopWatchdog();
        
        // Set up watchdog timer
        this.watchdogTimer = setInterval(() => {
            if (!this.isActivePlayer) {
                // Not active player anymore, stop watchdog
                this.stopWatchdog();
                return;
            }
            
            const timeSinceLastEvent = Date.now() - this.lastSDKEventTime;
            
            if (timeSinceLastEvent >= this.watchdogInterval) {
                console.log('Watchdog: No SDK events for 60 seconds - performing check');
                this.performWatchdogCheck();
            }
        }, 10000); // Check every 10 seconds
        
        console.log('Watchdog started');
    },
    
    stopWatchdog() {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
            console.log('Watchdog stopped');
        }
    },
    
    async performWatchdogCheck() {
        console.log('Performing watchdog check...');
        
        try {
            const playbackState = await SpotifyAPI.getPlaybackState();
            
            if (!playbackState || playbackState.error === 'NO_ACTIVE_DEVICE') {
                console.log('Watchdog: No active device found');
                this.setActivePlayer(false);
                return;
            }
            
            const activeDeviceId = playbackState.device?.id;
            
            if (activeDeviceId && this.isOurDevice(activeDeviceId)) {
                // We're still the active player
                console.log('Watchdog: Confirmed we are still the active player');
                // Reset the last SDK event time
                this.updateLastSDKEventTime();
            } else {
                // Another device is now active
                console.log('Watchdog: Another device is now active:', activeDeviceId);
                this.setActivePlayer(false);
            }
        } catch (error) {
            console.error('Watchdog check error:', error);
        }
    },
    
    async transferPlaybackHere(play = true) {
        if (!this.deviceId) {
            console.warn('Cannot transfer playback: device not ready');
            return;
        }
        
        try {
            await SpotifyAPI.transferPlayback(this.deviceId, play);
            console.log('Playback transferred to this device');
            this.setActivePlayer(true);
        } catch (error) {
            console.error('Error transferring playback:', error);
            throw error;
        }
    },
    
    // Playback control methods
    async togglePlay() {
        if (!this.player) return;
        
        try {
            await this.player.togglePlay();
        } catch (error) {
            console.error('Error toggling play:', error);
        }
    },
    
    async play() {
        if (!this.player) return;
        
        try {
            await this.player.resume();
        } catch (error) {
            console.error('Error playing:', error);
        }
    },
    
    async pause() {
        if (!this.player) return;
        
        try {
            await this.player.pause();
        } catch (error) {
            console.error('Error pausing:', error);
        }
    },
    
    async nextTrack() {
        if (!this.player) return;
        
        try {
            await this.player.nextTrack();
        } catch (error) {
            console.error('Error skipping to next:', error);
        }
    },
    
    async previousTrack() {
        if (!this.player) return;
        
        try {
            await this.player.previousTrack();
        } catch (error) {
            console.error('Error going to previous:', error);
        }
    },
    
    async seek(positionMs) {
        if (!this.player) return;
        
        try {
            await this.player.seek(positionMs);
        } catch (error) {
            console.error('Error seeking:', error);
        }
    },
    
    async setVolume(volumeDecimal) {
        if (!this.player) return;
        
        try {
            // SDK expects 0.0 to 1.0
            await this.player.setVolume(volumeDecimal);
        } catch (error) {
            console.error('Error setting volume:', error);
        }
    },
    
    async getState() {
        if (!this.player) return null;
        
        try {
            return await this.player.getCurrentState();
        } catch (error) {
            console.error('Error getting state:', error);
            return null;
        }
    },
    
    disconnect() {
        // Stop watchdog
        this.stopWatchdog();
        
        if (this.player) {
            this.player.disconnect();
            this.player = null;
            this.deviceId = null;
            this.isReady = false;
            this.isActivePlayer = false;
            this.currentState = null;
        }
    },
    
    // Helper to convert WebPlaybackState to the format used by Spotify API
    convertStateToPlaybackState(sdkState) {
        if (!sdkState) return null;
        
        const track = sdkState.track_window.current_track;
        
        // Build the item object - structure varies based on content type
        const item = {
            id: track.uri ? track.uri.split(':')[2] : null,
            name: track.name,
            duration_ms: track.duration_ms,
            type: track.type || (track.uri ? track.uri.split(':')[0] : 'track'), // Extract type from URI if not present
            album: {
                name: track.album.name,
                images: track.album.images,
                id: track.album.uri ? track.album.uri.split(':')[2] : null
            },
            artists: track.artists.map(artist => ({
                name: artist.name,
                id: artist.uri ? artist.uri.split(':')[2] : null
            }))
        };
        
        // For episodes, add show property
        if (item.type === 'episode' && track.show) {
            item.show = {
                name: track.show.name,
                id: track.show.uri ? track.show.uri.split(':')[2] : null,
                images: track.show.images
            };
        }
        
        // For chapters, add audiobook property
        if (item.type === 'chapter' && track.audiobook) {
            item.audiobook = {
                name: track.audiobook.name,
                id: track.audiobook.uri ? track.audiobook.uri.split(':')[2] : null,
                images: track.audiobook.images
            };
        }
        
        // Extract context from SDK state
        const context = sdkState.context ? {
            uri: sdkState.context.uri,
            type: sdkState.context.uri ? sdkState.context.uri.split(':')[1] : null,
            metadata: sdkState.context.metadata || {}
        } : null;

        return {
            is_playing: !sdkState.paused,
            shuffle_state: sdkState.shuffle,
            repeat_state: this.getRepeatMode(sdkState.repeat_mode),
            progress_ms: sdkState.position,
            item: item,
            context: context,
            device: {
                id: this.deviceId,
                name: 'Spotify Web Client',
                type: 'Computer',
                volume_percent: Math.round(sdkState.volume * 100),
                is_active: true
            }
        };
    },
    
    getRepeatMode(repeatMode) {
        // SDK repeat modes: 0 = off, 1 = context, 2 = track
        switch (repeatMode) {
            case 0: return 'off';
            case 1: return 'context';
            case 2: return 'track';
            default: return 'off';
        }
    }
};

// Global callback required by Spotify SDK
window.onSpotifyWebPlaybackSDKReady = () => {
    console.log('Spotify Web Playback SDK is ready');
    WebPlaybackSDK.sdkReady = true;
    if (WebPlaybackSDK.sdkReadyResolve) {
        WebPlaybackSDK.sdkReadyResolve();
    }
};

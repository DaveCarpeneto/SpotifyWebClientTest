// Spotify Web API Wrapper

const SpotifyAPI = {
    baseUrl: 'https://api.spotify.com/v1',
    userMarket: null, // Will be set from user profile

    // Make an authenticated API call
    async makeRequest(endpoint, options = {}) {
        // Check if token is expired and refresh if needed
        if (SpotifyAuth.isTokenExpired()) {
            const refreshToken = SpotifyAuth.getRefreshToken();
            if (refreshToken) {
                try {
                    await SpotifyAuth.refreshAccessToken();
                } catch (error) {
                    console.error('Failed to refresh token:', error);
                    throw error;
                }
            } else {
                throw new Error('No refresh token available');
            }
        }

        const accessToken = SpotifyAuth.getAccessToken();
        if (!accessToken) {
            throw new Error('No access token available');
        }

        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            ...options,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const response = await fetch(url, config);

        // Handle 204 No Content (successful command with no response body)
        if (response.status === 204) {
            return { success: true };
        }

        // Handle 404 Not Found (no active device)
        if (response.status === 404) {
            return { error: 'NO_ACTIVE_DEVICE', status: 404 };
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API Error: ${response.status}`);
        }

        // Check if there's actually content to parse
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }

        // If no JSON content, return success indicator
        return { success: true };
    },

    // Get current playback state
    async getPlaybackState() {
        try {
            // Include additional_types to get episode and track information
            const result = await this.makeRequest('/me/player?additional_types=track,episode');
            // If we got a success indicator but no data, return null
            if (result && result.success && !result.item) {
                return null;
            }
            return result;
        } catch (error) {
            console.error('Error getting playback state:', error);
            return null;
        }
    },

    // Play/Resume playback
    async play(deviceId = null) {
        const endpoint = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Play specific content by URI (track, episode, album, playlist, etc.)
    // position: 0-based index for playing from a specific position in a context
    async playContentUri(uri, contextUri = null, deviceId = null, position = null) {
        const endpoint = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
        const body = {};
        
        // If contextUri is provided, play from that context
        if (contextUri) {
            body.context_uri = contextUri;
            // If position is provided, use position-based offset (more reliable than URI-based)
            if (position !== null && position !== undefined) {
                body.offset = { position: position };
            } else if (uri) {
                // Fallback to URI-based offset if no position provided
                body.offset = { uri: uri };
            }
        } else {
            // Play just the single item
            body.uris = [uri];
        }
        
        try {
            return await this.makeRequest(endpoint, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        } catch (error) {
            // If we got a 403 with context+offset, try fallback to just the track
            if (error.message && error.message.includes('Restriction violated') && contextUri && (uri || position !== null)) {
                console.warn('Context+offset playback failed, falling back to track-only playback');
                const fallbackBody = { uris: [uri] };
                return await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify(fallbackBody)
                });
            }
            // Re-throw other errors
            throw error;
        }
    },

    // Pause playback
    async pause(deviceId = null) {
        const endpoint = deviceId ? `/me/player/pause?device_id=${deviceId}` : '/me/player/pause';
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Skip to next track
    async skipToNext(deviceId = null) {
        const endpoint = deviceId ? `/me/player/next?device_id=${deviceId}` : '/me/player/next';
        return await this.makeRequest(endpoint, { method: 'POST' });
    },

    // Skip to previous track
    async skipToPrevious(deviceId = null) {
        const endpoint = deviceId ? `/me/player/previous?device_id=${deviceId}` : '/me/player/previous';
        return await this.makeRequest(endpoint, { method: 'POST' });
    },

    // Set shuffle mode
    async setShuffle(state, deviceId = null) {
        const endpoint = deviceId 
            ? `/me/player/shuffle?state=${state}&device_id=${deviceId}` 
            : `/me/player/shuffle?state=${state}`;
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Set repeat mode
    async setRepeatMode(state, deviceId = null) {
        // state: 'off', 'track', 'context'
        const endpoint = deviceId 
            ? `/me/player/repeat?state=${state}&device_id=${deviceId}` 
            : `/me/player/repeat?state=${state}`;
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Seek to position (ms)
    async seek(positionMs, deviceId = null) {
        const endpoint = deviceId 
            ? `/me/player/seek?position_ms=${positionMs}&device_id=${deviceId}` 
            : `/me/player/seek?position_ms=${positionMs}`;
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Set volume (0-100)
    async setVolume(volumePercent, deviceId = null) {
        const endpoint = deviceId 
            ? `/me/player/volume?volume_percent=${volumePercent}&device_id=${deviceId}` 
            : `/me/player/volume?volume_percent=${volumePercent}`;
        return await this.makeRequest(endpoint, { method: 'PUT' });
    },

    // Get available devices
    async getDevices() {
        try {
            const data = await this.makeRequest('/me/player/devices');
            return data?.devices || [];
        } catch (error) {
            console.error('Error getting devices:', error);
            return [];
        }
    },

    // Transfer playback to a device
    async transferPlayback(deviceId, play = false) {
        return await this.makeRequest('/me/player', {
            method: 'PUT',
            body: JSON.stringify({
                device_ids: [deviceId],
                play: play
            })
        });
    },

    // Get current user profile
    async getUserProfile() {
        try {
            const profile = await this.makeRequest('/me');
            // Store user's country for market parameter
            if (profile && profile.country) {
                this.userMarket = profile.country;
            }
            return profile;
        } catch (error) {
            console.error('Error getting user profile:', error);
            return null;
        }
    },

    // Create a new playlist
    async createPlaylist(name, description = null, isPublic = true) {
        try {
            // First get user ID
            const profile = await this.getUserProfile();
            if (!profile || !profile.id) {
                throw new Error('Could not get user profile');
            }
            
            const body = {
                name: name,
                public: isPublic,
                description: description || ''
            };
            
            const playlist = await this.makeRequest(`/users/${profile.id}/playlists`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            
            return playlist;
        } catch (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
    },

    // Upload custom playlist cover image
    async uploadPlaylistCoverImage(playlistId, imageFile) {
        try {
            // Convert image to base64
            const base64Image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(imageFile);
            });
            
            // Upload to Spotify
            const accessToken = SpotifyAuth.getAccessToken();
            const response = await fetch(`${this.baseUrl}/playlists/${playlistId}/images`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'image/jpeg'
                },
                body: base64Image
            });
            
            if (!response.ok) {
                throw new Error(`Failed to upload image: ${response.status}`);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error uploading playlist cover image:', error);
            throw error;
        }
    },

    // Search for items
    // onPageLoaded callback: called with (newItems, totalLoaded, hasMore, type) for each page after the first
    async search(query, types = ['album', 'artist', 'playlist', 'track', 'show', 'episode', 'audiobook'], limit = 20, onPageLoaded = null) {
        try {
            const typeString = types.join(',');
            const encodedQuery = encodeURIComponent(query);
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/search?q=${encodedQuery}&type=${typeString}&limit=${limit}${marketParam}`;
            const results = await this.makeRequest(endpoint);
            
            if (!results) return null;
            
            // If callback provided, handle pagination for each type that has next URLs
            if (onPageLoaded) {
                for (const type of types) {
                    const typeKey = type + 's'; // albums, tracks, artists, etc.
                    if (results[typeKey] && results[typeKey].next) {
                        let nextUrl = results[typeKey].next;
                        let allItems = results[typeKey].items || [];
                        
                        // Fetch additional pages in background
                        (async () => {
                            while (nextUrl) {
                                await this.sleep(300);
                                
                                try {
                                    const accessToken = SpotifyAuth.getAccessToken();
                                    if (!accessToken) break;
                                    
                                    const response = await fetch(nextUrl, {
                                        headers: {
                                            'Authorization': `Bearer ${accessToken}`,
                                            'Content-Type': 'application/json'
                                        }
                                    });
                                    
                                    if (!response.ok) break;
                                    
                                    const data = await response.json();
                                    if (data && data.items) {
                                        allItems = allItems.concat(data.items);
                                        nextUrl = data.next;
                                        
                                        if (onPageLoaded) {
                                            onPageLoaded(data.items, allItems.length, nextUrl !== null, type);
                                        }
                                    } else {
                                        nextUrl = null;
                                    }
                                } catch (error) {
                                    console.error(`Error loading more ${type} results:`, error);
                                    nextUrl = null;
                                }
                            }
                        })();
                    }
                }
            }
            
            return results;
        } catch (error) {
            console.error('Error searching:', error);
            return null;
        }
    },

    // Get user's followed artists
    // onPageLoaded callback: called with (newArtists, totalLoaded, hasMore) for each page after the first
    async getFollowedArtists(limit = 50, onPageLoaded = null) {
        try {
            const endpoint = `/me/following?type=artist&limit=${limit}`;
            const data = await this.makeRequest(endpoint);
            let allArtists = data?.artists?.items || [];
            let nextUrl = data?.artists?.next;
            
            // Call callback for first page
            if (onPageLoaded && allArtists.length > 0) {
                onPageLoaded(allArtists, allArtists.length, nextUrl !== null);
            }
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.artists?.items) {
                                allArtists = allArtists.concat(pageData.artists.items);
                                nextUrl = pageData.artists.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.artists.items, allArtists.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more followed artists:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning (old behavior)
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.artists?.items) {
                            allArtists = allArtists.concat(pageData.artists.items);
                            nextUrl = pageData.artists.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more followed artists:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allArtists;
        } catch (error) {
            console.error('Error getting followed artists:', error);
            return [];
        }
    },

    // Get artist details
    async getArtist(artistId) {
        try {
            return await this.makeRequest(`/artists/${artistId}`);
        } catch (error) {
            console.error('Error getting artist:', error);
            return null;
        }
    },

    // Get artist's top tracks
    async getArtistTopTracks(artistId, market = 'US') {
        try {
            const endpoint = `/artists/${artistId}/top-tracks?market=${market}`;
            const data = await this.makeRequest(endpoint);
            return data?.tracks || [];
        } catch (error) {
            console.error('Error getting artist top tracks:', error);
            return [];
        }
    },

    // Get artist's albums
    // onPageLoaded callback: called with (newAlbums, totalLoaded, hasMore) for each page after the first
    async getArtistAlbums(artistId, limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/artists/${artistId}/albums?include_groups=album,single,compilation&limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allAlbums = data?.items || [];
            let nextUrl = data?.next;
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allAlbums = allAlbums.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allAlbums.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more artist albums:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning (old behavior)
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allAlbums = allAlbums.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more artist albums:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allAlbums;
        } catch (error) {
            console.error('Error getting artist albums:', error);
            return [];
        }
    },

    // Get user's saved albums
    // onPageLoaded callback: called with (newAlbums, totalLoaded, hasMore) for each page after the first
    async getSavedAlbums(limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/me/albums?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allAlbums = data?.items || [];
            let nextUrl = data?.next;
            
            // Call callback for first page
            if (onPageLoaded && allAlbums.length > 0) {
                onPageLoaded(allAlbums, allAlbums.length, nextUrl !== null);
            }
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allAlbums = allAlbums.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allAlbums.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more saved albums:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning (old behavior)
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allAlbums = allAlbums.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more saved albums:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allAlbums;
        } catch (error) {
            console.error('Error getting saved albums:', error);
            return [];
        }
    },

    // Get album details
    // onPageLoaded callback: called with (newTracks, totalLoaded, hasMore) for each page of tracks after the first
    async getAlbum(albumId, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `?market=${this.userMarket}` : '';
            const album = await this.makeRequest(`/albums/${albumId}${marketParam}`);
            
            if (!album) return null;
            
            // Handle pagination for album tracks
            if (album.tracks) {
                let allTracks = album.tracks.items || [];
                let nextUrl = album.tracks.next;
                
                if (nextUrl && onPageLoaded) {
                    // Fetch remaining pages in background
                    (async () => {
                        while (nextUrl) {
                            await this.sleep(300);
                            
                            try {
                                const accessToken = SpotifyAuth.getAccessToken();
                                if (!accessToken) break;
                                
                                const response = await fetch(nextUrl, {
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
                                        'Content-Type': 'application/json'
                                    }
                                });
                                
                                if (!response.ok) break;
                                
                                const pageData = await response.json();
                                if (pageData?.items) {
                                    allTracks = allTracks.concat(pageData.items);
                                    nextUrl = pageData.next;
                                    
                                    if (onPageLoaded) {
                                        onPageLoaded(pageData.items, allTracks.length, nextUrl !== null);
                                    }
                                } else {
                                    nextUrl = null;
                                }
                            } catch (error) {
                                console.error('Error loading more album tracks:', error);
                                nextUrl = null;
                            }
                        }
                    })();
                } else if (nextUrl && !onPageLoaded) {
                    // No callback - fetch all pages before returning (old behavior)
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allTracks = allTracks.concat(pageData.items);
                                nextUrl = pageData.next;
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more album tracks:', error);
                            nextUrl = null;
                        }
                    }
                    
                    album.tracks.items = allTracks;
                }
            }
            
            return album;
        } catch (error) {
            console.error('Error getting album:', error);
            return null;
        }
    },

    // Get user's playlists
    // onPageLoaded callback: called with (newPlaylists, totalLoaded, hasMore) for each page after the first
    async getUserPlaylists(limit = 50, onPageLoaded = null, userId = null) {
        try {
            // If userId is provided, fetch that user's public playlists, otherwise fetch current user's playlists
            const endpoint = userId 
                ? `/users/${userId}/playlists?limit=${limit}`
                : `/me/playlists?limit=${limit}`;
            const data = await this.makeRequest(endpoint);
            let allPlaylists = data?.items || [];
            let nextUrl = data?.next;
            
            // Call callback for first page
            if (onPageLoaded && allPlaylists.length > 0) {
                onPageLoaded(allPlaylists, allPlaylists.length, nextUrl !== null);
            }
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allPlaylists = allPlaylists.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allPlaylists.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more playlists:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning (old behavior)
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allPlaylists = allPlaylists.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more playlists:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allPlaylists;
        } catch (error) {
            console.error('Error getting user playlists:', error);
            return [];
        }
    },

    // Get playlist details
    // onPageLoaded callback: called with (newTracks, totalLoaded, hasMore) for each page after the first
    async getPlaylist(playlistId, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `?market=${this.userMarket}` : '';
            const playlist = await this.makeRequest(`/playlists/${playlistId}${marketParam}`);
            
            if (!playlist) return null;
            
            // Return initial playlist immediately with first page of tracks
            let allTracks = playlist.tracks?.items || [];
            let nextUrl = playlist.tracks?.next;
            
            // If there's more data and we have a callback, fetch remaining pages in the background
            if (nextUrl && onPageLoaded) {
                // Continue fetching in the background (don't await)
                (async () => {
                    while (nextUrl) {
                        // Add a small delay before fetching next page
                        await this.sleep(300); // 300ms delay
                        
                        // Try to fetch with retry logic
                        let data = null;
                        let retries = 3;
                        let retryDelay = 500; // Start with 500ms
                        let success = false;
                        
                        for (let attempt = 0; attempt < retries; attempt++) {
                            try {
                                // Use the full nextUrl directly since it's already a complete URL
                                const accessToken = SpotifyAuth.getAccessToken();
                                if (!accessToken) {
                                    throw new Error('No access token available');
                                }
                                
                                const response = await fetch(nextUrl, {
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
                                        'Content-Type': 'application/json'
                                    }
                                });
                                
                                if (!response.ok) {
                                    if (response.status === 404) {
                                        data = { error: 'NO_ACTIVE_DEVICE', status: 404 };
                                    } else {
                                        const errorData = await response.json().catch(() => ({}));
                                        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
                                    }
                                } else {
                                    data = await response.json();
                                }
                                
                                // Check if we got a 404 error response
                                if (data && data.error === 'NO_ACTIVE_DEVICE' && data.status === 404) {
                                    console.warn(`Got 404 on attempt ${attempt + 1}/${retries} for playlist tracks page`);
                                    if (attempt < retries - 1) {
                                        await this.sleep(retryDelay);
                                        retryDelay *= 2; // Exponential backoff
                                        continue; // Retry
                                    } else {
                                        console.error('Failed to fetch playlist tracks page after retries (404)');
                                        nextUrl = null; // Stop pagination on failure
                                        break;
                                    }
                                }
                                
                                // Success - we got valid data
                                success = true;
                                break;
                            } catch (error) {
                                console.warn(`Error on attempt ${attempt + 1}/${retries} for playlist tracks page:`, error.message);
                                if (attempt < retries - 1) {
                                    await this.sleep(retryDelay);
                                    retryDelay *= 2; // Exponential backoff
                                } else {
                                    console.error('Failed to fetch playlist tracks page after retries');
                                    nextUrl = null; // Stop pagination on failure
                                    break;
                                }
                            }
                        }
                        
                        if (success && data && data.items) {
                            allTracks = allTracks.concat(data.items);
                            nextUrl = data.next; // Will be null when no more pages
                            
                            // Notify caller with new tracks
                            if (onPageLoaded) {
                                onPageLoaded(data.items, allTracks.length, nextUrl !== null);
                            }
                        } else {
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback provided, fetch all pages before returning (old behavior)
                while (nextUrl) {
                    await this.sleep(300);
                    
                    let data = null;
                    let retries = 3;
                    let retryDelay = 500;
                    let success = false;
                    
                    for (let attempt = 0; attempt < retries; attempt++) {
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) {
                                throw new Error('No access token available');
                            }
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) {
                                if (response.status === 404) {
                                    data = { error: 'NO_ACTIVE_DEVICE', status: 404 };
                                } else {
                                    const errorData = await response.json().catch(() => ({}));
                                    throw new Error(errorData.error?.message || `API Error: ${response.status}`);
                                }
                            } else {
                                data = await response.json();
                            }
                            
                            if (data && data.error === 'NO_ACTIVE_DEVICE' && data.status === 404) {
                                console.warn(`Got 404 on attempt ${attempt + 1}/${retries} for playlist tracks page`);
                                if (attempt < retries - 1) {
                                    await this.sleep(retryDelay);
                                    retryDelay *= 2;
                                    continue;
                                } else {
                                    console.error('Failed to fetch playlist tracks page after retries (404)');
                                    nextUrl = null;
                                    break;
                                }
                            }
                            
                            success = true;
                            break;
                        } catch (error) {
                            console.warn(`Error on attempt ${attempt + 1}/${retries} for playlist tracks page:`, error.message);
                            if (attempt < retries - 1) {
                                await this.sleep(retryDelay);
                                retryDelay *= 2;
                            } else {
                                console.error('Failed to fetch playlist tracks page after retries');
                                nextUrl = null;
                                break;
                            }
                        }
                    }
                    
                    if (success && data && data.items) {
                        allTracks = allTracks.concat(data.items);
                        nextUrl = data.next;
                    } else {
                        nextUrl = null;
                    }
                }
                
                playlist.tracks.items = allTracks;
            }
            
            return playlist;
        } catch (error) {
            console.error('Error getting playlist:', error);
            return null;
        }
    },

    // Helper function for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Get user profile by ID
    async getUserById(userId) {
        try {
            return await this.makeRequest(`/users/${userId}`);
        } catch (error) {
            console.error('Error getting user by ID:', error);
            return null;
        }
    },

    // Get user's saved podcasts (shows)
    // onPageLoaded callback: called with (newShows, totalLoaded, hasMore) for each page after the first
    async getSavedPodcasts(limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/me/shows?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allShows = data?.items || [];
            let nextUrl = data?.next;
            
            // Call callback for first page
            if (onPageLoaded && allShows.length > 0) {
                onPageLoaded(allShows, allShows.length, nextUrl !== null);
            }
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allShows = allShows.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allShows.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more podcasts:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allShows = allShows.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more podcasts:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allShows;
        } catch (error) {
            console.error('Error getting saved podcasts:', error);
            return [];
        }
    },

    // Get podcast episodes
    // onPageLoaded callback: called with (newEpisodes, totalLoaded, hasMore) for each page after the first
    async getPodcastEpisodes(showId, limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/shows/${showId}/episodes?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allEpisodes = data?.items || [];
            let nextUrl = data?.next;
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allEpisodes = allEpisodes.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allEpisodes.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more episodes:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allEpisodes = allEpisodes.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more episodes:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allEpisodes;
        } catch (error) {
            console.error('Error getting podcast episodes:', error);
            return [];
        }
    },

    // Get podcast details
    async getPodcast(showId) {
        try {
            const marketParam = this.userMarket ? `?market=${this.userMarket}` : '';
            return await this.makeRequest(`/shows/${showId}${marketParam}`);
        } catch (error) {
            console.error('Error getting podcast:', error);
            return null;
        }
    },

    // Get user's liked episodes (saved episodes)
    // onPageLoaded callback: called with (newEpisodes, totalLoaded, hasMore) for each page after the first
    async getLikedEpisodes(limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/me/episodes?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allEpisodes = data?.items || [];
            let nextUrl = data?.next;
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allEpisodes = allEpisodes.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allEpisodes.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more liked episodes:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allEpisodes = allEpisodes.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more liked episodes:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allEpisodes;
        } catch (error) {
            console.error('Error getting liked episodes:', error);
            return [];
        }
    },

    // Get user's saved audiobooks
    // onPageLoaded callback: called with (newAudiobooks, totalLoaded, hasMore) for each page after the first
    async getSavedAudiobooks(limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/me/audiobooks?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allAudiobooks = data?.items || [];
            let nextUrl = data?.next;
            
            // Call callback for first page
            if (onPageLoaded && allAudiobooks.length > 0) {
                onPageLoaded(allAudiobooks, allAudiobooks.length, nextUrl !== null);
            }
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allAudiobooks = allAudiobooks.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allAudiobooks.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more audiobooks:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allAudiobooks = allAudiobooks.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more audiobooks:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allAudiobooks;
        } catch (error) {
            console.error('Error getting saved audiobooks:', error);
            return [];
        }
    },

    // Get audiobook details
    async getAudiobook(audiobookId) {
        try {
            const marketParam = this.userMarket ? `?market=${this.userMarket}` : '';
            return await this.makeRequest(`/audiobooks/${audiobookId}${marketParam}`);
        } catch (error) {
            console.error('Error getting audiobook:', error);
            return null;
        }
    },

    // Get audiobook chapters
    // onPageLoaded callback: called with (newChapters, totalLoaded, hasMore) for each page after the first
    async getAudiobookChapters(audiobookId, limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/audiobooks/${audiobookId}/chapters?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allChapters = data?.items || [];
            let nextUrl = data?.next;
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allChapters = allChapters.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allChapters.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more chapters:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allChapters = allChapters.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more chapters:', error);
                        nextUrl = null;
                    }
                }
            }
            
            return allChapters;
        } catch (error) {
            console.error('Error getting audiobook chapters:', error);
            return [];
        }
    },

    // Get user's liked songs (saved tracks)
    // onPageLoaded callback: called with (newTracks, totalLoaded, hasMore) for each page after the first
    async getLikedSongs(limit = 50, onPageLoaded = null) {
        try {
            const marketParam = this.userMarket ? `&market=${this.userMarket}` : '';
            const endpoint = `/me/tracks?limit=${limit}${marketParam}`;
            const data = await this.makeRequest(endpoint);
            let allTracks = data?.items || [];
            let nextUrl = data?.next;
            const total = data?.total || 0;
            
            if (nextUrl && onPageLoaded) {
                // Fetch remaining pages in background
                (async () => {
                    while (nextUrl) {
                        await this.sleep(300);
                        
                        try {
                            const accessToken = SpotifyAuth.getAccessToken();
                            if (!accessToken) break;
                            
                            const response = await fetch(nextUrl, {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (!response.ok) break;
                            
                            const pageData = await response.json();
                            if (pageData?.items) {
                                allTracks = allTracks.concat(pageData.items);
                                nextUrl = pageData.next;
                                
                                if (onPageLoaded) {
                                    onPageLoaded(pageData.items, allTracks.length, nextUrl !== null);
                                }
                            } else {
                                nextUrl = null;
                            }
                        } catch (error) {
                            console.error('Error loading more liked songs:', error);
                            nextUrl = null;
                        }
                    }
                })();
            } else if (nextUrl && !onPageLoaded) {
                // No callback - fetch all pages before returning
                while (nextUrl) {
                    await this.sleep(300);
                    
                    try {
                        const accessToken = SpotifyAuth.getAccessToken();
                        if (!accessToken) break;
                        
                        const response = await fetch(nextUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (!response.ok) break;
                        
                        const pageData = await response.json();
                        if (pageData?.items) {
                            allTracks = allTracks.concat(pageData.items);
                            nextUrl = pageData.next;
                        } else {
                            nextUrl = null;
                        }
                    } catch (error) {
                        console.error('Error loading more liked songs:', error);
                        nextUrl = null;
                    }
                }
            }
            
            // Return object with items and total count
            return {
                items: allTracks,
                total: total
            };
        } catch (error) {
            console.error('Error getting liked songs:', error);
            return { items: [], total: 0 };
        }
    },

    // Check if user has liked tracks (max 50 IDs at a time)
    async checkLikedTracks(trackIds) {
        try {
            if (!trackIds || trackIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < trackIds.length; i += 50) {
                chunks.push(trackIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/tracks/contains?ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking liked tracks:', error);
            return new Array(trackIds.length).fill(false);
        }
    },

    // Check if user has saved albums (max 50 IDs at a time)
    async checkLikedAlbums(albumIds) {
        try {
            if (!albumIds || albumIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < albumIds.length; i += 50) {
                chunks.push(albumIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/albums/contains?ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking liked albums:', error);
            return new Array(albumIds.length).fill(false);
        }
    },

    // Check if user follows artists (max 50 IDs at a time)
    async checkFollowedArtists(artistIds) {
        try {
            if (!artistIds || artistIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < artistIds.length; i += 50) {
                chunks.push(artistIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/following/contains?type=artist&ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking followed artists:', error);
            return new Array(artistIds.length).fill(false);
        }
    },

    // Check if user has saved shows/podcasts (max 50 IDs at a time)
    async checkLikedPodcasts(showIds) {
        try {
            if (!showIds || showIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < showIds.length; i += 50) {
                chunks.push(showIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/shows/contains?ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking liked podcasts:', error);
            return new Array(showIds.length).fill(false);
        }
    },

    // Check if user has saved episodes (max 50 IDs at a time)
    async checkLikedEpisodes(episodeIds) {
        try {
            if (!episodeIds || episodeIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < episodeIds.length; i += 50) {
                chunks.push(episodeIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/episodes/contains?ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking liked episodes:', error);
            return new Array(episodeIds.length).fill(false);
        }
    },

    // Check if user has saved audiobooks (max 50 IDs at a time)
    async checkLikedAudiobooks(audiobookIds) {
        try {
            if (!audiobookIds || audiobookIds.length === 0) return [];
            
            // Split into chunks of 50
            const chunks = [];
            for (let i = 0; i < audiobookIds.length; i += 50) {
                chunks.push(audiobookIds.slice(i, i + 50));
            }
            
            const results = [];
            for (const chunk of chunks) {
                const ids = chunk.join(',');
                const endpoint = `/me/audiobooks/contains?ids=${ids}`;
                const data = await this.makeRequest(endpoint);
                results.push(...data);
            }
            
            return results;
        } catch (error) {
            console.error('Error checking liked audiobooks:', error);
            return new Array(audiobookIds.length).fill(false);
        }
    },

    // Check if user follows a playlist
    async checkFollowedPlaylist(playlistId, userId) {
        try {
            if (!playlistId) return false;
            
            // Use current user ID if not provided
            const currentUserId = userId || SpotifyAuth.getUserId();
            if (!currentUserId) return false;
            
            const endpoint = `/playlists/${playlistId}/followers/contains?ids=${currentUserId}`;
            const data = await this.makeRequest(endpoint);
            
            // Returns array with single boolean
            return data[0] || false;
        } catch (error) {
            console.error('Error checking followed playlist:', error);
            return false;
        }
    },

    // ============================================
    // Toggle (Save/Unsave) Functions
    // ============================================

    // Save tracks to user's library
    async saveTracks(trackIds) {
        try {
            if (!trackIds || trackIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
            
            console.log('saveTracks called with IDs:', ids);
            
            // Split into chunks of 50 and save to Spotify liked songs
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/tracks';
                console.log('Saving tracks to Spotify API:', chunk);
                const result = await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify({ ids: chunk })
                });
                console.log('Spotify API save result:', result);
            }
            
            console.log('Tracks successfully saved to Spotify liked songs');
            
            // Update shadow playlist if it exists and feature is enabled
            if (typeof App !== 'undefined' && App.shadowPlaylist && App.shadowPlaylist.id) {
                const enabled = App.getSetting('allowLikedSongsContinuousPlayback', true);
                if (enabled) {
                    console.log('Updating shadow playlist...');
                    // Add tracks to shadow playlist
                    const trackUris = ids.map(id => `spotify:track:${id}`);
                    await this.addTracksToPlaylist(App.shadowPlaylist.id, trackUris);
                    // Update cached URIs
                    App.shadowPlaylist.trackUris = [...App.shadowPlaylist.trackUris, ...trackUris];
                    console.log('Added tracks to shadow playlist');
                }
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving tracks:', error);
            throw error;
        }
    },

    // Remove tracks from user's library
    async unsaveTracks(trackIds) {
        try {
            if (!trackIds || trackIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/tracks';
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            // Update shadow playlist if it exists and feature is enabled
            if (typeof App !== 'undefined' && App.shadowPlaylist && App.shadowPlaylist.id) {
                const enabled = App.getSetting('allowLikedSongsContinuousPlayback', true);
                if (enabled) {
                    // Remove tracks from shadow playlist
                    const trackUris = ids.map(id => `spotify:track:${id}`);
                    await this.removeTracksFromPlaylist(App.shadowPlaylist.id, trackUris);
                    // Update cached URIs
                    App.shadowPlaylist.trackUris = App.shadowPlaylist.trackUris.filter(
                        uri => !trackUris.includes(uri)
                    );
                    console.log('Removed tracks from shadow playlist');
                }
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unsaving tracks:', error);
            throw error;
        }
    },

    // Save albums to user's library
    async saveAlbums(albumIds) {
        try {
            if (!albumIds || albumIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(albumIds) ? albumIds : [albumIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/albums';
                await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving albums:', error);
            throw error;
        }
    },

    // Remove albums from user's library
    async unsaveAlbums(albumIds) {
        try {
            if (!albumIds || albumIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(albumIds) ? albumIds : [albumIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/albums';
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unsaving albums:', error);
            throw error;
        }
    },

    // Follow artists
    async followArtists(artistIds) {
        try {
            if (!artistIds || artistIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(artistIds) ? artistIds : [artistIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/following?type=artist';
                await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error following artists:', error);
            throw error;
        }
    },

    // Unfollow artists
    async unfollowArtists(artistIds) {
        try {
            if (!artistIds || artistIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(artistIds) ? artistIds : [artistIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/following?type=artist';
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unfollowing artists:', error);
            throw error;
        }
    },

    // Follow a playlist
    async followPlaylist(playlistId) {
        try {
            if (!playlistId) return { success: true };
            
            const endpoint = `/playlists/${playlistId}/followers`;
            await this.makeRequest(endpoint, {
                method: 'PUT',
                body: JSON.stringify({})
            });
            
            return { success: true };
        } catch (error) {
            console.error('Error following playlist:', error);
            throw error;
        }
    },

    // Unfollow a playlist
    async unfollowPlaylist(playlistId) {
        try {
            if (!playlistId) return { success: true };
            
            const endpoint = `/playlists/${playlistId}/followers`;
            await this.makeRequest(endpoint, {
                method: 'DELETE'
            });
            
            return { success: true };
        } catch (error) {
            console.error('Error unfollowing playlist:', error);
            throw error;
        }
    },

    // Update playlist details (name, description, public, collaborative)
    async updatePlaylistDetails(playlistId, updates) {
        try {
            if (!playlistId) return { success: true };
            
            const endpoint = `/playlists/${playlistId}`;
            await this.makeRequest(endpoint, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            
            return { success: true };
        } catch (error) {
            console.error('Error updating playlist:', error);
            throw error;
        }
    },

    // Save podcasts/shows to user's library
    async savePodcasts(showIds) {
        try {
            if (!showIds || showIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(showIds) ? showIds : [showIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = `/me/shows?ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving podcasts:', error);
            throw error;
        }
    },

    // Remove podcasts/shows from user's library
    async unsavePodcasts(showIds) {
        try {
            if (!showIds || showIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(showIds) ? showIds : [showIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = `/me/shows?ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'DELETE'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unsaving podcasts:', error);
            throw error;
        }
    },

    // Save episodes to user's library
    async saveEpisodes(episodeIds) {
        try {
            if (!episodeIds || episodeIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(episodeIds) ? episodeIds : [episodeIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/episodes';
                await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving episodes:', error);
            throw error;
        }
    },

    // Remove episodes from user's library
    async unsaveEpisodes(episodeIds) {
        try {
            if (!episodeIds || episodeIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(episodeIds) ? episodeIds : [episodeIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/episodes';
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unsaving episodes:', error);
            throw error;
        }
    },

    // Save audiobooks to user's library
    async saveAudiobooks(audiobookIds) {
        try {
            if (!audiobookIds || audiobookIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(audiobookIds) ? audiobookIds : [audiobookIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/audiobooks';
                await this.makeRequest(endpoint, {
                    method: 'PUT',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving audiobooks:', error);
            throw error;
        }
    },

    // Remove audiobooks from user's library
    async unsaveAudiobooks(audiobookIds) {
        try {
            if (!audiobookIds || audiobookIds.length === 0) return { success: true };
            
            // Handle single ID or array
            const ids = Array.isArray(audiobookIds) ? audiobookIds : [audiobookIds];
            
            // Split into chunks of 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const endpoint = '/me/audiobooks';
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify({ ids: chunk })
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error unsaving audiobooks:', error);
            throw error;
        }
    },

    // Add tracks/episodes to a playlist
    async addTracksToPlaylist(playlistId, uris, position = null) {
        try {
            if (!playlistId || !uris || uris.length === 0) return { success: true };
            
            // Handle single URI or array
            const urisArray = Array.isArray(uris) ? uris : [uris];
            
            // Spotify allows up to 100 tracks per request
            const chunks = [];
            for (let i = 0; i < urisArray.length; i += 100) {
                chunks.push(urisArray.slice(i, i + 100));
            }
            
            let currentPosition = position;
            for (const chunk of chunks) {
                const endpoint = `/playlists/${playlistId}/tracks`;
                const body = { uris: chunk };
                
                // Only include position for the first chunk, subsequent chunks will be inserted after
                if (currentPosition !== null) {
                    body.position = currentPosition;
                    currentPosition += chunk.length;
                }
                
                await this.makeRequest(endpoint, {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error adding tracks to playlist:', error);
            throw error;
        }
    },

    // Reorder tracks in a playlist
    async reorderPlaylistTracks(playlistId, rangeStart, insertBefore, rangeLength = 1) {
        try {
            if (!playlistId) return { success: true };
            
            const endpoint = `/playlists/${playlistId}/tracks`;
            const body = {
                range_start: rangeStart,
                insert_before: insertBefore,
                range_length: rangeLength
            };
            
            await this.makeRequest(endpoint, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
            
            return { success: true };
        } catch (error) {
            console.error('Error reordering playlist tracks:', error);
            throw error;
        }
    },

    // Remove tracks from a playlist
    async removeTracksFromPlaylist(playlistId, trackUris) {
        try {
            if (!playlistId || !trackUris || trackUris.length === 0) return { success: true };
            
            // Handle single URI or array
            const urisArray = Array.isArray(trackUris) ? trackUris : [trackUris];
            
            // Spotify allows up to 100 tracks per request
            const chunks = [];
            for (let i = 0; i < urisArray.length; i += 100) {
                chunks.push(urisArray.slice(i, i + 100));
            }
            
            for (const chunk of chunks) {
                const endpoint = `/playlists/${playlistId}/tracks`;
                const body = {
                    tracks: chunk.map(uri => ({ uri: uri }))
                };
                
                await this.makeRequest(endpoint, {
                    method: 'DELETE',
                    body: JSON.stringify(body)
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error removing tracks from playlist:', error);
            throw error;
        }
    },

    // Save (like) albums to user's library
    async saveAlbums(albumIds) {
        try {
            const idsArray = Array.isArray(albumIds) ? albumIds : [albumIds];
            
            // API allows up to 50 albums per request
            const chunks = [];
            for (let i = 0; i < idsArray.length; i += 50) {
                chunks.push(idsArray.slice(i, i + 50));
            }
            
            for (const chunk of chunks) {
                const endpoint = `/me/albums?ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving albums:', error);
            throw error;
        }
    },

    // Follow artists
    async followArtists(artistIds) {
        try {
            const idsArray = Array.isArray(artistIds) ? artistIds : [artistIds];
            
            // API allows up to 50 artists per request
            const chunks = [];
            for (let i = 0; i < idsArray.length; i += 50) {
                chunks.push(idsArray.slice(i, i + 50));
            }
            
            for (const chunk of chunks) {
                const endpoint = `/me/following?type=artist&ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error following artists:', error);
            throw error;
        }
    },

    // Follow playlists
    async followPlaylists(playlistIds) {
        try {
            const idsArray = Array.isArray(playlistIds) ? playlistIds : [playlistIds];
            
            // Follow each playlist (API doesn't support batch)
            for (const playlistId of idsArray) {
                const endpoint = `/playlists/${playlistId}/followers`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error following playlists:', error);
            throw error;
        }
    },

    // Save (follow) podcasts/shows to user's library
    async saveShows(showIds) {
        try {
            const idsArray = Array.isArray(showIds) ? showIds : [showIds];
            
            // API allows up to 50 shows per request
            const chunks = [];
            for (let i = 0; i < idsArray.length; i += 50) {
                chunks.push(idsArray.slice(i, i + 50));
            }
            
            for (const chunk of chunks) {
                const endpoint = `/me/shows?ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving shows:', error);
            throw error;
        }
    },

    // Save audiobooks to user's library
    async saveAudiobooks(audiobookIds) {
        try {
            const idsArray = Array.isArray(audiobookIds) ? audiobookIds : [audiobookIds];
            
            // API allows up to 50 audiobooks per request
            const chunks = [];
            for (let i = 0; i < idsArray.length; i += 50) {
                chunks.push(idsArray.slice(i, i + 50));
            }
            
            for (const chunk of chunks) {
                const endpoint = `/me/audiobooks?ids=${chunk.join(',')}`;
                await this.makeRequest(endpoint, {
                    method: 'PUT'
                });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error saving audiobooks:', error);
            throw error;
        }
    },
    
    // ========== Shadow Playlist Management ==========
    // These methods support continuous playback of liked songs
    
    // Find the shadow playlist by name
    async findShadowPlaylist() {
        try {
            const shadowName = 'DONOTTOUCH_LikedSongsShadow';
            let foundPlaylist = null;
            
            // Get all user playlists (without pagination callback to get all at once)
            const playlists = await this.getUserPlaylists(50);
            
            // Search for the shadow playlist
            for (const playlist of playlists) {
                if (playlist.name === shadowName) {
                    foundPlaylist = playlist;
                    break;
                }
            }
            
            return foundPlaylist;
        } catch (error) {
            console.error('Error finding shadow playlist:', error);
            return null;
        }
    },
    
    // Create the shadow playlist
    async createShadowPlaylist() {
        try {
            const name = 'DONOTTOUCH_LikedSongsShadow';
            const description = `⚠️ DO NOT MANUALLY EDIT ⚠️ This playlist is automatically managed by the Spotify Web Client to enable continuous playback of your Liked Songs. To get rid of this: un-check the "Allow continuous playback of liked songs" option in the account menu of the web client.`;
            
            const playlist = await this.createPlaylist(name, description, false); // false = private
            
            if (playlist) {
                console.log('Shadow playlist created:', playlist.id);
                
                // Create and upload 🚫 image (300x300)
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 300;
                    canvas.height = 300;
                    const ctx = canvas.getContext('2d');
                    
                    // Dark background
                    ctx.fillStyle = '#282828';
                    ctx.fillRect(0, 0, 300, 300);
                    
                    // Draw 🚫 emoji
                    ctx.font = '200px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🚫', 150, 150);
                    
                    // Convert to blob and upload
                    canvas.toBlob(async (blob) => {
                        try {
                            await this.uploadPlaylistCoverImage(playlist.id, blob);
                            console.log('Shadow playlist cover image uploaded');
                        } catch (imgError) {
                            console.error('Error uploading shadow playlist image:', imgError);
                        }
                    }, 'image/jpeg', 0.9);
                } catch (imgError) {
                    console.error('Error creating shadow playlist image:', imgError);
                }
            }
            
            return playlist;
        } catch (error) {
            console.error('Error creating shadow playlist:', error);
            throw error;
        }
    },
    
    // Get all tracks from the shadow playlist
    async getShadowPlaylistTracks(playlistId) {
        try {
            const playlist = await this.getPlaylist(playlistId);
            if (!playlist || !playlist.tracks) {
                return [];
            }
            
            const tracks = playlist.tracks.items || [];
            return tracks.map(item => item.track?.uri).filter(uri => uri);
        } catch (error) {
            console.error('Error getting shadow playlist tracks:', error);
            return [];
        }
    },
    
    // Sync shadow playlist with liked songs
    // likedSongsUris: array of track URIs from liked songs (in order)
    // currentShadowUris: array of track URIs currently in shadow playlist
    async syncShadowPlaylist(playlistId, likedSongsUris, currentShadowUris) {
        try {
            // Convert to sets for faster lookup
            const likedSet = new Set(likedSongsUris);
            const shadowSet = new Set(currentShadowUris);
            
            // Find tracks to remove (in shadow but not in liked)
            const toRemove = currentShadowUris.filter(uri => !likedSet.has(uri));
            
            // Find tracks to add (in liked but not in shadow)
            const toAdd = likedSongsUris.filter(uri => !shadowSet.has(uri));
            
            console.log(`Shadow playlist sync: ${toAdd.length} to add, ${toRemove.length} to remove`);
            
            // Remove tracks that are no longer liked
            if (toRemove.length > 0) {
                await this.removeTracksFromPlaylist(playlistId, toRemove);
            }
            
            // Add new liked tracks
            if (toAdd.length > 0) {
                await this.addTracksToPlaylist(playlistId, toAdd);
            }
            
            return { success: true, added: toAdd.length, removed: toRemove.length };
        } catch (error) {
            console.error('Error syncing shadow playlist:', error);
            throw error;
        }
    },
    
    // Delete the shadow playlist
    async deleteShadowPlaylist(playlistId) {
        try {
            if (!playlistId) return { success: true };
            
            // Unfollowing your own playlist effectively deletes it
            await this.unfollowPlaylist(playlistId);
            console.log('Shadow playlist deleted');
            
            return { success: true };
        } catch (error) {
            console.error('Error deleting shadow playlist:', error);
            throw error;
        }
    }
};

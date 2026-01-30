// Spotify PKCE Authentication Module

const SpotifyAuth = {
    // Generate a random string for code verifier
    generateRandomString(length) {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return values.reduce((acc, x) => acc + possible[x % possible.length], '');
    },

    // Generate code challenge from verifier using SHA256
    async generateCodeChallenge(codeVerifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64urlEncode(digest);
    },

    // Base64URL encode
    base64urlEncode(arrayBuffer) {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    // Store authentication data
    storeAuthData(data) {
        const expiresAt = Date.now() + (data.expires_in * 1000);
        localStorage.setItem('spotify_access_token', data.access_token);
        localStorage.setItem('spotify_expires_at', expiresAt.toString());
        if (data.refresh_token) {
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
    },

    // Get stored access token
    getAccessToken() {
        return localStorage.getItem('spotify_access_token');
    },

    // Get refresh token
    getRefreshToken() {
        return localStorage.getItem('spotify_refresh_token');
    },

    // Get user ID
    getUserId() {
        return localStorage.getItem('spotify_user_id');
    },

    // Store user ID
    storeUserId(userId) {
        if (userId) {
            localStorage.setItem('spotify_user_id', userId);
        }
    },

    // Check if token is expired
    isTokenExpired() {
        const expiresAt = localStorage.getItem('spotify_expires_at');
        if (!expiresAt) return true;
        return Date.now() >= parseInt(expiresAt);
    },

    // Clear all auth data
    clearAuthData() {
        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_refresh_token');
        localStorage.removeItem('spotify_expires_at');
        localStorage.removeItem('code_verifier');
        localStorage.removeItem('auth_state');
    },

    // Initiate login flow
    async login() {
        const codeVerifier = this.generateRandomString(64);
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        const state = this.generateRandomString(16);

        // Store for later use
        localStorage.setItem('code_verifier', codeVerifier);
        localStorage.setItem('auth_state', state);

        // Build authorization URL
        const params = new URLSearchParams({
            client_id: SPOTIFY_CONFIG.clientId,
            response_type: 'code',
            redirect_uri: SPOTIFY_CONFIG.redirectUri,
            scope: SPOTIFY_CONFIG.scope,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            state: state
        });

        // Redirect to Spotify authorization
        window.location.href = `${SPOTIFY_CONFIG.authEndpoint}?${params.toString()}`;
    },

    // Handle callback from Spotify
    async handleCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');

        // Check for errors
        if (error) {
            throw new Error(`Authorization error: ${error}`);
        }

        // Verify state parameter
        const storedState = localStorage.getItem('auth_state');
        if (state !== storedState) {
            throw new Error('State mismatch - possible CSRF attack');
        }

        if (!code) {
            throw new Error('No authorization code received');
        }

        // Exchange code for token
        const codeVerifier = localStorage.getItem('code_verifier');
        if (!codeVerifier) {
            throw new Error('Code verifier not found');
        }

        const response = await fetch(SPOTIFY_CONFIG.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: SPOTIFY_CONFIG.clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: SPOTIFY_CONFIG.redirectUri,
                code_verifier: codeVerifier
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
        }

        const data = await response.json();
        this.storeAuthData(data);

        // Clean up temporary storage
        localStorage.removeItem('code_verifier');
        localStorage.removeItem('auth_state');

        // Reload page without query parameters
        window.location.href = window.location.pathname;
    },

    // Refresh access token
    async refreshAccessToken() {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        const response = await fetch(SPOTIFY_CONFIG.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: SPOTIFY_CONFIG.clientId,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error}`);
        }

        const data = await response.json();
        this.storeAuthData(data);
        return data.access_token;
    }
};

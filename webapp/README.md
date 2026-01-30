# Spotify Web Client

A client-side Spotify web application using the PKCE authentication flow.

## Setup Instructions

### 1. Configure Spotify Application

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new application (or use an existing one)
3. Note your **Client ID**
4. In the app settings, add your **Redirect URI** (e.g., `http://localhost:8000/webapp/index.html`)

### 2. Update Configuration

Open `config.js` and update the following values:

```javascript
const SPOTIFY_CONFIG = {
    clientId: 'your_actual_client_id',
    redirectUri: 'your_actual_redirect_uri',
    // ... rest stays the same
};
```

### 3. Run the Application

Since this is a static web application, you need to serve it via HTTP (not file://):

**Option 1: Python HTTP Server**
```bash
# From the project root directory
python -m http.server 8000

# Then open: http://localhost:8000/webapp/index.html
```

**Option 2: Node.js HTTP Server**
```bash
npx http-server -p 8000

# Then open: http://localhost:8000/webapp/index.html
```

**Option 3: VS Code Live Server Extension**
- Install the "Live Server" extension
- Right-click on `index.html` and select "Open with Live Server"

### 4. Test Authentication

The application handles four scenarios:

- **Not Authenticated**: Shows a "Login with Spotify" button
- **OAuth Callback**: Automatically exchanges the authorization code for tokens
- **Authenticated**: Shows "Success!" message
- **Token Expired**: Automatically refreshes the token using the refresh token

## Features

- ✅ PKCE Authentication Flow (secure for client-side apps)
- ✅ State parameter for CSRF protection
- ✅ Token storage in localStorage
- ✅ Automatic token refresh
- ✅ Responsive design
- ✅ No external dependencies (uses native Web Crypto API)

## File Structure

```
webapp/
├── index.html      # Main HTML page
├── styles.css      # Responsive styling
├── config.js       # Configuration (update with your credentials)
├── auth.js         # Authentication logic (PKCE flow)
├── app.js          # Main application logic
└── README.md       # This file
```

## Current Scope

- `user-read-private` - Access to user profile information

## Security Notes

- Uses PKCE flow (no client secret exposed)
- Includes state parameter for CSRF protection
- Tokens stored in localStorage (consider sessionStorage for enhanced security)
- All API calls made directly from client to Spotify

## Next Steps

Future iterations can include:
- Additional OAuth scopes
- Spotify API functionality (playback, playlists, etc.)
- Enhanced UI components
- User profile display

// Spotify API Configuration
// IMPORTANT: Update these values with your actual Spotify App credentials
const SPOTIFY_CONFIG = {
    clientId: 'REPLACE_ME',
    redirectUri: 'REPLACE_ME', // e.g., 'http://localhost:8000/webapp/index.html'
    scope: 'ugc-image-upload user-read-playback-position user-library-read user-library-modify user-follow-read user-follow-modify user-read-email user-read-private user-read-playback-state user-modify-playback-state streaming playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private',
    authEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token'
};

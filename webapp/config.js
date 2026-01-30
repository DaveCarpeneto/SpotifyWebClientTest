// Spotify API Configuration
// IMPORTANT: Update these values with your actual Spotify App credentials
const SPOTIFY_CONFIG = {
    clientId: 'b71a38eb458c49638b9c8a8476d96b22',
    redirectUri: 'https://davecarpeneto.github.io/SpotifyWebClientTest/webapp/index.html', // e.g., 'http://localhost:8000/webapp/index.html'
    scope: 'ugc-image-upload user-read-playback-position user-library-read user-library-modify user-follow-read user-follow-modify user-read-email user-read-private user-read-playback-state user-modify-playback-state streaming playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private',
    authEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token'
};

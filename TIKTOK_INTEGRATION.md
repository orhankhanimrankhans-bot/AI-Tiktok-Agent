# TikTok Integration Guide - AI TikTok Agent Dashboard

## Overview

Your AI TikTok Agent now has fully integrated TikTok account management directly in the professional dashboard. You can:
- ✅ **Connect** your TikTok account with one click
- ✅ **Disconnect** your account anytime
- ✅ **View connection status** in real-time
- ✅ **Auto-detect** when token exists

## Quick Start

### 1. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:8000/
```

### 2. TikTok Account Card
Scroll down in the right sidebar to find the **TikTok Account** card with the 🎵 emoji.

### 3. Connect Your TikTok Account
- Click the **"Connect TikTok"** button
- You'll be redirected to TikTok's official OAuth login page
- Authorize the AI TikTok Agent to access your account
- The dashboard will automatically redirect back and show "Connected" status

### 4. Disconnect (Optional)
- Click the **"Disconnect TikTok"** button
- Confirm the disconnect action
- Your TikTok token will be securely removed

## How It Works

### Architecture

```
Dashboard UI (dashboard.html)
    ↓ (HTTP APIs)
Dashboard Server (dashboard_server.py)
    ↓
TikTok OAuth Endpoints:
  - /api/tiktok/status      → Check connection
  - /api/tiktok/login       → Start OAuth flow
  - /api/tiktok/callback    → Handle redirect
  - /api/tiktok/logout      → Disconnect
    ↓
Token Storage
  └─ data/tiktok_tokens.json (secure local file)
```

### Key Components

#### 1. **Dashboard Server** (dashboard_server.py)

**New TikTok OAuth Functions:**
```python
check_tiktok_connected()        # Check if token file exists
load_tiktok_token()            # Load access token from file
delete_tiktok_token()          # Remove token on disconnect
exchange_tiktok_code()         # Exchange auth code for token
save_tiktok_token()            # Save token to file
```

**New API Endpoints:**
- `GET /api/tiktok/status` - Returns `{"connected": bool, "token_exists": bool}`
- `GET /api/tiktok/login` - Initiates OAuth flow, redirects to TikTok auth
- `GET /api/tiktok/callback` - TikTok OAuth callback handler (automatic redirect)
- `POST /api/tiktok/logout` - Disconnects account

#### 2. **Dashboard UI** (dashboard.html)

**TikTok Account Card:**
- Real-time status display (green = connected, red = disconnected)
- Connect button (appears when not connected)
- Disconnect button (appears when connected)
- Status indicator with animated color change

**JavaScript Functions:**
```javascript
checkTikTokStatus()    // Poll status from API every 10 seconds
updateTikTokUI()       // Update card display based on status
connectTikTok()        // Redirect to OAuth login
disconnectTikTok()     // Call logout API and update UI
```

#### 3. **Token Storage** (data/tiktok_tokens.json)

Stores TikTok OAuth response:
```json
{
  "access_token": "your_access_token_here",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "your_refresh_token",
  "scope": "user.info.basic,video.upload,video.publish"
}
```

## Environment Setup

### Required Environment Variables

To enable TikTok OAuth, set these before running the dashboard:

```bash
# PowerShell
$env:TIKTOK_CLIENT_KEY = "your_client_key_here"
$env:TIKTOK_CLIENT_SECRET = "your_client_secret_here"

# Or in .env file
TIKTOK_CLIENT_KEY=your_client_key_here
TIKTOK_CLIENT_SECRET=your_client_secret_here
```

### How to Get Your Credentials

1. Go to [TikTok Developer Portal](https://developers.tiktok.com/)
2. Create a new app
3. Under "Development" → "API Setup":
   - Copy your **Client Key**
   - Copy your **Client Secret**
4. Add these to your environment or `.env` file

### OAuth Redirect URI

Your OAuth redirect URI is automatically configured as:
```
http://127.0.0.1:8000/api/tiktok/callback
```

Make sure to add this in your TikTok app settings under "Redirect URLs".

## Usage Flows

### Connect Flow
```
1. User clicks "Connect TikTok" button
   ↓
2. Browser redirects to: /api/tiktok/login
   ↓
3. Server generates PKCE code challenge
   ↓
4. Browser redirected to TikTok OAuth page
   ↓
5. User authorizes the app
   ↓
6. TikTok redirects to: /api/tiktok/callback?code=...&state=...
   ↓
7. Server exchanges code for access token
   ↓
8. Token saved to: data/tiktok_tokens.json
   ↓
9. Dashboard shows "Connected" status
```

### Disconnect Flow
```
1. User clicks "Disconnect TikTok" button
   ↓
2. Confirm dialog appears
   ↓
3. POST request to: /api/tiktok/logout
   ↓
4. Server deletes: data/tiktok_tokens.json
   ↓
5. Dashboard shows "Not Connected" status
```

### Status Check Flow
```
Every 10 seconds:
1. Frontend calls: GET /api/tiktok/status
   ↓
2. Server checks if data/tiktok_tokens.json exists
   ↓
3. Returns: {"connected": true/false, "token_exists": true/false}
   ↓
4. Dashboard updates UI accordingly
```

## Integration with Pipeline

The TikTok token is automatically available for the video publishing stage of your pipeline.

When videos are generated, they can use the stored TikTok token to:
- Upload videos via TikTok API
- Publish directly to your account
- Track upload status

### Using in orchestrator.py

```python
from app.publishing.tiktok_upload import load_access_token

# In your pipeline code:
try:
    access_token = load_access_token()
    # Use token to upload video
    publish_to_tiktok(video_path, access_token)
except RuntimeError as e:
    print(f"TikTok not connected: {e}")
```

## Troubleshooting

### Issue: "TikTok Client Key not configured"
**Solution:** Set the `TIKTOK_CLIENT_KEY` environment variable before starting the dashboard.

```bash
# PowerShell
$env:TIKTOK_CLIENT_KEY = "your_key"
python dashboard_server.py
```

### Issue: Redirect URI mismatch error
**Solution:** Ensure your TikTok app settings have the redirect URI:
```
http://127.0.0.1:8000/api/tiktok/callback
```

### Issue: "Invalid or expired OAuth session"
**Solution:** The OAuth session has expired. Try connecting again.

### Issue: Connection shows but token file missing
**Solution:** Check if `data/tiktok_tokens.json` exists and is readable.

```bash
# PowerShell
Test-Path "C:\AI_TikTok_Agent\data\tiktok_tokens.json"
# Do not print the token file contents to a terminal or support transcript.
```

### Issue: Still seeing "Not Connected" after authorizing
**Solution:** 
1. Clear browser cache (Ctrl+Shift+Del)
2. Refresh the dashboard (Ctrl+F5)
3. Wait 5 seconds for the status API to return

## Security Notes

🔒 **Token Safety:**
- Tokens stored locally in `data/tiktok_tokens.json`
- Never exposed in URLs or API responses
- Only used server-side for TikTok API calls
- Can be deleted anytime via "Disconnect" button

🔒 **PKCE Security:**
- Uses PKCE (Proof Key for Code Exchange) for OAuth
- Code challenge: SHA-256 hash of random verifier
- Prevents authorization code interception attacks

🔒 **Environment Variables:**
- Client Secret should never be in source code
- Always use environment variables or `.env` files
- Never commit credentials to git

## API Reference

### GET /api/tiktok/status
Check if TikTok account is connected.

**Response:**
```json
{
  "connected": true,
  "token_exists": true
}
```

### GET /api/tiktok/login
Initiate TikTok OAuth login (automatic redirect).

**Behavior:**
- Generates OAuth state and code challenge
- Redirects to TikTok authorization URL
- User authorizes app
- TikTok redirects to /api/tiktok/callback

### GET /api/tiktok/callback
TikTok OAuth callback handler (called by TikTok, not manually).

**Parameters:**
- `code` - Authorization code from TikTok
- `state` - OAuth state parameter
- `error` - Error code (if any)
- `error_description` - Error details (if any)

**Behavior:**
- Exchanges code for access token
- Saves token to data/tiktok_tokens.json
- Redirects to dashboard with success/error

### POST /api/tiktok/logout
Disconnect TikTok account.

**Response:**
```json
{
  "status": "success",
  "message": "TikTok account disconnected"
}
```

## Features Summary

| Feature | Status | Details |
|---------|--------|---------|
| Connect Account | ✅ Done | OAuth 2.0 + PKCE flow |
| Disconnect Account | ✅ Done | One-click disconnect |
| Status Display | ✅ Done | Real-time with color indicator |
| Auto-refresh | ✅ Done | Every 10 seconds |
| Error Handling | ✅ Done | User-friendly error messages |
| Token Persistence | ✅ Done | Stored in data/tiktok_tokens.json |
| Token Loading | ✅ Done | Used by publishing pipeline |
| Dashboard Integration | ✅ Done | Professional UI card |

## Next Steps

### To Get Started:
1. ✅ Set up TikTok app and credentials
2. ✅ Set environment variables
3. ✅ Start dashboard server
4. ✅ Open http://localhost:8000/
5. ✅ Click "Connect TikTok" button
6. ✅ Authorize and enjoy!

### For Video Publishing:
1. Ensure TikTok account is connected
2. Start the AI pipeline
3. Videos will automatically publish to your TikTok account
4. Check dashboard for publish status

## Support

For issues or questions:
1. Check Troubleshooting section above
2. Verify environment variables are set correctly
3. Check browser console for error messages (F12)
4. Review server logs for API errors

---

**Last Updated:** 2026-08-12  
**Version:** 1.0 (Full Integration)

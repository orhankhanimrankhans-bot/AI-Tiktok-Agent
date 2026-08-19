# TikTok Integration - Quick Reference

## 🎯 What Was Added

Your AI TikTok Agent dashboard now has **TikTok account management** with connect/disconnect buttons!

## 🚀 How to Use

### Step 1: Set Environment Variables
```bash
# PowerShell - Run BEFORE starting the dashboard
$env:TIKTOK_CLIENT_KEY = "your_client_key"
$env:TIKTOK_CLIENT_SECRET = "your_client_secret"
```

Get these from: https://developers.tiktok.com/

### Step 2: Start Dashboard
```bash
python dashboard_server.py
```

### Step 3: Open Dashboard
Open browser to: `http://localhost:8000/`

### Step 4: Connect TikTok
1. Scroll down in the sidebar
2. Find **🎵 TikTok Account** card
3. Click **"Connect TikTok"** button
4. Authorize in TikTok login page
5. Done! ✅ Status will show "Connected"

### Step 5: Disconnect (if needed)
1. Click **"Disconnect TikTok"** button
2. Confirm deletion
3. Token removed! ✅

---

## 📊 What Changed

### Files Modified:
1. **dashboard_server.py** - Added TikTok OAuth endpoints
2. **dashboard.html** - Added TikTok Account card with buttons

### New Endpoints:
- `GET /api/tiktok/status` - Check connection status
- `GET /api/tiktok/login` - Start OAuth flow
- `GET /api/tiktok/callback` - Handle redirect (automatic)
- `POST /api/tiktok/logout` - Disconnect account

### Token Location:
```
data/tiktok_tokens.json
```

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| Button doesn't work | Set `TIKTOK_CLIENT_KEY` environment variable |
| Says "Not Connected" after authorizing | Refresh page, wait 5 seconds |
| Redirect URI mismatch | Add `http://127.0.0.1:8000/api/tiktok/callback` to TikTok app settings |
| Token file missing | Reconnect your TikTok account |

---

## ✅ Features

- ✅ One-click TikTok connection
- ✅ Real-time status display
- ✅ Connect/Disconnect buttons
- ✅ Secure OAuth 2.0 + PKCE
- ✅ Auto token refresh every 10 seconds
- ✅ Professional dashboard card styling

---

## 📝 Token Usage

After connecting, your token is stored and automatically used by:
- Video upload pipeline
- TikTok API calls
- Pipeline publishing stage

---

## 🔐 Security

- Tokens stored locally only
- Never exposed in URLs
- Can delete anytime
- Uses OAuth 2.0 + PKCE best practices

---

**For full documentation, see:** [TIKTOK_INTEGRATION.md](TIKTOK_INTEGRATION.md)

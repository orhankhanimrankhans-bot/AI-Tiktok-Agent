# AI TikTok Agent Dashboard

A powerful, real-time N8N-style dashboard for visualizing and controlling your AI TikTok video generation pipeline.

## Features

✅ **Real-time Pipeline Visualization** — N8N-style animated workflow with node connections  
✅ **Live Stage Tracking** — See which stage is running with progress bars  
✅ **Statistics Dashboard** — Total videos, success rate, completed videos  
✅ **LLM Provider Switching** — Toggle between Ollama and ChatGPT  
✅ **Video History** — View all generated videos with status  
✅ **WebSocket Updates** — Real-time status updates via WebSocket  
✅ **Beautiful UI** — Dark theme with glassmorphism design and smooth animations  

## Quick Start

### 1. Install Dependencies

```bash
pip install fastapi uvicorn websockets
```

### 2. Start the Dashboard Server

```bash
python dashboard_server.py
```

Output:
```
🚀 Starting AI TikTok Agent Dashboard...
📊 Dashboard: http://localhost:8000
🔌 WebSocket: ws://localhost:8000/ws/pipeline
```

### 3. Open Dashboard in Browser

Navigate to: **http://localhost:8000**

### 4. Start a Pipeline

Click **▶ Start Pipeline** button in the dashboard header to trigger video generation.

---

## Architecture

### Backend (FastAPI + WebSocket)

**File**: `dashboard_server.py`

Provides:
- **REST API** for config, stats, video history
- **WebSocket** for real-time pipeline updates
- **Connection Manager** for broadcasting to all connected clients

Key endpoints:
```
GET    /api/config                      — Get LLM provider config
POST   /api/config/llm-provider         — Switch LLM provider
GET    /api/videos                      — Get all videos
GET    /api/videos/stats                — Get pipeline statistics
POST   /api/pipeline/start              — Start new pipeline
WS     /ws/pipeline                     — WebSocket for real-time updates
```

### Frontend (HTML/CSS/JavaScript)

**File**: `dashboard.html`

Features:
- **Canvas-based pipeline visualization** with animated stage nodes
- **Real-time updates** via WebSocket connection
- **Statistics panel** with live metrics
- **LLM provider selector** for switching between Ollama and ChatGPT
- **Recent videos list** updated every 10 seconds
- **Responsive design** that adapts to screen size

---

## Integration with Orchestrator

To enable real-time dashboard updates, modify `orchestrator.py` to notify the dashboard server as stages complete.

### Option 1: Simple Integration

Add to your `orchestrator.py`:

```python
import asyncio
from dashboard_server import manager

async def run_pipeline_with_dashboard():
    """Run pipeline and broadcast updates to dashboard"""
    
    # Stage 1: Topic Selection
    await manager.update_stage("Topic Selection", 11, topic=current_topic)
    # ... generate topic ...
    
    # Stage 2: Script Generation
    await manager.update_stage("Script Generation", 22, topic=current_topic)
    # ... generate script ...
    
    # ... continue for all 9 stages ...
    
    # When complete
    await manager.complete_pipeline({
        "topic": current_topic,
        "status": "completed",
        "file_path": output_path
    })
```

### Option 2: Minimal Integration

Use HTTP requests (no async needed):

```python
import requests

DASHBOARD_API = "http://localhost:8000"

def notify_stage(stage, progress, topic=None):
    # This is simplified; in production use a message queue
    # For now, the dashboard polls stats
    pass
```

---

## Environment Setup

### Using Ollama (Default)

No additional setup needed. Dashboard shows "Using local Ollama (phi3)".

### Using ChatGPT

Set environment variables before starting the pipeline:

```bash
# Windows PowerShell
$env:LLM_PROVIDER = "openai"
$env:OPENAI_API_KEY = "sk-..."
$env:OPENAI_MODEL = "gpt-4-turbo-preview"

# Then start pipeline
python -m app.orchestrator
```

The dashboard will reflect the active provider in the LLM Provider panel.

---

## Pipeline Stages Visualization

The dashboard displays all 9 stages with real-time progress:

1. 🎯 **Topic Selection** — Generate new TikTok topics
2. ✍️ **Script Generation** — Create video script with 6 sections
3. 🎨 **Visual Planning** — Plan 3 scenes for the video
4. 🎤 **Voice Generation** — Generate voice with Piper TTS
5. ✅ **Voice Validation** — Validate audio with Whisper
6. 🎬 **Video Rendering** — Compose 1080×1920 vertical video
7. 📝 **Caption Burning** — Add subtitles to video
8. 🚀 **TikTok Upload** — Publish video to TikTok
9. ✨ **Completed** — Pipeline finished

---

## Customization

### Change Dashboard Port

Edit `dashboard_server.py`:

```python
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9000,  # Change this
        log_level="info"
    )
```

Then update `dashboard.html`:

```javascript
const API_BASE = "http://localhost:9000";  // Update this too
```

### Change Theme Colors

Edit `dashboard.html` CSS section:

```css
/* Change primary color from cyan to purple */
--primary-color: #a78bfa;
```

### Add New Statistics

1. Add calculation in `dashboard_server.py` `/api/videos/stats` endpoint
2. Add UI element in `dashboard.html` sidebar
3. Update JavaScript to display the value

---

## Troubleshooting

### Dashboard not loading

```bash
# Check if server is running
curl http://localhost:8000
# Should return dashboard HTML or error
```

### WebSocket connection fails

- Ensure `dashboard_server.py` is running
- Check firewall allows localhost:8000
- Open browser console (F12) for detailed error messages

### Real-time updates not working

- Verify WebSocket is connected (check browser console)
- Ensure orchestrator is calling `manager.update_stage()`
- Check network tab for WebSocket frames

### Stats not updating

- Dashboard polls every 10 seconds by default
- Check `/api/videos/stats` endpoint is working:
  ```bash
  curl http://localhost:8000/api/videos/stats
  ```

---

## Advanced: Multi-Client Support

The dashboard supports multiple simultaneous connections. All connected clients receive real-time updates via WebSocket:

- Open dashboard in multiple browser tabs/windows
- All see the same real-time pipeline progress
- All can switch LLM provider
- No conflicts or synchronization issues

---

## Future Enhancements

- [ ] Video playback preview in dashboard
- [ ] Performance metrics (generation time per stage)
- [ ] Error logs and debugging panel
- [ ] Queue management (multiple videos)
- [ ] Export pipeline logs
- [ ] Custom pipeline step editor
- [ ] Cost tracking for OpenAI API usage

---

**Status**: Production-ready  
**Last Updated**: 2026-08-12

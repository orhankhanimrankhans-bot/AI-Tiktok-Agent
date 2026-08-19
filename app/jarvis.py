"""One local command to initialize Jarvis Core and run safe objectives."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from app.core.jarvis_core import JarvisCore
from app.memory import DATABASE


def main() -> int:
    parser = argparse.ArgumentParser(description="Jarvis AI TikTok Control Center")
    parser.add_argument("--objective", help="Create a TikTok video about this topic")
    parser.add_argument("--run", action="store_true", help="Run ready non-publishing tasks")
    parser.add_argument("--resume", action="store_true", help="Show unfinished task count")
    parser.add_argument("--test-mode", action="store_true", help="Never release publishing approval")
    parser.add_argument("--safe-mode", action="store_true", help="Block consequential and administrative tools")
    parser.add_argument("--no-voice", action="store_true", help="Initialize without the optional voice loop")
    parser.add_argument("--dashboard-only", action="store_true", help="Initialize services without running objectives")
    parser.add_argument("--whatsapp-test", action="store_true", help="Parse WhatsApp commands without opening chats")
    args = parser.parse_args()
    if args.whatsapp_test:
        os.environ["WHATSAPP_DRY_RUN"] = "1"
    core = JarvisCore(Path(DATABASE), safe_mode=args.safe_mode or args.test_mode)
    core.initialize()
    if args.objective and not args.dashboard_only:
        objective = core.create_video_objective(args.objective, approval_required=True)
        print(f"Objective created: {objective.id}")
        if args.run:
            results = core.run_ready_tasks(objective.id)
            print(f"Completed or attempted tasks: {len(results)}")
    elif args.resume:
        tasks = core.tasks.list_tasks()
        unfinished = [task for task in tasks if task.status.value not in {"COMPLETED", "CANCELLED"}]
        print(f"Unfinished tasks: {len(unfinished)}")
    else:
        print("Jarvis Core initialized. Dashboard: http://127.0.0.1:8000")
        print(f"Safe mode: {'ON' if core.permissions.safe_mode else 'OFF'}")
        print("Use --objective \"Why the sky is blue\" --run to begin a safe production run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

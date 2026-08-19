"""Cross-workflow quality gates, micro-benchmarks, and resource checks."""

from __future__ import annotations

import gc
import logging
import os
import tempfile
import threading
import time
import tracemalloc
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from jarvis import config
from jarvis.memory import JarvisMemory
from jarvis.plugins import BasePlugin, PluginManager
from jarvis.skills import BaseSkill, SkillContext, SkillRegistry, SkillResult
from observability import JsonFormatter


class FastSkill(BaseSkill):
    name = "fast"
    intents = ("fast",)

    def execute(self, context):
        return SkillResult(True, context.user_input)


class BlockingSkill(BaseSkill):
    name = "blocking"
    intents = ("blocking",)

    def __init__(self, entered, release):
        self.entered = entered
        self.release = release

    def execute(self, context):
        self.entered.set()
        self.release.wait(2)
        return SkillResult(True, context.user_input)


class SlowStartPlugin(BasePlugin):
    name = "slow_start"

    def __init__(self):
        self.starts = 0

    def start(self):
        time.sleep(0.02)
        self.starts += 1


class QualityAndPerformanceTests(unittest.TestCase):
    benchmark_results: dict[str, float] = {}

    @classmethod
    def tearDownClass(cls):
        print("\nPERFORMANCE BENCHMARKS")
        for name, duration in sorted(cls.benchmark_results.items()):
            print(f"{name}: {duration * 1000:.2f} ms")

    def benchmark(self, name, operation, limit_seconds):
        started = time.perf_counter()
        operation()
        duration = time.perf_counter() - started
        self.benchmark_results[name] = duration
        self.assertLess(duration, limit_seconds, f"{name} exceeded {limit_seconds}s")

    def test_configuration_validation_benchmark(self):
        self.benchmark(
            "config_validation_2000",
            lambda: [config.validate_configuration() for _ in range(2000)],
            1.0,
        )

    def test_skill_selection_and_snapshot_benchmark(self):
        registry = SkillRegistry(); registry.register(FastSkill())
        context = SkillContext("hello", intent="fast")
        self.benchmark(
            "skill_select_snapshot_5000",
            lambda: [(registry.select(context), registry.snapshot()) for _ in range(5000)],
            1.5,
        )

    def test_structured_logging_formatter_benchmark(self):
        formatter = JsonFormatter()
        record = logging.LogRecord("jarvis.benchmark", logging.INFO, __file__, 1, "ready", (), None)
        record.event = "benchmark"
        self.benchmark(
            "json_log_format_2000",
            lambda: [formatter.format(record) for _ in range(2000)],
            1.0,
        )

    def test_memory_roundtrip_has_bounded_memory_and_releases_database(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "quality.db"
            repository = JarvisMemory(database)
            tracemalloc.start()
            started = time.perf_counter()
            for index in range(100):
                repository.add_message("user", f"message {index}")
            messages = repository.get_recent_messages(100)
            duration = time.perf_counter() - started
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            self.benchmark_results["memory_100_write_read"] = duration
            self.assertEqual(len(messages), 100)
            self.assertLess(duration, 3.0)
            self.assertLess(peak, 10 * 1024 * 1024)
            del repository
            gc.collect()
            database.unlink()  # Windows proves no SQLite handle remains open.
            self.assertFalse(database.exists())

    def test_skill_snapshot_is_race_safe_during_execution(self):
        entered, release = threading.Event(), threading.Event()
        registry = SkillRegistry(); registry.register(BlockingSkill(entered, release))
        worker = threading.Thread(target=registry.execute, args=(SkillContext("x", intent="blocking"),))
        worker.start(); self.assertTrue(entered.wait(1))
        snapshots = [registry.snapshot() for _ in range(100)]
        self.assertTrue(any(item["active"] == "blocking" for item in snapshots))
        release.set(); worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertIsNone(registry.snapshot()["active"])

    def test_concurrent_plugin_start_is_serial_and_idempotent(self):
        plugin = SlowStartPlugin()
        manager = PluginManager(); manager.register(plugin)
        workers = [threading.Thread(target=manager.start_plugin, args=("slow_start",)) for _ in range(8)]
        for worker in workers: worker.start()
        for worker in workers: worker.join(2)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(plugin.starts, 1)
        self.assertEqual(manager.snapshot()["slow_start"]["phase"], "running")

    def test_cancelled_request_worker_suppresses_late_signal(self):
        from jarvis.dashboard import JarvisRequestThread

        responses = []
        worker = JarvisRequestThread(lambda _text: "late", "hello")
        worker.response_ready.connect(responses.append)
        worker.cancel(); worker.run()
        self.assertEqual(responses, [])

    def test_dashboard_close_stops_periodic_timer(self):
        from PySide6.QtWidgets import QApplication
        from jarvis.dashboard import DashboardWindow

        self.__class__.qt_app = QApplication.instance() or QApplication([])
        with patch.object(DashboardWindow, "_connect_backend"):
            window = DashboardWindow()
        self.assertTrue(window.skill_status_timer.isActive())
        window.close()
        self.assertFalse(window.skill_status_timer.isActive())

    def test_required_workflow_test_coverage_matrix(self):
        tests_dir = Path(__file__).parent
        matrix = {
            "Dashboard": "test_dashboard_integration.py",
            "ChatGPT": "test_chatgpt_integration.py",
            "Voice": "test_continuous_voice.py",
            "Memory": "test_stability_logging.py",
            "WhatsApp": "test_whatsapp_integration.py",
            "TikTok": "test_stability_logging.py",
            "Plugins": "test_configuration_and_plugins.py",
            "Skills": "test_skills_framework.py",
        }
        missing = [workflow for workflow, filename in matrix.items() if not (tests_dir / filename).is_file()]
        self.assertEqual(missing, [], f"Missing workflow suites: {missing}")
        self.assertEqual(len(matrix), 8)


if __name__ == "__main__":
    unittest.main()

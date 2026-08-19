from __future__ import annotations
import json,os,tempfile,unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from jarvis.workflow.connectors.schedule_trigger import DISPLAY_TYPES,ScheduleTriggerConnector,validate_rule
from jarvis.workflow.executor import WorkflowExecutor
from jarvis.workflow.models import WorkflowConnection,WorkflowDefinition,WorkflowNodeData
from jarvis.workflow.scheduler import schedule_event
from jarvis.workflow.storage import ExecutionStore,WorkflowStore

class ScheduleTriggerBackendTests(unittest.TestCase):
    def test_all_interval_types_validate(self):
        rules=[
          {"interval_type":"seconds","seconds":30},{"interval_type":"minutes","minutes":5},
          {"interval_type":"hours","hours":2,"minute":15},{"interval_type":"days","days":1,"hour":9,"minute":0},
          {"interval_type":"weeks","weeks":1,"weekdays":["Monday","Friday"],"hour":9,"minute":0},
          {"interval_type":"months","months":1,"day_of_month":31,"hour":9,"minute":0},
          {"interval_type":"cron","cron_expression":"*/5 * * * *"},
        ]
        for rule in rules: self.assertEqual(validate_rule(rule)["interval_type"],rule["interval_type"])
        with self.assertRaisesRegex(ValueError,"1–59"): validate_rule({"interval_type":"seconds","seconds":60})
        with self.assertRaisesRegex(ValueError,"weekday"): validate_rule({"interval_type":"weeks","weeks":1,"weekdays":[],"hour":0,"minute":0})
        with self.assertRaisesRegex(ValueError,"five fields"): validate_rule({"interval_type":"cron","cron_expression":"* *"})

    def test_due_event_and_structured_payload(self):
        settings={"enabled":True,"timezone":"local","rules":[{"interval_type":"seconds","seconds":1}]}
        now=datetime(2026,8,17,18,30,0,tzinfo=timezone.utc); slot,payload=ScheduleTriggerConnector().due_event(settings,now)
        self.assertIn("rule:0",slot); self.assertEqual(payload["trigger"],"schedule"); self.assertEqual(payload["interval_type"],"seconds"); self.assertTrue(payload["scheduled"])

    def test_engine_passes_schedule_and_mock_data_downstream(self):
        trigger=WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings={"rules":[{"interval_type":"minutes","minutes":5}],"_mock_data":{"topic":"Jarvis"}})
        text=WorkflowNodeData("n","text_data","Text",settings={"fields":{"copied":"{{$json.topic}}"}})
        workflow=WorkflowDefinition(nodes=[trigger,text],connections=[WorkflowConnection("t","n")])
        with tempfile.TemporaryDirectory() as directory: record=WorkflowExecutor(store=ExecutionStore(Path(directory))).run(workflow)
        self.assertEqual(record.status,"success"); self.assertEqual(record.node_results[-1]["output"]["copied"],"Jarvis"); self.assertEqual(record.node_results[0]["output"]["rule_index"],0)

    def test_schedule_settings_round_trip_without_loss(self):
        settings={"rules":[{"interval_type":"weeks","weeks":2,"weekdays":["Tuesday"],"hour":8,"minute":45}],"_notes":"Production","display_note_in_flow":True,"_mock_data":{"id":7}}
        workflow=WorkflowDefinition(nodes=[WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings=settings)])
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"flow.json"; WorkflowStore.save(workflow,path); loaded=WorkflowStore.load(path)
        self.assertEqual(loaded.nodes[0].settings,settings)

    def test_execute_once_blocks_later_scheduler_registration(self):
        node=WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings={"execute_once":True,"_executed_once":True,"rules":[{"interval_type":"seconds","seconds":1}]})
        self.assertIsNone(schedule_event(node,datetime(2026,8,17,18,30,0,tzinfo=timezone.utc)))

class ScheduleTriggerEditorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app=QApplication.instance() or QApplication([])
    def test_editor_rules_dynamic_fields_output_and_actions(self):
        from jarvis.workflow.schedule_editor import ScheduleTriggerEditor
        node=WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings={})
        editor=ScheduleTriggerEditor(node)
        self.assertEqual(editor.tabs.tabText(0),"Parameters"); self.assertEqual(editor.tabs.tabText(1),"Settings"); self.assertEqual(len(editor.rule_cards),1)
        card=editor.rule_cards[0]; self.assertEqual([card.interval.itemText(i) for i in range(card.interval.count())],list(DISPLAY_TYPES))
        card.interval.setCurrentIndex(card.interval.findData("weeks")); self.assertIn("weekdays",card.fields); self.assertIn("hour",card.fields)
        editor.add_rule({"interval_type":"cron","cron_expression":"* * * * *"}); self.assertEqual(len(editor.rule_cards),2)
        with patch("jarvis.workflow.schedule_editor.show_confirmation",return_value=True): editor.delete_rule(editor.rule_cards[-1])
        self.assertEqual(len(editor.rule_cards),1); self.assertFalse(editor.output.isVisible()); editor.show_data({"trigger":"schedule"}); self.assertEqual(json.loads(editor.output.json.toPlainText())["trigger"],"schedule"); editor.close()

if __name__=="__main__": unittest.main()

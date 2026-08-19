# Jarvis Multi-Agent-Ready Skills Framework

## Architecture

Prompt 11 keeps one stable `JarvisOrchestrator` as the only request coordinator and adds a modular skills boundary beneath it.

```text
Dashboard / Voice / CLI
          |
          v
  JarvisOrchestrator
    | conversation context + deterministic safety routes
    | intent and confidence
    v
   SkillRegistry
    ├── ConversationSkill -> existing ChatGPT conversation brain
    ├── AutomationSkill   -> existing Python tool registry
    ├── WhatsAppSkill     -> existing confirmed WhatsApp workflow
    └── discovered catalog skills (SystemHealthSkill today)
          |
          v
 response -> memory save -> interface
```

Conversation, memory, automation, and skills remain separate:

- Conversation detects structured intent and maintains model context.
- The orchestrator owns routing, clarification, sequencing, and final memory writes.
- Skills implement one common execution contract and receive only injected dependencies.
- Existing automation and WhatsApp adapters still own real-world actions.
- Skills never call other skills. Any multi-step or future multi-agent delegation must return to the orchestrator.

## Common interface

All skills inherit `BaseSkill` and expose metadata plus:

```python
def can_handle(self, context: SkillContext) -> bool: ...
def execute(self, context: SkillContext) -> SkillResult: ...
```

`SkillContext` carries user input, selected intent, structured arguments, and the explicitly injected conversation dependency. `SkillResult` carries success, a user-facing response, and an optional typed payload.

This contract allows future research, coding, or vision skills to be added without changing dashboard or interface code.

## Skill lifecycle

1. **Discovery:** `SkillRegistry.discover()` scans modules in `jarvis.skills.catalog` for concrete `BaseSkill` subclasses.
2. **Configuration:** registration checks enabled and disabled skill lists.
3. **Loading:** accepted instances are indexed by normalized skill name and logged.
4. **Selection:** the registry evaluates `can_handle()` and selects the highest-priority eligible skill.
5. **Execution:** active state is published in the registry snapshot and structured logs.
6. **Completion:** the skill returns `SkillResult`; the orchestrator owns response completion and memory persistence.
7. **Failure:** exceptions are contained, internal details are logged, a safe response is returned, and other skills remain available.

Unavailable or disabled skills return a graceful message rather than raising or crashing the dashboard.

## Configuration

```dotenv
JARVIS_ENABLED_SKILLS=conversation,automation,whatsapp,system_health
JARVIS_DISABLED_SKILLS=
```

- `JARVIS_ENABLED_SKILLS` is an allow-list. An empty programmatic allow-list permits every registered skill.
- `JARVIS_DISABLED_SKILLS` is an explicit deny-list and takes precedence.
- Changes are read when the Jarvis process starts.

## Orchestrator interaction

```text
request
  -> restore pending conversation/WhatsApp context
  -> preserve deterministic and safety route
  -> execute conversation skill
  -> validate structured intent + confidence
  -> request clarification when needed
  -> execute selected workflow/automation skill
  -> contain failure if any
  -> save final turn once
  -> return response
```

The design is multi-agent-ready because each future agent capability can be represented behind a skill contract, but execution remains deliberately single-orchestrator and sequential for stability.

## Dashboard integration

The AI Command Center Live Status panel now displays:

- number of loaded skills;
- currently active skill;
- most recently failed skill.

The dashboard polls a read-only registry snapshot every 300 ms. It does not load, invoke, or recover skills itself.

## Tests and results

`tests/test_skills_framework.py` covers:

1. skill registration, loading, selection, and execution;
2. package discovery of common-interface implementations;
3. config-disabled skill exclusion and graceful unavailability;
4. exception isolation and recovery through another skill;
5. dashboard loaded/active/failed skill visibility.

Validation command:

```powershell
python -m unittest discover -s tests -v
```

Result on 2026-08-15: **70 tests passed**. The full suite includes existing ChatGPT, orchestration, dashboard, voice, memory, logging, WhatsApp, TikTok, tools, core, and Urdu-language regressions.

## Current limitations

- Skill discovery is local Python package discovery; remote skill installation is outside this milestone.
- Execution is sequential. The registry exposes a future agent boundary but does not start parallel agents.
- Skill configuration is environment-based and requires a process restart.
- Active skill is transient; the dashboard samples it rather than controlling it.
- Existing deterministic safety routes remain above skill selection to preserve established behavior.

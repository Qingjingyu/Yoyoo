# Initial Claw Baseline

This file defines the recommended day-0 baseline for any new OpenClaw instance.

## Goal
A new claw should be:
- stable enough to chat immediately
- able to search, remember, and execute basic work
- not overloaded with too many experimental capabilities
- easy to clone into future instances

## Core Principle
A newborn claw should first have 4 abilities:
- can talk
- can search
- can remember
- can execute

Everything else is growth, not birth.

## Birth Baseline
These are required on day 0.

1. OpenClaw core
- pinned stable version
- isolated state directory
- isolated systemd service
- isolated ports

2. Model
- one confirmed working primary model
- one clear reasoning strength setting
- one explicit timeout

Recommended:
- model: `gmn/gpt-5.4`
- thinkingDefault: `xhigh`
- timeoutSeconds: `600` for heavy owner instance, `180` for light worker instance

3. Feishu channel
- websocket long connection
- verified account config
- pairing approved
- default DM usable

4. QMD memory backend
- memory backend set to `qmd`
- qmd binary installed and callable
- timeout configured

5. Structured memory skeleton
- workspace memory directory exists
- daily memory files can be written
- role profile files exist: `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `MEMORY.md`

6. Default recommended skill baseline
- install the default recommended skill list into the instance itself
- bootstrap script: `install_base_skills.sh`

7. Agent Reach tool layer
- install Agent Reach into the claw runtime home by default
- keep it isolated per claw instance, not mixed into the global system
- bootstrap script: `install_agent_reach.sh`
- use it as the default internet reach layer for newborn claws
- default bootstrap mode should stay safe and user-space first
- remember that some channels still need owner credentials, proxy, or login

8. File delivery rule
- all newborn claws should include the file-send rule by default
- generated files must be sent to the owner with `message(media=...)`
- replying with only a path or URL is not enough

## Default Recommended Skill List
This is now the default recommended installation set for every new claw.

### Search and information retrieval
1. `search`
2. `multi-search-engine`
3. `agent-browser`
4. `wechat-article-search`
5. `baoyu-url-to-markdown`
6. `find-skills`
7. `ontology`

### Initiative and growth
8. `proactive-agent`
9. `self-improvement`
10. `skill-creator`

### Team collaboration and organization
11. `agent-team-orchestration`
12. `actionbook`
13. `agent-docs`
14. `automation-workflows`

### Safety and governance
15. `security-audit`
16. `trust-verifier`
17. `skill-vetter`

### Built-in utility tools
18. `slides`
19. `spreadsheets`

## Specialized Extension Packs
These are useful, but they are not birth abilities.

### Finance Pack
Use when a claw is meant to do stock research, investment tracking, or market analysis.

- install script: `install_finance_skills.sh`
- current pack:
  - `us-stock-analysis`

Rule:
- finance skills are installed only for finance-oriented claws
- do not put them into the newborn default list
- keep the default birth package lean and stable

In simple terms:
- default package = a smart new assistant
- finance pack = a trained finance analyst add-on

## Recommended Newborn Profiles

### Profile A: Single Smart Assistant
Use for most new claws.

- 1 main agent only
- Feishu DM enabled
- group reply conservative by default
- QMD enabled
- default skill baseline enabled

This is the recommended default.

### Profile B: Execution Worker
Use for task-specific claws.

- 1 main agent only
- shorter timeout
- same default skill baseline
- focused on execution and reporting

### Profile C: Team Claw
Use only after the single-agent version is stable.

- multi-agent list enabled
- CEO/CTO/dev/qa style roles
- QMD per agent
- heavier memory and orchestration

Do not use this as the default newborn baseline.

## Recommended Day-0 Checklist
1. install pinned OpenClaw
2. create isolated state dir / service / ports
3. write model config
4. connect Feishu and approve pairing
5. enable QMD
6. create memory directories and role profile files
7. run `install_base_skills.sh`
8. run `install_agent_reach.sh`
9. ensure the file-send rule exists in `AGENTS.md`
10. run `openclaw doctor --fix`
11. verify DM ping works
12. verify one search request works
13. verify one memory write works
14. verify one generated file can be sent back to the owner

## What Should NOT Be Default
Do not include these by default unless the claw has a clear mission.

- multi-agent team layout itself
- Figma-heavy design stack
- visual audit stack beyond the default list
- too many overlapping search tools
- domain-specific experimental skills not in the baseline list
- finance-domain analysis skills such as `us-stock-analysis`

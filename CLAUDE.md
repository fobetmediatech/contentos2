# Content OS 2.0

## gstack

This project ships with [gstack](https://github.com/garrytan/gstack) under `.claude/skills/gstack`. Use it for browsing, planning, reviewing, and shipping work.

### Teammate setup (one-time)

After cloning the repo:

```bash
# 1. Install bun (gstack dependency)
brew install oven-sh/bun/bun

# 2. Run the gstack setup to link skills + install browsers
cd .claude/skills/gstack && ./setup
```

This links gstack's slash commands into `~/.claude/commands/` and downloads the Playwright browsers used by `/browse`.

### Browsing rule

For ALL web browsing, ALWAYS use the `/browse` skill from gstack.
NEVER use `mcp__claude-in-chrome__*` tools.

### Available gstack skills

- `/office-hours` — open-ended discussion / advice
- `/plan-ceo-review` — plan review from a CEO perspective
- `/plan-eng-review` — plan review from an engineering perspective
- `/plan-design-review` — plan review from a design perspective
- `/plan-devex-review` — plan review from a devex perspective
- `/design-consultation` — design consultation
- `/design-shotgun` — rapid design exploration
- `/design-html` — generate HTML design
- `/design-review` — review existing design
- `/devex-review` — review developer experience
- `/review` — code review of the current diff
- `/cso` — security review (chief security officer)
- `/ship` — finalize and ship work
- `/land-and-deploy` — land and deploy a branch
- `/canary` — canary release flow
- `/benchmark` — benchmarks
- `/browse` — web browsing (use this instead of Chrome MCP)
- `/connect-chrome` — connect to Chrome
- `/setup-browser-cookies` — set up browser cookies
- `/qa` — QA a URL
- `/qa-only` — QA only (no other steps)
- `/setup-deploy` — set up deployment
- `/setup-gbrain` — set up gbrain
- `/retro` — retrospective
- `/investigate` — investigate an issue
- `/document-release` — document a release
- `/document-generate` — generate documentation
- `/codex` — codex workflow
- `/autoplan` — auto-generate a plan
- `/careful` — careful mode
- `/freeze` — freeze
- `/guard` — guard
- `/unfreeze` — unfreeze
- `/gstack-upgrade` — upgrade gstack
- `/learn` — learn / capture lessons

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

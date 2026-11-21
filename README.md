# Agent World

A local browser idle game that shows your Claude Code agents as pixel-art characters. Each running session gets a character at a desk (or a module, or a dive site) in a place named after its repository. Characters earn XP for prompts, tool calls and finished tasks, level up, and keep their names and looks between sessions.

## Requirements

Node 22.13 or newer. `.nvmrc` names the Node 22 LTS line (`lts/jod`); run `nvm use`. The server stops with a message on older versions.

## Quick start

```bash
npm install
npm run dev:demo
```

Demo mode runs a simulator with fake sessions on port 4318 (Vite dev client on its own port, printed on start). It uses `demo.db`, separate from your real data. Each demo start (and each restart of the watched server) ends the sessions the previous run left behind, so the simulator starts fresh while the characters stay.

## Real use

```bash
npm start                 # builds the client, then serves everything at http://127.0.0.1:4317
npm run hooks:install     # points Claude Code's hooks at this app
npm run hooks:uninstall   # removes them again
npm run dev               # while working on Agent World itself: watched server on 4317 plus the Vite dev client
```

`hooks:install` edits `~/.claude/settings.json`:

- It adds one command hook (`hooks/forward.sh`, with its absolute path) to each of `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `PostModelSwitch` and `SessionEnd`, and, since the context, sidekick and failure features, `SubagentStart`, `SubagentStop`, `PostToolUseFailure`, `PreCompact` and `PostCompact`. Your other settings and hooks are left as they are.
- Before writing, it copies the existing file next to itself as `~/.claude/settings.json.agent-world-backup-<YYYYMMDD-HHMMSS>`.
- Running it twice changes nothing. If the file is not valid JSON, or `hooks` has an unexpected shape, it stops and changes nothing.
- `hooks:uninstall` removes only those entries (and backs up first).
- To use another file: `npm run hooks:install -- --settings <path>`.

The hook script posts each payload to `http://127.0.0.1:4317/ingest/claude-code` with a 1 second limit, prints nothing and always exits 0, so it cannot slow or break an agent. It works whether or not the app is running. Start new Claude Code sessions after installing.

**Updating from an earlier install:** run `npm run hooks:install` again to add the five newer hooks (it only adds what is missing). Everything else keeps working without it; without them sidekicks and failed tools simply never appear, and a compaction is noticed on the next ordinary hook event instead of at once.

The installed hooks point at this checkout's absolute path, and `hooks:uninstall` removes only entries with the path of the checkout it runs from. Before you move or rename the repository, run `npm run hooks:uninstall`; then run `npm run hooks:install` from the new location. If you already moved it, run `hooks:uninstall` from a checkout at the old path (or delete the old `forward.sh` entries from `~/.claude/settings.json` by hand), then install again.

## Playing

- Click a character (or a roster row) to open the inspector: Now (state, task, activity), Look, History and Achievements. Opening it acknowledges a "needs you" or "finished" marker.
- A new session shows as "Arriving" until its model is known (see below), then joins the roster with its own character.
- The roster cap (Settings, default 12, up to 50) limits how many named characters exist. Past it, extra sessions show as temps ("Temp"): a random look and no XP. Retire a character (Look tab) to free a place.
- A session whose terminal was killed never sends SessionEnd, so its character would stay at its desk for 12 hours. Use **Dismiss session…** on the inspector's Now tab to end it as if it had closed.
- Notices (needs you, finished, level up) show as toasts over the stage and in the ticker at the bottom; click a toast to select the character.
- System notifications are off until you allow them: open Settings (⚙) and click "Enable notifications", then grant the browser's permission prompt. The "Notify when an agent needs you / finishes" toggles control them (and the matching toasts); "Chime" adds a sound.
- Claude Code sends an `idle_prompt` notification about a minute after a session starts waiting for your next prompt; for a session that has finished or is idle it is only logged in the activity list, not shown as "needs you". Permission and question prompts always show as "needs you".
- If a Stop hook of yours blocks the agent from stopping, the task counts (XP, notice) once, at the first stop; the character goes back to "done" when the continuation ends.

## Seniority and effort

Model decides a character's tier (its seniority), set from the model id:

| Tier | Model id contains | Office | Space | Underwater |
|---|---|---|---|---|
| 1 | `haiku` | Junior | Cadet | Snorkeler |
| 2 | `sonnet` (also any other model id) | Engineer | Specialist | Diver |
| 3 | `opus` | Senior | Commander | Tech Diver |
| 4 | `fable`, `mythos` | Principal | Admiral | Master Diver |

A model id that matches none of these joins at tier 2 at once. Claude Code does not report the model when a session starts, so Agent World reads it from the session transcript once the model has replied. Until then the session shows as "Arriving", with no tier title, and holds the XP it earns. It joins the roster at its tier as soon as the model is known, and the held XP is credited then. If the model is still unknown 15 seconds after the session's first prompt (or its first event, for a session already running when Agent World started), it joins at tier 2. A session waiting for its first prompt waits as long as it takes. A session that ends while arriving joins at tier 2 if it earned anything; if it earned nothing, it leaves without adding a character.

Tier shows in the costume, the work spot, the name plate and the roster. It does not change XP; level is separate. The reported effort (`low`, `medium`, `high`, `xhigh`, `max`) shows as how intensely a working character animates.

Three themes ship: office, space and underwater. Switch in the settings panel; the choice is saved.

## Context, sidekicks, animations, socialising and recap

All five work in the office, space and underwater worlds and in demo mode. A source that does not report a signal just shows no gauge, no sidekick or the normal working pose.

### Context gauge

Each session shows how full its context window is: a thin bar under the name in the roster, a line on the inspector's Now tab ("Context 143k of 200k (72%, estimated) · 2 compactions this session"), and a gauge at the character's work spot. The gauge is a paper stack on the desk in the office, an oxygen tank readout in space and an air gauge on the tank underwater. In the office the paper stack grows as context fills; in space and underwater the gauge empties, as oxygen or air runs low. At or above the warning threshold it blinks slowly. Gauges (like sidekicks and tool actions) appear once the character has arrived at its work spot.

When context first reaches the threshold (Settings, "Warn at context %", default 80, range 50 to 95) you get one "running low" toast and, if enabled, a system notification ("Context running low" in Settings turns both off). It is information only: it does not mark the agent as needing you, change its state or the roster order, or touch the tab title count. It re-arms after a compaction, or when the token count falls to more than 10 points below the threshold; a limit that steps up (below) never re-arms it, so a large-window model gets one notice per fill. Changing the override or the threshold applies to running sessions at once, without a notice. A compaction shows a short animation at the work spot and a line in the ticker (on that page only, no toast); it earns no XP.

**The limit is an estimate.** Claude Code does not report a window size, so Agent World works it out per session:

1. the override in Settings ("Context limit override", in tokens, at least 10 000; empty means estimate), if set;
2. otherwise the size at which the most recent automatic compaction was seen for that model id (learned, kept in the data directory; a later one replaces it, lower or higher);
3. otherwise 200 000.

If a session is ever seen above its limit, the limit steps up to 500 000 or 1 000 000, whichever is the first at or above what was seen, and stays there for that session. The inspector says "estimated" for any limit that is not your override. Token counts read as 950, 143k, 1M or 1.2M, the same in the inspector and in compaction lines (999 600 is "1M", never "1000k").

**What is read from your transcripts.** Agent World already read the tail of each session's transcript file to find the model. It now takes the token counts of the latest main-thread reply and any compaction markers from that same tail read (at most one read per session every 2 seconds). Only token counts and model ids are used; no message text from the transcript is read into the app or stored. Subagent entries in the transcript are skipped.

### Sidekicks

When an agent runs a subagent, a small companion appears beside it until the subagent finishes: an intern in the office, a drone in space, a pilot fish underwater. Up to three are drawn, then a "+n" tag. The inspector lists them with the agent type (truncated to 24 characters) and how long each has run. Tools a subagent uses still earn the parent's XP as before. A sidekick missing its stop event disappears after 30 minutes without activity. Finishing 25 sidekicks earns the "Delegator" achievement. Internal helper agents with no type are ignored.

### Tool animations

The character's pose follows the kind of tool it just used for about 2.5 seconds: editing, shell, reading, web, delegating, or other tools (everything else, including MCP tools). A tool that fails shows a failure animation (sparks, a red flash or murky bubbles). A failed tool earns no XP and does not count as a tool; an interrupted tool is ignored. A sidekick's own tool use animates the sidekick only, not its parent.

### Socialising

Characters that are not working wander to the lounge and chat, with speech bubbles holding small icons: every 20 to 60 seconds, for 6 to 10 seconds, at most two chats at once. Only characters whose desk is on the first screen, and off-duty characters, join; the character you have selected, and characters that still need your attention, do not. An agent that is working or waiting on you never leaves its spot, and a chat breaks off at once if one of the pair starts working. When a neighbour in the same place finishes a task or levels up, others clap or cheer for a moment; one that is waiting on you never joins a cheer. This is decoration only; it changes no game state.

### Daily recap

The **Recap** button in the top bar opens a card for one day, with arrows to the previous and next day that have data: tasks finished, tools used, XP and levels; the MVP (most XP, drawn with its sprite); the busiest repo; compactions, sidekicks and failed tools when not zero; and the streak ("4 days running": consecutive days, ending today or yesterday, with at least one finished task). An empty day says "Nothing yet today". The first time you open the page on a new day, one toast shows yesterday's totals with a link to its card.

A day is the server machine's local calendar date (it rolls over at local midnight). Counts are credited when XP is actually credited to a character, so XP held while a session is "Arriving" lands on the day it is released. Recap rows are kept apart from the event log, so they are not pruned after 30 days, and they start from the day this feature ships (no backfill). The API behind the page is local only: `GET /api/snapshot`, `PUT /api/settings` and `GET /api/recap?day=YYYY-MM-DD` (default today).

## Privacy and data

Everything stays on your machine. The server binds to `127.0.0.1` only, makes no outside network requests and sends no telemetry.

Data lives in `~/.agent-world/` (`world.db`, and `demo.db` in demo mode). It holds characters, repos, sessions and events. Stored in plain text in that database: prompt text (first 500 characters), the last assistant message of each finished turn (first 500 characters), notification messages (such as "Claude needs your permission to use Bash"), and tool summaries (file path or the first 80 characters of a command). The directory is created readable only by you (0700) and the database file 0600. Events are pruned after 30 days. Daily recap totals (counts per day, character and repo) are stored too and kept. Each session's latest context reading is stored as numbers only. Delete the directory to start over.

## Environment variables

- `AGENT_WORLD_PORT`: server port (default 4317, demo 4318). The hook script reads the same variable.
- `AGENT_WORLD_HOME`: data directory (default `~/.agent-world`).

## Adding a theme

Implement the `Theme` interface in `src/client/engine/theme.ts` (id, name, movement, tier titles, lounge, place layout, backdrop, work spots, `drawCharacter`, effects), put it in `src/client/themes/<name>/`, and add it to the `THEMES` array in that file. Themes may import only `src/shared` and `src/client/engine`.

## Adding an agent type

1. Write an `Adapter` (`src/adapters/index.ts`): a pure `parse(raw, now)` that maps the agent's payload to `AgentEvent`s (`src/shared/types.ts`), mapping its models onto tiers 1 to 4, and returns `[]` for anything it does not recognize. Adapters import only `src/shared`. See `src/adapters/claudeCode.ts`.
2. Register it in `ADAPTERS` in `src/adapters/index.ts`, keyed by source name.
3. Point the agent's hook or notify command at `http://127.0.0.1:4317/ingest/<source>` (a JSON POST).

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Licence

MIT — see [LICENSE](LICENSE).

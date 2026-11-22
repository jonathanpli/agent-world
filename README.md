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

A day is the server machine's local calendar date (it rolls over at local midnight). Counts are credited when XP is actually credited to a character, so XP held while a session is "Arriving" lands on the day it is released. Recap rows are kept apart from the event log, so they are not pruned after 30 days, and they start from the day this feature ships (no backfill). The API behind the page is local only: `GET /api/snapshot`, `PUT /api/settings` and `GET /api/recap?day=YYYY-MM-DD` (default today). Every API write (`POST`, `PUT`, `PATCH` or `DELETE` under `/api/`) must carry the header `X-Agent-World: 1`, which the page sends and another web page cannot add without asking first; without it the server answers 403. The hook's `/ingest/…` route needs no such header.

## Background service, tokens, jump, git moments and shop

Five parts, each working on its own. Nothing here changes what the server sends or accepts from outside: it still binds to `127.0.0.1` only and checks the Host and Origin of every request.

After updating to this version, restart a running server so the database migration runs (a service: `npm run service:install` again, which also restarts it). The migration adds token and git columns to the daily totals and a table of purchases. You do not need to run `hooks:install` again: the hook script is read from this checkout, so the new version is picked up by itself.

### Background service (macOS)

Runs the server at login and restarts it if it stops, using a per-user `launchd` agent (label `com.agent-world.server`).

```bash
npm run service:install     # builds the client, writes ~/Library/LaunchAgents/com.agent-world.server.plist, loads it
npm run service:status      # installed or not, running (pid), port, PATH, node path, last 5 log lines
npm run service:uninstall   # stops it and deletes the plist; ~/.agent-world is left alone
npm run service:install -- --dry-run   # prints the plist and the steps it would take; changes nothing
```

- Install refuses on anything but macOS, when the `node` running it is older than 22.13, and when `node_modules/tsx` is missing from the checkout (run `npm install` first). The plist pins the absolute path of that `node`, runs the repository's `tsx` on `src/server/main.ts`, and writes output to `~/.agent-world/server.log`. The server cuts that log back to nothing at start when it is over 5 MB.
- The plist always carries the `PATH` of the shell you installed from (a login item otherwise has almost none). It also carries `AGENT_WORLD_PORT` and `AGENT_WORLD_HOME` when they were set at install time; a relative `AGENT_WORLD_HOME` is made absolute from the folder you ran install in, and the log goes there too.
- Running install again replaces the old copy: it stops it first, then checks the port. If the port is held by something else (for example a server you started by hand), install stops and says so. A plist left behind with no service loaded holds no port, so a busy port then stops install at once, before anything changes. It never ends another process.
- **What breaks it:** moving or renaming the repository, deleting the `node` version it was installed with (nvm users: uninstalling that Node version), or deleting `node_modules`. Run `npm run service:status` (it shows whether the node path still exists), fix the cause, then run install again. If the service does not come up, read `~/.agent-world/server.log`.
- Stop a hand-started server (`npm start`) before installing, or the port is busy.

### Tokens and estimated cost

Each session shows the tokens it has used, and an estimated cost.

- Where to look: the inspector's Now tab ("Tokens this session: 1.2M in · 48k out · 9.4M cached · est. $3.10", where "cached" is cache reads), the History tab (lifetime totals for the character) and the Recap card (the day's tokens and cost).
- **What is counted:** the token usage on the assistant replies in each session's transcript, from the main conversation, each reply once, plus each subagent's own replies. A subagent's tokens are read from its own transcript (the file Claude Code names when the subagent stops), once, when it finishes: they appear at the end of the subagent's run, priced at the subagent's model. A subagent still running when its session ends is not counted. Input, output, cache reads and cache writes (5-minute and 1-hour writes are priced separately) are counted. Transcripts are read from where the last read stopped, at most 4 MB at a time, and no message text is read from them.
- **From when:** counting starts when a session's transcript is first seen, so anything used before Agent World knew the session is not counted. There is no backfill. Tokens used while a session is still "Arriving" are held and credited when it joins, like XP.
- **The cost is an estimate** from public API prices, not your bill. It does not reflect a subscription plan (Pro, Max or Team), where usage is not billed per token. The price table is in `src/shared/prices.ts` and was taken from Anthropic's pricing page on **2026-11-21**; prices change, and it is not updated by itself. Prices are matched on the model id (Haiku, Sonnet, Opus and Fable/Mythos, current and previous generations; Haiku's higher rate applies to a single message whose prompt is over 100 000 tokens). A model that matches no row shows its tokens with no cost, and adds nothing to the dollar totals.
- To hide every dollar figure, switch off **Show estimated cost** in Settings. Tokens stay.
- Tokens earn no XP and change no state.

### Jump to session (macOS)

The inspector's Now tab, and the toast for a session that needs you, get a button that brings that session's terminal to the front. It says "Jump to terminal" when the right tab or window can be picked, "Bring terminal to front" when only the app can be raised, and "Jumping…" while it works. If something could only partly be done, a short note says what.

The hook script reports where each session runs (terminal app, iTerm session, tty, tmux pane, cmux workspace) as `X-AW-*` request headers. These identifiers stay on the server: they are kept in the database next to the session and are never sent to the browser, which only learns whether a session can be focused. A session with no usable identifier, a demo session, or any non-macOS host shows no button.

The server picks the first driver that fits, in this order:

| Terminal | Chosen when | What happens | Result |
|---|---|---|---|
| cmux | a cmux workspace id was reported | selects the workspace (and the panel) with the `cmux` program, then raises cmux | exact |
| iTerm2 | an iTerm session id was reported | selects that window, tab and session, raises iTerm | exact |
| Terminal.app | its bundle id, with a tty | selects the tab with that tty, raises Terminal (without a tty: just raises it) | exact, or app only |
| Editors | `TERM_PROGRAM=vscode` (VS Code, Cursor, Windsurf, and similar) | opens the session's folder in that app, which raises its window | exact |
| Anything else | a bundle id was reported | raises that app | app only |

tmux is a layer on top: if the session runs in a tmux pane, the window and pane are selected after the driver above has run (a failure there is ignored).

Details:

- Identifiers must look safe or that driver is skipped: an iTerm id must be a UUID (the part after `w0t0p0:`), and the others must start with a letter or digit. A skipped driver falls through to the next one.
- The server only runs fixed programs (`osascript`, `open`, `mdfind`, `tmux`, `cmux`) without a shell, each limited to 3 seconds, and no new step starts once a jump has run for 8 seconds (so a jump can take about 11). Only one jump per session runs at a time; a second click joins it.
- **macOS asks for permission once.** The first time a jump needs to script iTerm or Terminal, macOS shows an Automation prompt ("... wants to control iTerm"). Allow it. If you refused it, turn it on under System Settings, Privacy & Security, Automation, for the app that runs the server (your terminal if you started the server by hand; for the service, macOS names whatever it asked about). Until then a jump falls back to raising the window and says macOS may be denying permission.
- The program to look for is `cmux`; it is searched on `PATH`, and, for a session whose app has cmux's own bundle id (`com.cmuxterm.app` or `com.cmuxterm.app.*`), also inside the cmux app: first `cmux.app` in `/Applications` and `~/Applications`, then any app Spotlight finds for that bundle id, but only one directly in one of those two folders (a copy in Downloads or on a mounted disk is never run). For any other app only `cmux` on `PATH` is used.

#### Jumping to cmux tabs

cmux support is built from cmux's documentation and **has not been run against a real cmux**. The command names are checked only by tests with the program replaced. Treat it as untested; if it does not work for you, the flag names to adjust are in `src/server/focus.ts`.

cmux has an access mode for its control socket. By default it may accept only programs started from inside a cmux terminal, which a background server is not, so the request can be refused. When that happens, Agent World still raises cmux and the note says the tab could not be selected. Two ways to fix it:

1. In cmux's settings, set the socket access mode to allow external control (not only processes started inside cmux).
2. Or start the Agent World server with `CMUX_SOCKET_PASSWORD` in its environment. The `cmux` program reads it by itself; Agent World never reads or stores it. The service does not pass it on from your shell, so for the service use option 1 (or add it to the plist's environment by hand).

If the note says the `cmux` program was not found, put it on `PATH` (a service's `PATH` is the one from install time; run install again after changing it), or install cmux in `/Applications`.

cmux also has its own notifications and its own Claude Code hooks. They can run alongside Agent World, but one event may then alert you twice. If so, switch off "Notify when an agent needs you" and "Notify when an agent finishes" (and, if you like, "Context running low") in Settings; these also hide the matching toasts. To keep the toasts and drop only the system notifications, block notifications for the page in the browser's site settings. The ticker is unaffected either way.

### Git moments

Commits, pull requests and test runs become visible events and a little XP. They are recognised from the shell commands an agent runs (the `Bash` tool), in `src/adapters/moments.ts`. Commands are split on `&&`, `||`, `;`, `|`, a single `&` (a command sent to the background; not the `&` in `2>&1` or `&>`) and newlines; a leading `cd …`, environment assignments (`FOO=1`) and one `rtk` are skipped; `git -C dir …` is understood.

| Moment | Recognised command | When |
|---|---|---|
| Commit | `git commit …` (not `--dry-run`) | it succeeded |
| Push | `git push …` (not `--dry-run` or `-n`) | it succeeded |
| PR opened | `gh pr create …` | it succeeded |
| PR merged | `gh pr merge …` (not `--auto`) | it succeeded |
| Tests passed | `npm test`, `npm run test…`, `pnpm`/`yarn`/`bun` `test`, `npx vitest`/`jest`/`pytest`/`rspec`/`phpunit`, `vitest`, `jest`, `pytest`, `python -m pytest`, `rspec`, `phpunit`, `go test`, `cargo test`, `dotnet test`, `mvn`/`gradle` `test` | it succeeded |
| Tests failed | the same runners | the tool failed |

One moment at most per command; if several match, PR merged beats PR opened beats commit beats push beats tests. A commit's subject is shown when the output starts with `[branch hash] subject`.

XP, on top of the normal tool XP, goes to the agent that ran the command (a temp earns none). Past a cap the moment still shows but earns nothing. Caps are per session.

| Moment | XP | Cap |
|---|---|---|
| Commit | 10 | 6 per hour |
| PR opened | 20 | 2 per hour |
| PR merged | 40 | 2 per hour |
| Tests passed | 5 | 1 per 5 minutes |
| Push, tests failed | 0 | none |

Where you see them: always a ticker line ("Ada committed in agent-world: fix the gauge") and an activity line; a short celebration at the desk for a commit or a merged PR, and a brief red flash for a failed test run; a toast only for a merged PR; and a line on the Recap card ("12 commits · 2 PRs merged · 31 test runs, 4 failed"). No system notification. Four new achievements: First Commit (1 commit), Committed (100), Ship It (first merged PR) and Green Machine (50 passing test runs).

Known limits:

- Commands wrapped in `sudo`, `env`, `time` or `bash -c "…"` are not recognised.
- `gh pr merge --auto` only queues the merge, so it is not counted, not even when GitHub merges the PR later.
- Only what the hook reports is seen: a commit made by hand in another terminal is not.
- Moments are not counted for anything before this version.

### World shop

XP fills one shared wallet, and coins buy cosmetic upgrades for each world. They change how a world looks and nothing about the game: no XP rate, no cap, no number changes.

- **Wallet** = the XP of all characters (retired ones too) minus the coins spent. It is worked out from those two numbers, so it cannot drift, and it starts at the XP you have already earned. The coin counter is in the top bar; click it to open the Shop.
- The Shop has one tab per world, six upgrades each (18 in all). Each shows its cost and a Buy button, which asks once. **Purchases are final**: no refunds. A world draws only its own upgrades.

| Cost | Office | Space | Underwater |
|---|---|---|---|
| 100 | Office plants | Hydroponic planter | Sea anemones |
| 250 | Coffee machine | Drink dispenser | Treasure chest |
| 500 | Wall art | Star chart display | Sunken statue |
| 1 000 | Arcade cabinet | Observation dome | Glowing jellyfish swarm |
| 2 500 | Fish tank | Docked shuttle | Shipwreck |
| 5 000 | Rooftop skylight | Ringed planet in the window | Friendly whale that passes by |

- The coffee machine, drink dispenser and treasure chest also add a place for characters to stand and chat.
- Demo mode has its own wallet and purchases in `demo.db`.

## Privacy and data

Everything stays on your machine. The server binds to `127.0.0.1` only, makes no outside network requests and sends no telemetry.

Data lives in `~/.agent-world/` (`world.db`, and `demo.db` in demo mode). It holds characters, repos, sessions and events. Stored in plain text in that database: prompt text (first 500 characters), the last assistant message of each finished turn (first 500 characters), notification messages (such as "Claude needs your permission to use Bash"), and tool summaries (file path or the first 80 characters of a command). The directory is created readable only by you (0700) and the database file 0600. Events are pruned after 30 days. Daily recap totals (counts per day, character and repo) are stored too and kept. Each session's latest context reading is stored as numbers only. Token counts (never message text) are stored per session, character and day; the transcript read position and the terminal identifiers a hook reports are stored on the server too, and never sent to the browser. A shop purchase is a row of upgrade id and time. Delete the directory to start over.

## Environment variables

- `AGENT_WORLD_PORT`: server port (default 4317, demo 4318). The hook script reads the same variable.
- `AGENT_WORLD_HOME`: data directory (default `~/.agent-world`).
- `CMUX_SOCKET_PASSWORD`: not read by Agent World; the `cmux` program reads it when the server runs it (see Jumping to cmux tabs).

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

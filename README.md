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

- It adds one command hook (`hooks/forward.sh`, with its absolute path) to each of `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `PostModelSwitch` and `SessionEnd`. Your other settings and hooks are left as they are.
- Before writing, it copies the existing file next to itself as `~/.claude/settings.json.agent-world-backup-<YYYYMMDD-HHMMSS>`.
- Running it twice changes nothing. If the file is not valid JSON, or `hooks` has an unexpected shape, it stops and changes nothing.
- `hooks:uninstall` removes only those entries (and backs up first).
- To use another file: `npm run hooks:install -- --settings <path>`.

The hook script posts each payload to `http://127.0.0.1:4317/ingest/claude-code` with a 1 second limit, prints nothing and always exits 0, so it cannot slow or break an agent. It works whether or not the app is running. Start new Claude Code sessions after installing.

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

## Privacy and data

Everything stays on your machine. The server binds to `127.0.0.1` only, makes no outside network requests and sends no telemetry.

Data lives in `~/.agent-world/` (`world.db`, and `demo.db` in demo mode). It holds characters, repos, sessions and events. Stored in plain text in that database: prompt text (first 500 characters), the last assistant message of each finished turn (first 500 characters), notification messages (such as "Claude needs your permission to use Bash"), and tool summaries (file path or the first 80 characters of a command). The directory is created readable only by you (0700) and the database file 0600. Events are pruned after 30 days. Delete the directory to start over.

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

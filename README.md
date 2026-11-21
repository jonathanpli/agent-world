# Agent World

A local browser idle game that shows your Claude Code agents as pixel-art characters. Each running session gets a character at a desk (or a module, or a dive site) in a place named after its repository. Characters earn XP for prompts, tool calls and finished tasks, level up, and keep their names and looks between sessions.

## Requirements

Node 22 (`.nvmrc`; run `nvm use`).

## Quick start

```bash
npm install
npm run dev:demo
```

Demo mode runs a simulator with fake sessions on port 4318 (Vite dev client on its own port, printed on start). It uses `demo.db`, separate from your real data.

## Real use

```bash
npm start                 # builds the client, then serves everything at http://127.0.0.1:4317
npm run hooks:install     # points Claude Code's hooks at this app
npm run hooks:uninstall   # removes them again
```

`hooks:install` edits `~/.claude/settings.json`:

- It adds one command hook (`hooks/forward.sh`, with its absolute path) to each of `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `PostModelSwitch` and `SessionEnd`. Your other settings and hooks are left as they are.
- Before writing, it copies the existing file next to itself as `~/.claude/settings.json.agent-world-backup-<YYYYMMDD-HHMMSS>`.
- Running it twice changes nothing. If the file is not valid JSON, or `hooks` has an unexpected shape, it stops and changes nothing.
- `hooks:uninstall` removes only those entries (and backs up first).
- To use another file: `npm run hooks:install -- --settings <path>`.

The hook script posts each payload to `http://127.0.0.1:4317/ingest/claude-code` with a 1 second limit, prints nothing and always exits 0, so it cannot slow or break an agent. It works whether or not the app is running. Start new Claude Code sessions after installing.

## Seniority and effort

Model decides a character's tier (its seniority), set from the model id:

| Tier | Model id contains | Office | Space | Underwater |
|---|---|---|---|---|
| 1 | `haiku` | Junior | Cadet | Snorkeler |
| 2 | `sonnet` (also unknown models) | Engineer | Specialist | Scuba diver |
| 3 | `opus` | Senior | Commander | Technical diver |
| 4 | `fable`, `mythos` | Principal | Admiral | Master diver |

Tier shows in the costume, the work spot, the name plate and the roster. It does not change XP; level is separate. The reported effort (`low`, `medium`, `high`, `xhigh`, `max`) shows as how intensely a working character animates.

Three themes ship: office, space and underwater. Switch in the settings panel; the choice is saved.

## Privacy and data

Everything stays on your machine. The server binds to `127.0.0.1` only, makes no outside network requests and sends no telemetry.

Data lives in `~/.agent-world/` (`world.db`, and `demo.db` in demo mode). It holds characters, repos, sessions and events. Prompt text (first 500 characters) and tool summaries (file path or the first 80 characters of a command) are stored in plain text in that database. Events are pruned after 30 days. Delete the directory to start over.

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

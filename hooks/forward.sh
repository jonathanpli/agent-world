#!/bin/sh
# Agent World hook: forward the payload and get out of the way. Never fails, never prints.
payload=$(cat)
(printf '%s' "$payload" | curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "http://127.0.0.1:${AGENT_WORLD_PORT:-4317}/ingest/claude-code" >/dev/null 2>&1 &) >/dev/null 2>&1
exit 0

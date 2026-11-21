#!/usr/bin/env bash
# Captures real Claude Code hook payloads into a temp dir using a temporary
# settings file (never touches ~/.claude/settings.json). Prints the output dir.
set -u
OUT="${1:-$(mktemp -d)}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
TMP_SETTINGS="$TMP/settings.json"
EVENTS="SessionStart UserPromptSubmit PostToolUse Notification Stop PostModelSwitch SessionEnd"
{
  echo '{"hooks":{'
  first=1
  for ev in $EVENTS; do
    [ $first = 1 ] || echo ','
    first=0
    printf '"%s":[{"hooks":[{"type":"command","command":"cat > \\"%s/%s-$(date +%%s%%N).json\\""}]}]' "$ev" "$OUT" "$ev"
  done
  echo '}}'
} > "$TMP_SETTINGS"
REPO="$TMP/repo"
mkdir -p "$REPO" && cd "$REPO" && git init -q
perl -e 'alarm 120; exec @ARGV' claude -p "Run the command: echo hi" --settings "$TMP_SETTINGS" --allowedTools Bash
echo "payloads in $OUT"
ls "$OUT"

#!/bin/sh
# Agent World hook: forward the payload and get out of the way. Never fails, never prints.
# Terminal identifiers ride along as X-AW-* headers, each only when its value fits the server's pattern
# (the server validates again); every value reaches curl as one argument of its own.
payload=$(cat)
LC_ALL=C

aw_id() { case $1 in '' | *[!A-Za-z0-9.:_%-]*) return 1 ;; esac; [ ${#1} -le 80 ]; }
aw_bundle() { case $1 in '' | *[!A-Za-z0-9.-]*) return 1 ;; esac; [ ${#1} -le 80 ]; }
aw_socket() { case $1 in /?*) ;; *) return 1 ;; esac; case $1 in *[!A-Za-z0-9/._-]*) return 1 ;; esac; [ ${#1} -le 200 ]; }
aw_tty() { case $1 in ttys[0-9] | ttys[0-9][0-9] | ttys[0-9][0-9][0-9] | ttys[0-9][0-9][0-9][0-9]) return 0 ;; esac; return 1; }

# the controlling terminal of the hook's parent; a missing or failing ps leaves it empty
aw_t=$( { ps -o tty= -p "$PPID"; } 2>/dev/null ) || aw_t=
aw_t=${aw_t#"${aw_t%%[! ]*}"}
aw_t=${aw_t%"${aw_t##*[! ]}"}
aw_tmux_socket=${TMUX%%,*}

set --
aw_bundle "$__CFBundleIdentifier" && set -- "$@" -H "X-AW-Bundle-Id: $__CFBundleIdentifier"
aw_id "$TERM_PROGRAM" && set -- "$@" -H "X-AW-Term-Program: $TERM_PROGRAM"
aw_id "$ITERM_SESSION_ID" && set -- "$@" -H "X-AW-Iterm-Session: $ITERM_SESSION_ID"
aw_tty "$aw_t" && set -- "$@" -H "X-AW-Tty: $aw_t"
aw_id "$TMUX_PANE" && set -- "$@" -H "X-AW-Tmux-Pane: $TMUX_PANE"
aw_socket "$aw_tmux_socket" && set -- "$@" -H "X-AW-Tmux-Socket: $aw_tmux_socket"
aw_id "$CMUX_WORKSPACE_ID" && set -- "$@" -H "X-AW-Cmux-Workspace: $CMUX_WORKSPACE_ID"
aw_id "$CMUX_SURFACE_ID" && set -- "$@" -H "X-AW-Cmux-Surface: $CMUX_SURFACE_ID"
aw_id "$CMUX_PANEL_ID" && set -- "$@" -H "X-AW-Cmux-Panel: $CMUX_PANEL_ID"
aw_socket "$CMUX_SOCKET_PATH" && set -- "$@" -H "X-AW-Cmux-Socket: $CMUX_SOCKET_PATH"

(printf '%s' "$payload" | curl -q -s -m 1 --noproxy '*' -X POST -H 'Content-Type: application/json' "$@" --data-binary @- \
  "http://127.0.0.1:${AGENT_WORLD_PORT:-4317}/ingest/claude-code" >/dev/null 2>&1 &) >/dev/null 2>&1
exit 0

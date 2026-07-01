#!/usr/bin/env bash
# agent_chat.sh — talk to a Promethist agent via the pipeline REST API (text mode).
# One call = one turn. Session persists via a cookie-jar file. Prints BOTH sides.
#
# Promethist runs TWO models: a realtime-llm (talks to the user) and a reasoning-llm
# (sees the full agent config + knowledge + MCP and sends the realtime-llm guidance
# as #realtime-planning / #realtime-instruction frames). The quality of those frames
# drives the realtime answer.
#
# Default (fast): stop at #response-end (answer complete); skip audio. ~halves latency.
# --diagnose:     also surface the reasoning-llm -> realtime-llm hand-off frames
#                 (⟦plan⟧ / ⟦instruction⟧). Slower, but shows WHY the answer came out
#                 as it did. Use it when a turn behaves oddly.
#
# Usage:
#   agent_chat.sh --key agent:<ref> [--url <engine>] [--locale cs-CZ] [--new] [--diagnose] [--raw] ["message"]
#   Drafts: --key agent:<ref>.<revision>   (e.g. agent:aA1.7)
set -u
URL="https://eu.promethist.ai"; KEY=""; LOCALE="en-US"; SESSION=""; NEW=false; RAW=false; DIAG=false; MSG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2;; --key) KEY="$2"; shift 2;; --locale) LOCALE="$2"; shift 2;;
    --session) SESSION="$2"; shift 2;; --new) NEW=true; shift;; --raw) RAW=true; shift;;
    --diagnose|--diag) DIAG=true; shift;;
    --*) echo "Unknown option: $1" >&2; exit 1;;
    *) MSG="$1"; shift;;
  esac
done
[[ -z "$KEY" ]] && { echo "Error: --key agent:<ref> is required" >&2; exit 1; }
[[ -z "$SESSION" ]] && SESSION=".session-$(echo "$KEY" | tr ':/.' '---')"
$NEW && { rm -f "$SESSION" 2>/dev/null || true; }

call() {
  local line cite=0 ref t
  exec 3< <(curl -s --no-buffer -N -b "$SESSION" -c "$SESSION" -G \
      --data-urlencode "text=$1" --data-urlencode "locale=$LOCALE" \
      "${URL}/api/pipeline/${KEY}?outputFormat=TEXT&inputFormat=TEXT&textOnly=true" 2>/dev/null)
  local cpid=$!
  while IFS= read -r line <&3; do
    if $RAW; then printf '%s\n' "$line"; case "$line" in '#exit'*) break;; esac; continue; fi
    case "$line" in
      '#response-end'*) $DIAG || break;;
      '#exit'*) break;;
      'Supporting citations:'*) cite=1;;
      '#tool-call'*result=completed*) ;;
      '#tool-call'*name=*) ref=$(printf '%s' "$line" | sed -E 's/.*name=([A-Za-z0-9_]+).*/\1/'); echo "  ⟦tool: $ref⟧";;
      '#multimodal-interaction'*) ref=$(printf '%s' "$line" | sed -E 's/.*"ref":"([^"]+)".*/\1/'); echo "  ⟦shows: $ref⟧";;
      '#realtime-planning'*) if $DIAG; then t=$(printf '%s' "$line" | sed -E 's/^#realtime-planning:(.*&)?text=//'); [[ -n "${t// }" ]] && echo "  ⟦reasoning→plan⟧ ${t:0:700}"; fi;;
      '#realtime-instruction'*) if $DIAG; then t=$(printf '%s' "$line" | sed -E 's/^#realtime-instruction:(.*&)?text=//'); echo "  ⟦reasoning→instruction⟧ ${t:0:700}"; fi;;
      '#'*) ;;
      '') ;;
      *) [[ $cite -eq 0 ]] && printf '%s\n' "$line";;
    esac
  done
  exec 3<&- 2>/dev/null || true
  kill "$cpid" 2>/dev/null || true; wait "$cpid" 2>/dev/null || true
}

if [[ -n "$MSG" ]]; then echo "You:   $MSG"; echo "Agent:"; call "$MSG"; exit 0; fi
echo "=== Promethist agent chat — $KEY @ $URL ===" >&2; echo "(type 'exit' to quit)" >&2
[[ ! -s "$SESSION" ]] && { echo "Agent:"; call "#intro"; }
while IFS= read -r -p "You: " line; do
  case "$line" in exit|quit|bye) break;; "") continue;; esac
  echo "Agent:"; call "$line"
done

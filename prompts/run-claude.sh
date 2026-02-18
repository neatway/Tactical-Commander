#!/bin/bash
# ============================================================================
# run-claude.sh — Auto-resume runner for Claude Code on VPS
#
# This script runs Claude Code in a loop. When Claude hits a usage limit
# or exits, the script waits for the limit to reset and tries again.
# It stops only when Claude writes "ALL TASKS COMPLETE" to OVERNIGHT-LOG.md.
#
# Usage:
#   tmux new-session -d -s claude-worker 'bash ~/run-claude.sh'
#
# To watch:
#   tmux attach -t claude-worker
#
# To stop:
#   tmux kill-session -t claude-worker
# ============================================================================

# --- Configuration ---
PROJECT_DIR="/root/1v1-strat-game"
LOG_FILE="$HOME/claude-runner.log"
OVERNIGHT_LOG="$PROJECT_DIR/OVERNIGHT-LOG.md"
RETRY_COUNT=0

# --- The prompt Claude receives each time it starts ---
CLAUDE_PROMPT="Continue building the Tactical Commander project.

FIRST: Read OVERNIGHT-LOG.md to see where the last session left off.
ALSO READ: PROGRESS.md for the full status, CLAUDE.md for project rules, and tactical-commander/plan.md for the complete game design.

Pick up EXACTLY where the last session stopped. Do the next task in the list.

RULES:
- Comment everything properly. Make code easy to read. This is critical.
- Git commit and push after every meaningful chunk of work (don't accumulate hours of changes).
- At the END of your session (before you exit), append what you did to OVERNIGHT-LOG.md and git push.
- If ALL milestone 1 tasks from PROGRESS.md are done, write 'ALL TASKS COMPLETE' to OVERNIGHT-LOG.md and exit."

# --- Helper: log with timestamp ---
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# --- Main loop ---
log "=========================================="
log "Claude Runner started"
log "Project: $PROJECT_DIR"
log "=========================================="

while true; do
    # Pull latest changes (in case we pushed from local machine)
    cd "$PROJECT_DIR"
    git pull --rebase 2>/dev/null || true

    # Check if all tasks are complete
    if [ -f "$OVERNIGHT_LOG" ] && grep -q "ALL TASKS COMPLETE" "$OVERNIGHT_LOG"; then
        log "ALL TASKS COMPLETE found in OVERNIGHT-LOG.md. Stopping."
        break
    fi

    # Run Claude Code
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log "--- Session #$RETRY_COUNT starting ---"

    cd "$PROJECT_DIR"
    claude --dangerously-skip-permissions -p "$CLAUDE_PROMPT" 2>&1 | tee -a "$LOG_FILE"

    EXIT_CODE=$?
    log "Claude exited with code $EXIT_CODE"

    # Push any uncommitted work
    cd "$PROJECT_DIR"
    if [ -n "$(git status --porcelain)" ]; then
        log "Pushing uncommitted changes..."
        git add -A
        git commit -m "Auto-commit: work in progress from VPS session #$RETRY_COUNT" || true
        git push || true
    fi

    # Check again if all tasks are complete
    if [ -f "$OVERNIGHT_LOG" ] && grep -q "ALL TASKS COMPLETE" "$OVERNIGHT_LOG"; then
        log "ALL TASKS COMPLETE found in OVERNIGHT-LOG.md. Stopping."
        break
    fi

    # Sleep before retrying
    if [ "$RETRY_COUNT" -eq 1 ]; then
        # First retry: wait 3 hours for usage limit to reset
        SLEEP_SECONDS=10800
        log "First retry — sleeping 3 hours ($SLEEP_SECONDS seconds)..."
    else
        # Subsequent retries: wait 5.5 hours
        SLEEP_SECONDS=19800
        log "Retry #$RETRY_COUNT — sleeping 5h 30m ($SLEEP_SECONDS seconds)..."
    fi

    sleep $SLEEP_SECONDS
    log "Waking up, starting next session..."
done

log "=========================================="
log "Claude Runner finished"
log "=========================================="

#!/bin/bash
# ============================================================================
# run-claude.sh — Auto-resume runner for Claude Code on VPS
#
# Runs Claude in 30-minute sessions. After each session:
#   - Pushes all work to GitHub
#   - Immediately starts a new session (no waiting)
#
# If Claude hits a rate limit, it waits for the limit to reset:
#   - First time: 3 hours
#   - After that: 5.5 hours
#
# Stops only when OVERNIGHT-LOG.md contains "ALL TASKS COMPLETE".
#
# Usage:
#   tmux new-session -d -s claude-worker 'bash ~/run-claude.sh'
#
# To watch:   tmux attach -t claude-worker   (Ctrl+B, D to detach)
# To stop:    tmux kill-session -t claude-worker
# ============================================================================

# --- Configuration ---
PROJECT_DIR="/root/1v1-strat-game"
LOG_FILE="$HOME/claude-runner.log"
OVERNIGHT_LOG="$PROJECT_DIR/OVERNIGHT-LOG.md"
SESSION_COUNT=0
RATE_LIMIT_COUNT=0

# 30 minutes per session (in seconds)
SESSION_TIMEOUT=1800

# --- The prompt Claude gets every 30 minutes ---
CLAUDE_PROMPT="Continue building the Tactical Commander project.

FIRST: Read OVERNIGHT-LOG.md to see where the last session left off.
ALSO READ: PROGRESS.md for the full status, CLAUDE.md for project rules, and tactical-commander/plan.md for the complete game design.

Pick up EXACTLY where the last session stopped. Do the next task in the list.

RULES:
- Comment everything properly. Make code easy to read. This is critical.
- Git commit and push after every meaningful chunk of work (don't accumulate hours of changes).
- Before your session ends, update OVERNIGHT-LOG.md with what you accomplished and what's next.
- Update PROGRESS.md checkboxes and percentages when you finish milestone items.
- If ALL milestone 1 tasks from PROGRESS.md are done, write 'ALL TASKS COMPLETE' to OVERNIGHT-LOG.md and exit."

# --- Helper: log with timestamp ---
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# --- Helper: push any uncommitted work ---
push_work() {
    cd "$PROJECT_DIR"
    if [ -n "$(git status --porcelain)" ]; then
        log "Pushing uncommitted changes..."
        git add -A
        git commit -m "Auto-commit: VPS session #$SESSION_COUNT work in progress" || true
        git push || true
        log "Push complete."
    else
        log "No uncommitted changes to push."
    fi
}

# --- Helper: check if done ---
is_complete() {
    [ -f "$OVERNIGHT_LOG" ] && grep -q "ALL TASKS COMPLETE" "$OVERNIGHT_LOG"
}

# --- Main loop ---
log "=========================================="
log "Claude Runner started"
log "Project: $PROJECT_DIR"
log "Session length: ${SESSION_TIMEOUT}s (30 min)"
log "=========================================="

while true; do
    # Pull latest changes (in case we pushed from local machine)
    cd "$PROJECT_DIR"
    git pull --rebase 2>/dev/null || true

    # Check if all tasks are complete
    if is_complete; then
        log "ALL TASKS COMPLETE found. Stopping runner."
        break
    fi

    # Start a new session
    SESSION_COUNT=$((SESSION_COUNT + 1))
    log "--- Session #$SESSION_COUNT starting (30 min timeout) ---"

    # Run Claude with a 30-minute timeout
    # Exit code 124 = timed out (normal, we restart it)
    # Exit code 0   = Claude finished naturally (task done or chose to exit)
    # Other codes   = error or rate limit
    cd "$PROJECT_DIR"
    timeout "$SESSION_TIMEOUT" claude --dangerously-skip-permissions -p "$CLAUDE_PROMPT" 2>&1 | tee -a "$LOG_FILE"
    EXIT_CODE=${PIPESTATUS[0]}

    log "Claude exited with code $EXIT_CODE"

    # Always push work after each session
    push_work

    # Check if done after pushing
    if is_complete; then
        log "ALL TASKS COMPLETE found. Stopping runner."
        break
    fi

    # Decide what to do based on exit code
    if [ "$EXIT_CODE" -eq 124 ]; then
        # Timeout — session hit 30 min limit. This is normal.
        # Immediately start a new session.
        log "Session timed out (30 min). Starting fresh session immediately."
        RATE_LIMIT_COUNT=0  # Reset rate limit counter since Claude was working fine

    elif [ "$EXIT_CODE" -eq 0 ]; then
        # Claude exited cleanly — it finished its task or decided to stop.
        # Start a new session immediately to keep it going.
        log "Claude exited cleanly. Starting next session immediately."
        RATE_LIMIT_COUNT=0

    else
        # Non-zero, non-timeout exit = likely rate limited or error.
        RATE_LIMIT_COUNT=$((RATE_LIMIT_COUNT + 1))

        if [ "$RATE_LIMIT_COUNT" -eq 1 ]; then
            SLEEP_SECONDS=10800
            log "Possible rate limit (exit $EXIT_CODE). Sleeping 3 hours..."
        else
            SLEEP_SECONDS=19800
            log "Rate limit hit again (#$RATE_LIMIT_COUNT, exit $EXIT_CODE). Sleeping 5h 30m..."
        fi

        sleep "$SLEEP_SECONDS"
        log "Waking up after rate limit sleep."
    fi
done

log "=========================================="
log "Claude Runner finished after $SESSION_COUNT sessions"
log "=========================================="

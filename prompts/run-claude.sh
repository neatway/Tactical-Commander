#!/bin/bash
# ============================================================================
# run-claude.sh — Auto-resume runner for Claude Code on VPS
#
# Schedule: Runs Claude at 10:10 AM EST, then every 5h15m after that.
# Each session: Claude works until it exits (rate limit or done).
# Between sessions: pushes work, notifies Discord, sleeps until next slot.
#
# Usage:
#   tmux new-session -d -s claude-worker 'bash ~/run-claude.sh'
#
# To watch:   tmux attach -t claude-worker   (Ctrl+B, D to detach)
# To stop:    tmux kill-session -t claude-worker
# ============================================================================

# --- Configuration ---
PROJECT_DIR="$HOME/1v1-strat-game"
LOG_FILE="$HOME/claude-runner.log"
OVERNIGHT_LOG="$PROJECT_DIR/OVERNIGHT-LOG.md"
SESSION_COUNT=0

# Schedule: anchored to 10:10 AM EST (15:10 UTC), every 5h15m
ANCHOR_HOUR=15    # 10:10 AM EST = 15:10 UTC
ANCHOR_MIN=10
INTERVAL=18900    # 5h15m in seconds

# Discord webhook for notifications
DISCORD_WEBHOOK="https://discord.com/api/webhooks/1473659172997435568/NCctFOlK4PDUexAmtWwVkd1ACJ1bD4ortjhHfZn-TxjPYccjfJVahkjZFfOsAc0D4D-c"

# --- The prompt Claude receives each session ---
CLAUDE_PROMPT="You are an autonomous builder working on the Tactical Commander project.

READ THESE FILES FIRST (in this order):
1. OVERNIGHT-LOG.md — what the last session did and what's next
2. PROGRESS.md — full project status with checklists
3. CLAUDE.md — project rules and structure
4. tactical-commander/plan.md — complete game design document

PICK UP exactly where the last session left off and DO THE NEXT TASKS.

CRITICAL BEHAVIOR:
- DO NOT STOP after completing one task. Immediately move to the next task.
- DO NOT STOP after completing a phase or milestone. Keep going to the next one.
- Keep working through the entire task list until you hit your usage limit.
- You are a marathon runner, not a sprinter. Do not exit voluntarily.
- The ONLY reason to exit is if EVERY task in PROGRESS.md milestone 1 is done.

AFTER EVERY COMPLETED TASK (not at the end, AFTER EACH ONE):
- Git commit and push your changes immediately.
- Update OVERNIGHT-LOG.md with what you just finished and what you're doing next.
- Update PROGRESS.md checkboxes and percentages.
- Then immediately start the next task. Do not stop.

CODE QUALITY:
- Comment everything properly. Make code easy to read. This is the #1 rule.
- Follow existing patterns in the codebase.

WHEN ALL MILESTONE 1 TASKS ARE TRULY COMPLETE:
- Write 'ALL TASKS COMPLETE' at the bottom of OVERNIGHT-LOG.md
- Git commit and push
- Then you may exit."

# --- Helper: log with timestamp ---
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# --- Helper: send Discord notification ---
discord() {
    local message="$1"
    # Truncate to 1900 chars (Discord limit is 2000, leave room for formatting)
    if [ ${#message} -gt 1900 ]; then
        message="${message:0:1900}..."
    fi
    curl -s -X POST "$DISCORD_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"$message\"}" > /dev/null 2>&1
}

# --- Helper: send Discord embed (nicer formatting) ---
discord_embed() {
    local title="$1"
    local description="$2"
    local color="$3"  # decimal color value
    # Escape quotes and newlines for JSON
    description=$(echo "$description" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    if [ ${#description} -gt 1900 ]; then
        description="${description:0:1900}..."
    fi
    curl -s -X POST "$DISCORD_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "{\"embeds\": [{\"title\": \"$title\", \"description\": \"$description\", \"color\": $color}]}" > /dev/null 2>&1
}

# --- Helper: push any uncommitted work ---
push_work() {
    cd "$PROJECT_DIR"
    if [ -n "$(git status --porcelain)" ]; then
        log "Pushing uncommitted changes..."
        git add -A
        git commit -m "Auto-commit: VPS session #$SESSION_COUNT (safety push)" || true
        git push || true
        log "Push complete."

        # Notify Discord about the push
        local changes
        changes=$(git diff --stat HEAD~1 2>/dev/null | tail -5)
        discord_embed "Git Push (safety)" "Session #$SESSION_COUNT auto-push\n\`\`\`\n$changes\n\`\`\`" "16776960"
    else
        log "No uncommitted changes to push."
    fi
}

# --- Helper: check if done ---
is_complete() {
    [ -f "$OVERNIGHT_LOG" ] && grep -q "ALL TASKS COMPLETE" "$OVERNIGHT_LOG"
}

# --- Helper: calculate seconds until next scheduled slot ---
seconds_until_next_slot() {
    local now
    now=$(date +%s)

    # Calculate today's anchor in UTC (10:10 AM EST = 15:10 UTC)
    local today_anchor
    today_anchor=$(date -d "today ${ANCHOR_HOUR}:${ANCHOR_MIN}:00 UTC" +%s 2>/dev/null)

    # How many seconds since the anchor?
    local since_anchor=$(( (now - today_anchor) % 86400 ))
    if [ "$since_anchor" -lt 0 ]; then
        since_anchor=$((since_anchor + 86400))
    fi

    # How far into the current interval are we?
    local into_interval=$((since_anchor % INTERVAL))

    # Time until next slot
    local wait=$((INTERVAL - into_interval))

    echo "$wait"
}

# --- Helper: format seconds as human readable ---
format_time() {
    local secs=$1
    local hours=$((secs / 3600))
    local mins=$(( (secs % 3600) / 60 ))
    echo "${hours}h ${mins}m"
}

# --- Helper: watch for git commits during Claude session and notify Discord ---
watch_commits() {
    local last_commit
    last_commit=$(cd "$PROJECT_DIR" && git rev-parse HEAD 2>/dev/null)

    while true; do
        sleep 60  # Check every minute
        local current_commit
        current_commit=$(cd "$PROJECT_DIR" && git rev-parse HEAD 2>/dev/null)

        if [ "$current_commit" != "$last_commit" ]; then
            # New commit detected
            local msg
            msg=$(cd "$PROJECT_DIR" && git log --oneline -1)
            local diff_stat
            diff_stat=$(cd "$PROJECT_DIR" && git diff --stat HEAD~1 2>/dev/null | tail -3)
            discord_embed "New Commit" "\`$msg\`\n\`\`\`\n$diff_stat\n\`\`\`" "5025616"
            last_commit="$current_commit"
        fi
    done
}

# --- Helper: send Claude's latest output to Discord every 2 minutes ---
heartbeat() {
    local beat_count=0
    local last_line_count=0

    while true; do
        sleep 120  # 2 minutes
        beat_count=$((beat_count + 1))
        local mins=$((beat_count * 2))

        # Get total lines in log now vs last check — grab only the NEW lines
        local current_line_count
        current_line_count=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)

        local recent_output=""
        if [ "$current_line_count" -gt "$last_line_count" ]; then
            # Grab the new lines since last heartbeat, take last 15
            recent_output=$(tail -n +"$((last_line_count + 1))" "$LOG_FILE" 2>/dev/null | tail -15)
        else
            recent_output=$(tail -10 "$LOG_FILE" 2>/dev/null)
        fi
        last_line_count=$current_line_count

        # Truncate long lines so Discord doesn't choke
        recent_output=$(echo "$recent_output" | cut -c1-120)

        local desc="**Session #$SESSION_COUNT** | ${mins}min in\n\n"
        desc+="**Claude's latest output:**\n\`\`\`\n$recent_output\n\`\`\`"

        discord_embed "Activity (${mins}m)" "$desc" "8421504"
    done
}

# --- Main loop ---
log "=========================================="
log "Claude Runner started"
log "Project: $PROJECT_DIR"
log "Schedule: 10:10 AM EST, then every 5h15m"
log "=========================================="

discord_embed "Runner Started" "Tactical Commander VPS builder is online.\nSchedule: 10:10 AM EST, every 5h15m\nProject: $PROJECT_DIR" "3066993"

while true; do
    # Pull latest changes (in case we pushed from local machine)
    cd "$PROJECT_DIR"
    git pull --rebase 2>/dev/null || true

    # Check if all tasks are complete
    if is_complete; then
        log "ALL TASKS COMPLETE found. Stopping runner."
        discord_embed "ALL TASKS COMPLETE" "The Tactical Commander VPS builder has finished all milestone 1 tasks!" "65280"
        break
    fi

    # Start a new session
    SESSION_COUNT=$((SESSION_COUNT + 1))
    log "--- Session #$SESSION_COUNT starting ---"
    discord_embed "Session #$SESSION_COUNT Started" "Claude is working on Tactical Commander.\nCheck progress: \`cat OVERNIGHT-LOG.md\`" "3447003"

    # Start commit watcher and heartbeat in background
    watch_commits &
    WATCHER_PID=$!
    heartbeat &
    HEARTBEAT_PID=$!

    # Run Claude — let it work until it exits on its own
    cd "$PROJECT_DIR"
    claude --dangerously-skip-permissions -p "$CLAUDE_PROMPT" 2>&1 | tee -a "$LOG_FILE"
    EXIT_CODE=${PIPESTATUS[0]}

    # Stop background watchers
    kill "$WATCHER_PID" 2>/dev/null
    kill "$HEARTBEAT_PID" 2>/dev/null
    wait "$WATCHER_PID" 2>/dev/null
    wait "$HEARTBEAT_PID" 2>/dev/null

    log "Claude exited with code $EXIT_CODE"

    # Always push work after each session (safety net)
    push_work

    # Send session end summary to Discord
    local session_summary=""
    if [ -f "$OVERNIGHT_LOG" ]; then
        # Get the last 20 lines of OVERNIGHT-LOG.md as the summary
        session_summary=$(tail -20 "$OVERNIGHT_LOG")
    fi
    discord_embed "Session #$SESSION_COUNT Ended" "Exit code: $EXIT_CODE\n\n**Latest from OVERNIGHT-LOG.md:**\n$session_summary" "15105570"

    # Check if done
    if is_complete; then
        log "ALL TASKS COMPLETE found. Stopping runner."
        discord_embed "ALL TASKS COMPLETE" "The Tactical Commander VPS builder has finished all milestone 1 tasks!" "65280"
        break
    fi

    # Calculate sleep time until next scheduled slot
    SLEEP_SECONDS=$(seconds_until_next_slot)
    WAKE_TIME=$(date -d "+${SLEEP_SECONDS} seconds" '+%I:%M %p EST' 2>/dev/null || date -d "@$(($(date +%s) + SLEEP_SECONDS))" '+%H:%M UTC')

    log "Sleeping $(format_time $SLEEP_SECONDS) until next slot ($WAKE_TIME)..."
    discord_embed "Sleeping" "Next session in **$(format_time $SLEEP_SECONDS)**\nWake time: **$WAKE_TIME**" "9807270"

    sleep "$SLEEP_SECONDS"
    log "Waking up, starting next session..."
done

log "=========================================="
log "Claude Runner finished after $SESSION_COUNT sessions"
log "=========================================="

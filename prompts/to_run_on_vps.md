I need you to set up my VPS so that you (Claude Code) can run autonomously on it, continuing to build this project even when I'm asleep and your usage limit resets.

## What I need you to do:

### 1. SSH into my VPS
- Ask me for the VPS IP, username, and SSH credentials (password or key path)
- SSH in and verify the connection works

### 2. Install everything needed on the VPS
- Update the system (apt update/upgrade)
- Install Node.js 20+ (via nodesource)
- Install npm, git, tmux
- Install Claude Code globally (`npm install -g @anthropic-ai/claude-code`)
- Authenticate Claude Code on the VPS (walk me through this if needed)

### 3. Clone/push the project to the VPS
- If the project has a GitHub remote, clone it on the VPS
- If not, help me set up a GitHub repo, push the current project, then clone it on the VPS
- Make sure git credentials are configured on the VPS so pushes work without prompts

### 4. Create the auto-resume runner script on the VPS
Create a bash script at `~/run-claude.sh` on the VPS that:
- `cd`s into the project directory
- Runs `claude --dangerously-skip-permissions -p "Continue building the project. Read OVERNIGHT-LOG.md and the plan to see where you left off. Pick up from where the last session stopped. Follow the project plan. Git commit and push after every meaningful chunk of work. Append what you did to OVERNIGHT-LOG.md. If all tasks are done, write ALL TASKS COMPLETE to OVERNIGHT-LOG.md and exit."`
- After Claude exits (rate limit or completion), pushes any uncommitted work
- Checks if OVERNIGHT-LOG.md contains "ALL TASKS COMPLETE" — if so, stops
- On the FIRST retry, sleeps for 3 hours (10800 seconds)
- On every retry AFTER that, sleeps for 5 hours 30 minutes (19800 seconds)
- Track which retry it's on with a counter variable
- Logs everything to `~/claude-runner.log` with timestamps

### 5. Create a systemd service OR cron job (your choice, pick whichever is more reliable) that:
- Starts the runner script automatically if the VPS reboots
- Runs inside a tmux session so I can attach to it from my phone

### 6. Copy the project plan
- Copy the current project's plan/docs (plan.md or whatever planning files exist) into the repo on the VPS so Claude has full context when it starts
- Create an OVERNIGHT-LOG.md in the project root if it doesn't exist

### 7. Start it
- Start the runner in a tmux session called `claude-worker`
- Verify it's running
- Show me how to check on it from my phone (the SSH commands to run)

## Important notes:
- The prompt you give Claude on the VPS should tell it to ALWAYS read OVERNIGHT-LOG.md first to understand where the last session left off, then continue from there
- Every session should git commit + push progress so I can pull it locally
- The project I want built is the one in this current directory — Tactical Commander (the Three.js strategy game). Use the existing plan.md as the source of truth for what to build.
- Ask me for any credentials or info you need upfront before starting — don't get halfway through and then ask me things

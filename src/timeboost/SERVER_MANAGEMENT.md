# Timeboost Server Management

The Timeboost server now includes a process management system that stores the server's PID (Process ID) for easy management.

## Features

- **PID File Management**: Automatically stores the server process ID in `.timeboost-server.pid`
- **Graceful Shutdown**: Handles SIGTERM signals for clean shutdown
- **Process Detection**: Checks if server is actually running before taking actions
- **Automatic Cleanup**: Removes stale PID files

## Usage

### Start the Server
```bash
yarn timeboost
```
- Starts the server in the background
- Saves PID to `.timeboost-server.pid`
- Prevents duplicate instances

### Stop the Server
```bash
yarn timeboost --stop
# or
yarn timeboost -s
```
- Sends SIGTERM for graceful shutdown
- Waits up to 5 seconds for clean stop
- Force kills if necessary
- Removes PID file

### Restart the Server
```bash
yarn timeboost --restart
# or
yarn timeboost -r
```
- Stops the existing server
- Waits 1 second
- Starts a new instance

### Check Server Status
```bash
yarn timeboost --status
```
- Shows if server is running
- Displays PID if active
- Cleans up stale PID files

### Show Help
```bash
yarn timeboost --help
# or
yarn timeboost -h
```

## Implementation Details

### PID File Location
- Path: `.timeboost-server.pid` (in project root)
- Git ignored to prevent commits
- Contains only the process ID number

### Graceful Shutdown
When the server receives SIGTERM:
1. Stops accepting new HTTP connections
2. Stops the indexing orchestrator
3. Clears cache update intervals
4. Waits up to 5 seconds for cleanup
5. Force exits if needed

### Process Management
The server manager (`serverManager.ts`):
- Uses `process.kill(pid, 0)` to check if process exists
- Spawns server as detached process
- Handles stdout/stderr for logging
- Cleans up on unexpected exits

## Development Mode

For development with auto-reload:
```bash
yarn timeboost:dev
```
This uses nodemon and doesn't use the PID management system.

## Troubleshooting

### Server Won't Start
- Check if another instance is running: `yarn timeboost --status`
- Check if port 3001 is in use: `lsof -i :3001`
- Remove stale PID file: `rm .timeboost-server.pid`

### Server Won't Stop
- Try force kill: `kill -9 $(cat .timeboost-server.pid)`
- Remove PID file: `rm .timeboost-server.pid`

### Port Already in Use
- Stop existing server: `yarn timeboost --stop`
- Or use different port: `PORT=3002 yarn timeboost`
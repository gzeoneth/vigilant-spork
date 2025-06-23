#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { logger } from './core/Logger'

const PID_FILE = path.join(__dirname, '../../.timeboost-server.pid')
const SERVER_SCRIPT = path.join(__dirname, 'server.ts')

interface ServerOptions {
  restart?: boolean
  stop?: boolean
  status?: boolean
}

class ServerManager {
  private getPid(): number | null {
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
        if (!isNaN(pid)) {
          return pid
        }
      }
    } catch (error) {
      logger.error('ServerManager', 'Error reading PID file', error)
    }
    return null
  }

  private savePid(pid: number): void {
    try {
      fs.writeFileSync(PID_FILE, pid.toString())
      logger.info('ServerManager', `PID ${pid} saved to ${PID_FILE}`)
    } catch (error) {
      logger.error('ServerManager', 'Error saving PID file', error)
    }
  }

  private removePid(): void {
    try {
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE)
        logger.info('ServerManager', 'PID file removed')
      }
    } catch (error) {
      logger.error('ServerManager', 'Error removing PID file', error)
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists
      process.kill(pid, 0)
      return true
    } catch (error) {
      return false
    }
  }

  async stop(): Promise<boolean> {
    const pid = this.getPid()
    if (!pid) {
      logger.info(
        'ServerManager',
        'No PID file found. Server may not be running.'
      )
      return false
    }

    if (!this.isProcessRunning(pid)) {
      logger.info(
        'ServerManager',
        `Process ${pid} is not running. Cleaning up PID file.`
      )
      this.removePid()
      return false
    }

    try {
      logger.info('ServerManager', `Stopping server with PID ${pid}...`)
      process.kill(pid, 'SIGTERM')

      // Wait for graceful shutdown (max 5 seconds)
      let attempts = 0
      while (attempts < 50 && this.isProcessRunning(pid)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }

      if (this.isProcessRunning(pid)) {
        logger.warn(
          'ServerManager',
          'Server did not stop gracefully. Force killing...'
        )
        process.kill(pid, 'SIGKILL')
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      this.removePid()
      logger.info('ServerManager', 'Server stopped successfully')
      return true
    } catch (error) {
      logger.error('ServerManager', 'Error stopping server', error)
      return false
    }
  }

  async start(): Promise<void> {
    const existingPid = this.getPid()
    if (existingPid && this.isProcessRunning(existingPid)) {
      logger.warn(
        'ServerManager',
        `Server is already running with PID ${existingPid}`
      )
      logger.info('ServerManager', 'Use --restart flag to restart the server')
      return
    }

    // Clean up stale PID file
    if (existingPid) {
      this.removePid()
    }

    logger.info('ServerManager', 'Starting Timeboost server...')

    const serverProcess: ChildProcess = spawn('ts-node', [SERVER_SCRIPT], {
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (!serverProcess.pid) {
      logger.error('ServerManager', 'Failed to start server')
      return
    }

    this.savePid(serverProcess.pid)

    // Handle server output
    serverProcess.stdout?.on('data', data => {
      process.stdout.write(data)
    })

    serverProcess.stderr?.on('data', data => {
      process.stderr.write(data)
    })

    serverProcess.on('error', error => {
      logger.error('ServerManager', 'Server process error', error)
      this.removePid()
    })

    serverProcess.on('exit', code => {
      logger.info('ServerManager', `Server process exited with code ${code}`)
      this.removePid()
    })

    // Unref the process so the parent can exit
    serverProcess.unref()

    logger.info('ServerManager', `Server started with PID ${serverProcess.pid}`)
    logger.info('ServerManager', 'Server logs will continue in the background')

    // Wait a bit to ensure server starts successfully
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (!this.isProcessRunning(serverProcess.pid)) {
      logger.error('ServerManager', 'Server failed to start properly')
      this.removePid()
    }
  }

  async restart(): Promise<void> {
    logger.info('ServerManager', 'Restarting server...')
    await this.stop()
    await new Promise(resolve => setTimeout(resolve, 1000))
    await this.start()
  }

  status(): void {
    const pid = this.getPid()
    if (!pid) {
      console.log('Server is not running (no PID file found)')
      return
    }

    if (this.isProcessRunning(pid)) {
      console.log(`Server is running with PID ${pid}`)
    } else {
      console.log(`Server is not running (stale PID file found: ${pid})`)
      this.removePid()
    }
  }
}

// Parse command line arguments
async function main() {
  const args = process.argv.slice(2)
  const options: ServerOptions = {}

  for (const arg of args) {
    switch (arg) {
      case '--restart':
      case '-r':
        options.restart = true
        break
      case '--stop':
      case '-s':
        options.stop = true
        break
      case '--status':
        options.status = true
        break
      case '--help':
      case '-h':
        console.log(`
Timeboost Server Manager

Usage: yarn timeboost [options]

Options:
  --restart, -r    Restart the server
  --stop, -s       Stop the server
  --status         Check server status
  --help, -h       Show this help message

Examples:
  yarn timeboost              Start the server
  yarn timeboost --restart    Restart the server
  yarn timeboost --stop       Stop the server
  yarn timeboost --status     Check if server is running
`)
        process.exit(0)
    }
  }

  const manager = new ServerManager()

  try {
    if (options.status) {
      manager.status()
    } else if (options.stop) {
      await manager.stop()
    } else if (options.restart) {
      await manager.restart()
    } else {
      await manager.start()
    }
  } catch (error) {
    logger.error('ServerManager', 'Unexpected error', error)
    process.exit(1)
  }
}

// Run if called directly
// tslint:disable-next-line:strict-comparisons
if (require.main === module) {
  main().catch(error => {
    logger.error('ServerManager', 'Fatal error', error)
    process.exit(1)
  })
}

export { ServerManager }

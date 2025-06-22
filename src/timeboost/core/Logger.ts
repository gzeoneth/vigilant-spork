export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private static instance: Logger
  private logLevel: LogLevel

  private constructor() {
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO')
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toUpperCase()) {
      case 'ERROR':
        return LogLevel.ERROR
      case 'WARN':
        return LogLevel.WARN
      case 'DEBUG':
        return LogLevel.DEBUG
      case 'INFO':
      default:
        return LogLevel.INFO
    }
  }

  setLogLevel(level: LogLevel | string) {
    if (typeof level === 'string') {
      this.logLevel = this.parseLogLevel(level)
    } else {
      this.logLevel = level
    }
  }

  private formatMessage(
    level: string,
    category: string,
    message: string
  ): string {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level}] [${category}] ${message}`
  }

  error(category: string, message: string, error?: any) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', category, message))
      if (error) {
        console.error(error)
      }
    }
  }

  warn(category: string, message: string) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', category, message))
    }
  }

  info(category: string, message: string) {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', category, message))
    }
  }

  debug(category: string, message: string) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', category, message))
    }
  }
}

export const logger = Logger.getInstance()

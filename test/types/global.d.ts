declare global {
  var mcp__puppeteer__puppeteer_navigate: (params: {
    url: string
    launchOptions?: any
    allowDangerous?: boolean
  }) => Promise<void>

  var mcp__puppeteer__puppeteer_screenshot: (params: {
    name: string
    selector?: string
    encoded?: boolean
    width?: number
    height?: number
  }) => Promise<void>

  var mcp__puppeteer__puppeteer_evaluate: (params: {
    script: string
  }) => Promise<any>

  var mcp__puppeteer__puppeteer_click: (params: {
    selector: string
  }) => Promise<void>
}

export {}

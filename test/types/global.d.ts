declare global {
  interface Window {
    mcp__puppeteer__puppeteer_navigate: (params: {
      url: string
      launchOptions?: any
      allowDangerous?: boolean
    }) => Promise<void>

    mcp__puppeteer__puppeteer_screenshot: (params: {
      name: string
      selector?: string
      encoded?: boolean
      width?: number
      height?: number
    }) => Promise<void>

    mcp__puppeteer__puppeteer_evaluate: (params: {
      script: string
    }) => Promise<any>

    mcp__puppeteer__puppeteer_click: (params: {
      selector: string
    }) => Promise<void>
  }

  namespace globalThis {
    let mcp__puppeteer__puppeteer_navigate: (params: {
      url: string
      launchOptions?: any
      allowDangerous?: boolean
    }) => Promise<void>

    let mcp__puppeteer__puppeteer_screenshot: (params: {
      name: string
      selector?: string
      encoded?: boolean
      width?: number
      height?: number
    }) => Promise<void>

    let mcp__puppeteer__puppeteer_evaluate: (params: {
      script: string
    }) => Promise<any>

    let mcp__puppeteer__puppeteer_click: (params: {
      selector: string
    }) => Promise<void>
  }
}

export {}

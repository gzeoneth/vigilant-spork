import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config()

// Start the API server
import('./api/server')

console.log('Starting Timeboost Dashboard...')
console.log('API Server will be available at http://localhost:3001')
console.log('Frontend will be served from src/ui/index.html')

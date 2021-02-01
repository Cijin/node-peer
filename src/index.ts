import * as http from 'http'
// npm packages
import * as log4js from 'log4js'
import * as yargs from 'yargs'

import * as pipe from './pipe'

// parser options
const parser = yargs.option('http-port', {
  describe: 'Http Server Port',
  default: 8080
})

// parse port arg
const args = parser.parse(process.argv)
const httpPort: number = args['http-port']

// create logger
const logger = log4js.getLogger()
logger.level = 'info'

const pipeServer = new pipe.Server({ logger })

http.createServer(pipeServer.generateHandler(false)).listen(httpPort, () => {
  logger.info(`Http Server listening on Port: ${httpPort}`)
})

// catch uncaught exceptions and log them
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception: ', err)
})

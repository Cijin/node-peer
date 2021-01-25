import * as http from 'http'
// npm packages
import * as log4js from 'log4js'
import * as yargs from 'yargs'

// import pipingServer module here

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

// create a pipingServer and pass it to http server

http.createServer().listen(httpPort, () => {
  logger.info(`Http Server listening on Port: ${httpPort}`)
})

// catch uncaught exceptions and log them
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception: ', err)
})

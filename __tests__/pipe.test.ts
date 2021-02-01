//import * as fs from 'fs'
import getPort from 'get-port'
import * as http from 'http'
import * as log4js from 'log4js'
import thenRequest from 'then-request'
import * as pipe from '../src/pipe'

/**
 * listen on specified port
 * @param server
 * @param port
 */
function listenPromise(server: http.Server, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    server.listen(port, resolve)
  })
}

/**
 * close server
 * @param server
 */
function serverClosePromise(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

// Sleep
//function sleep(ms: number): Promise<any> {
//  return new Promise((resolve) => setTimeout(resolve, ms))
//}

// logger
const logger = log4js.getLogger()

describe('pipe.Server', () => {
  let port: number
  let pipeServer: http.Server
  let pipeURL: string

  beforeEach(async () => {
    // get port
    port = await getPort()
    // define url
    pipeURL = `http://localhost:${port}`
    // create server
    pipeServer = http.createServer(
      new pipe.Server({ logger }).generateHandler(false)
    )
    await listenPromise(pipeServer, port)
  })

  afterEach(async () => {
    await serverClosePromise(pipeServer)
  })

  describe('In reserved path', () => {
    test('should return index page', async () => {
      // get response
      const res1 = await thenRequest('GET', `${pipeURL}`)
      const res2 = await thenRequest('GET', `${pipeURL}/`)

      // body should be the index page
      expect(res1.getBody('UTF-8').includes('Node Peer')).toStrictEqual(true)
      expect(res2.getBody('UTF-8').includes('Node Peer')).toStrictEqual(true)

      // content-length must be present
      expect(res1.headers['content-length']).toStrictEqual(
        Buffer.byteLength(res1.getBody('UTF-8')).toString()
      )
      expect(res2.headers['content-length']).toStrictEqual(
        Buffer.byteLength(res2.getBody('UTF-8')).toString()
      )

      // should have content-type
      expect(res1.headers['content-type']).toStrictEqual('text/html')
      expect(res2.headers['content-type']).toStrictEqual('text/html')
    })
  })
})

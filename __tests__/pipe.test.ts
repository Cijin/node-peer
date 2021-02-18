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

  test('should handle a connection (reciever: 0, sender: 0)', async () => {
    const reqPromise = thenRequest('GET', `${pipeURL}/mydataid`)

    await thenRequest('POST', `${pipeURL}/mydataid`, {
      body: 'this is test content'
    })

    const data = await reqPromise

    expect(data.getBody('UTF-8')).toStrictEqual('this is test content')
    expect(data.headers['content-length']).toStrictEqual(
      'this is test content'.length.toString()
    )
    expect(data.headers['content-type']).toStrictEqual(undefined)
  })

  test('should pass senders Content-Type to reciever', async () => {
    const reqPromise = thenRequest('GET', `${pipeURL}/mydataid`)

    await thenRequest('POST', `${pipeURL}/mydataid`, {
      headers: {
        'content-type': 'text/plain'
      },
      body: 'this is content'
    })

    const data = await reqPromise

    expect(data.headers['content-type']).toStrictEqual('text/plain')
  })

  test('should replace Content-Type from text/html to text/plain', async () => {
    const reqPromise = thenRequest('GET', `${pipeURL}/mydataid`)

    await thenRequest('POST', `${pipeURL}/mydataid`, {
      headers: {
        'content-type': 'text/html'
      },
      body: '<h1>this is content</h1>'
    })

    const data = await reqPromise

    expect(data.headers['content-type']).toStrictEqual('text/plain')
  })

  test('should replace Content-Type from text/html; charset=utf8 to text/plain; charset=utf8', async () => {
    const reqPromise = thenRequest('GET', `${pipeURL}/mydataid`)

    await thenRequest('POST', `${pipeURL}/mydataid`, {
      headers: {
        'content-type': 'text/html; charset=utf8'
      },
      body: '<h1>this is content</h1>'
    })

    const data = await reqPromise

    expect(data.headers['content-type']).toStrictEqual(
      'text/plain; charset=utf8'
    )
  })

  test('should send senders Content-Disposition to reciever', async () => {
    const reqPromise = thenRequest('GET', `${pipeURL}/mydataid`)

    await thenRequest('POST', `${pipeURL}/mydataid`, {
      headers: {
        'content-disposition': 'attachment; filename="myfile.txt"'
      },
      body: 'this is content'
    })

    const data = await reqPromise

    expect(data.headers['content-disposition']).toStrictEqual(
      'attachment; filename="myfile.txt"'
    )
  })

  test('should be sent chunked data', async () => {
    const sendReq = http.request({
      host: 'localhost',
      port,
      method: 'POST',
      path: '/mydataid'
    })

    sendReq.write('this is some')
    sendReq.end(' content')

    const data = await thenRequest('GET', `${pipeURL}/mydataid`)

    expect(data.getBody('UTF-8')).toStrictEqual('this is some content')
  })

  test('sending data should work with PUT requests', async () => {
    thenRequest('PUT', `${pipeURL}/mydataid`, {
      body: 'some content here'
    })

    const data = await thenRequest('GET', `${pipeURL}/mydataid`)

    expect(data.getBody('UTF-8')).toStrictEqual('some content here')
    expect(data.headers['content-length']).toStrictEqual(
      'some content here'.length.toString()
    )
  })

  test('should handle multiple recievers', async () => {
    const dataPromise1 = thenRequest('GET', `${pipeURL}/mydataid?n=3`)
    const dataPromise2 = thenRequest('GET', `${pipeURL}/mydataid?n=3`)
    const dataPromise3 = thenRequest('GET', `${pipeURL}/mydataid?n=3`)

    thenRequest('POST', `${pipeURL}/mydataid?n=3`, {
      body: 'this is content for all 3'
    })

    const [data1, data2, data3] = await Promise.all([
      dataPromise1,
      dataPromise2,
      dataPromise3
    ])

    expect(data1.getBody('UTF-8')).toStrictEqual('this is content for all 3')
    expect(data1.headers['content-length']).toStrictEqual(
      'this is content for all 3'.length.toString()
    )
    expect(data2.getBody('UTF-8')).toStrictEqual('this is content for all 3')
    expect(data2.headers['content-length']).toStrictEqual(
      'this is content for all 3'.length.toString()
    )
    expect(data3.getBody('UTF-8')).toStrictEqual('this is content for all 3')
    expect(data3.headers['content-length']).toStrictEqual(
      'this is content for all 3'.length.toString()
    )
  })
})

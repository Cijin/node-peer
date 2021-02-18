import * as http from 'http'
import * as log4js from 'log4js'
import * as multiparty from 'multiparty'
import * as stream from 'stream'

import { indexPage } from './pages'

type HttpReq = http.IncomingMessage
type HttpRes = http.ServerResponse

type Handler = (req: HttpReq, res: HttpRes) => void

interface Pipe {
  readonly sender: ReqRes
  readonly recievers: ReadonlyArray<ReqRes>
}

interface ReqRes {
  readonly req: HttpReq
  readonly res: HttpRes
}

interface ReqResAndUnsubscribe {
  readonly reqRes: ReqRes
  readonly unsubscribeCloseListener: () => void
}

interface UnestablishedPipe {
  sender?: ReqResAndUnsubscribe
  readonly recievers: ReqResAndUnsubscribe[]
  readonly totalRecievers: number
}

/**
 * Establish unestablishedPipe
 * @param p: UnestablishedPipe
 * @returns Pipe | undefined
 */
function getPipeIfEstablished(p: UnestablishedPipe): Pipe | undefined {
  if (p.sender !== undefined && p.recievers.length === p.totalRecievers) {
    return {
      sender: p.sender.reqRes,
      recievers: p.recievers.map((r) => {
        // @TODO: check for side effects
        r.unsubscribeCloseListener()
        return r.reqRes
      })
    }
  }
  return undefined
}

const RESERVED_PATHS = {
  index: '/',
  help: '/help'
}

export class Server {
  /** Get total recievers
   * @param {URL} reqUrl
   * @returns {number}
   */
  private static getTotalRecievers(reqUrl: URL) {
    return parseInt(reqUrl.searchParams.get('n') ?? '1', 10)
  }
  private readonly pathToEstablished: Set<string> = new Set()
  private readonly pathToUnestablishedPipe: Map<
    string,
    UnestablishedPipe
  > = new Map()

  /**
   * @param params
   */
  constructor(
    readonly params: {
      readonly logger?: log4js.Logger
    } = {}
  ) {}

  public generateHandler(useHttps: boolean): Handler {
    return (req: HttpReq, res: HttpRes) => {
      // pass base as req.url is not absolute
      const reqUrl = new URL(req.url ?? '', 'temp:///')
      const reqPath = reqUrl.pathname

      this.params.logger?.info(`${req.method} ${req.url}`)

      switch (req.method) {
        case 'GET':
          switch (reqPath) {
            case RESERVED_PATHS.index:
              res.writeHead(200, {
                'Content-Length': Buffer.byteLength(indexPage),
                'Content-Type': 'text/html'
              })
              res.end(indexPage)
              break

            default:
              // handle a reciever
              this.handleReciever(req, res, reqUrl)
              break
          }
          break

        case 'POST':
        case 'PUT':
          if (RESERVED_PATHS.hasOwnProperty(reqPath)) {
            res.writeHead(400, {
              'Access-Control-Allow-Origin': '*'
            })
            return res.end(
              `[ERROR]: Cannot send request to reserverd path ${reqPath}. ex: '/mypath123'\n`
            )
          }
          this.handleSender(req, res, reqUrl)
          break

        default:
          res.end(`[ERROR] Unsupported method: ${req.method}.\n`)
          break
      }
    }
  }

  /*
   * handles sending data
   *
   * @param path
   * @param pipe
   */
  private async runPipe(path: string, pipe: Pipe): Promise<void> {
    // add to established
    this.pathToEstablished.add(path)
    // remove from unestablishedPipe
    this.pathToUnestablishedPipe.delete(path)

    const { sender, recievers } = pipe

    // Emit message to sender
    sender.res.write(
      `[INFO]: Starting data transfer to ${recievers.length} reciever(s).\n`
    )
    this.params.logger?.info(
      `Sending data: path='${path}', recievers='${recievers.length}'`
    )

    const isMultipart: boolean = (
      sender.req.headers['content-type'] ?? ''
    ).includes('multipart/form-data')

    const part: multiparty.Part | undefined = isMultipart
      ? await new Promise((resolve, reject) => {
          const form = new multiparty.Form()

          form.once('part', (p: multiparty.Part) => {
            resolve(p)
          })

          form.once('error', () => {
            this.params.logger?.info(
              `Sender multipart error on path: '${path}'`
            )
          })

          form.parse(sender.req as any)
        })
      : undefined

    const senderData: stream.Readable = part === undefined ? sender.req : part
    let abortedCount: number = 0
    let endCount: number = 0

    for (const reciever of recievers) {
      // close reciever
      const abortedListener = (): void => {
        abortedCount++
        sender.res.write('[INFO]: Reviever aborted.\n')
        senderData.unpipe(passThrough)

        if (abortedCount === recievers.length) {
          sender.res.end('[INFO]: All recievers have aborted.\n')
          // remove established
          this.removeEstablished(path)
          sender.req.destroy()
        }
      }

      const endListener = (): void => {
        endCount++
        if (endCount === recievers.length) {
          sender.res.end('[INFO]: All recievers recieved data successfully.\n')
          this.removeEstablished(path)
        }
      }

      // Content-Length
      const contentLength: string | number | undefined =
        part === undefined
          ? sender.req.headers['content-length']
          : part.byteCount

      const getContentType = (): string | undefined => {
        const contentType: string | undefined =
          part === undefined
            ? sender.req.headers['content-type']
            : part.headers['content-type']

        if (contentType === undefined) {
          return undefined
        }
        const matched = contentType.match(/^\s*([^;]*)(\s*;?.*)$/)
        // If invalid Content-Type
        if (matched === null) {
          return undefined
        }
        // Extract MIME type and parameters
        const mimeType: string = matched[1]
        const params: string = matched[2]
        /*
         * If it is text/html, it should replace it with text/plain not to render in browser.
         * It is the same as GitHub Raw (https://raw.githubusercontent.com).
         * "text/plain" can be consider a superordinate concept of "text/html"
         */
        return mimeType === 'text/html' ? 'text/plain' + params : contentType
      }

      // Content-Type
      // Get Content-Type from part or HTTP header.
      const contentType = getContentType()

      const contentDisposition: string | undefined =
        part === undefined
          ? sender.req.headers['content-disposition']
          : part.headers['content-disposition']

      // reciever headers
      reciever.res.writeHead(200, {
        ...(contentLength === undefined
          ? {}
          : { 'Content-Length': contentLength }),
        ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
        ...(contentDisposition === undefined
          ? {}
          : { 'Content-Disposition': contentDisposition }),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
        'X-Content-Type-Options': 'nosniff'
      })

      const passThrough = new stream.PassThrough()
      senderData.pipe(passThrough)

      passThrough.pipe(reciever.res)
      reciever.req.on('end', () => {
        this.params.logger?.info(`Reviever (on-end): '${path}'`)
        endListener()
      })
      reciever.req.on('close', () => {
        this.params.logger?.info(`Reviever (on-close): '${path}'`)
      })
      reciever.req.on('aborted', () => {
        this.params.logger?.info(`Reviever (on-aborted): '${path}'`)
        abortedListener()
      })
      reciever.req.on('error', () => {
        this.params.logger?.info(`Reviever (on-error): '${path}'`)
        abortedListener()
      })
    }

    senderData.on('close', () => {
      this.params.logger?.info(`Sender (on-close): '${path}'`)
    })

    senderData.on('aborted', () => {
      for (const reciever of recievers) {
        // close reciever
        if (
          reciever.res.connection !== undefined &&
          reciever.res.connection !== null
        ) {
          reciever.res.connection.destroy()
        }
      }
      this.params.logger?.info(`Sender (on-aborted): '${path}'`)
    })

    senderData.on('end', () => {
      sender.res.write('[INFO]: Data Sent Successfully!\n')
      this.params.logger?.info(`Sender (on-end): '${path}'`)
    })

    senderData.on('error', () => {
      sender.res.end('[ERROR] Failed to send.\n')
      // remove from established
      this.removeEstablished(path)
      this.params.logger?.info(`Sender (on-error): '${path}'`)
    })
  }

  private removeEstablished(path: string): void {
    this.pathToEstablished.delete(path)
    this.params.logger?.info(`Established ${path} removed`)
  }

  private handleSender(req: HttpReq, res: HttpRes, reqUrl: URL): void {
    const reqPath = reqUrl.pathname
    const totalRecievers = Server.getTotalRecievers(reqUrl)

    if (Number.isNaN(totalRecievers)) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(
        `[ERROR] totalRecievers(n) should be greater than 0 instead of ${totalRecievers}.\n`
      )
      return
    }

    // if connection has been established already
    // return a 400 response
    if (this.pathToEstablished.has(reqPath)) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(
        `[ERROR] Connection on ${reqPath} has been established already.\n`
      )
      return
    }

    const unestablishedPipe = this.pathToUnestablishedPipe.get(reqPath)
    // if watiing for recievers
    if (unestablishedPipe === undefined) {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*'
      })
      res.write(`[INFO] Waiting for ${totalRecievers} reciever(s)...\n`)

      // create sender
      const sender = this.createSenderOrReceiver('sender', req, res, reqPath)

      this.pathToUnestablishedPipe.set(reqPath, {
        sender,
        recievers: [],
        totalRecievers
      })
      return
    }
    // if sender connected already
    if (unestablishedPipe.sender !== undefined) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(`[ERROR]: Sender has been connected already on '${reqPath}'.\n`)
      return
    }
    // if the number of receivers are not the same as expected
    if (totalRecievers !== unestablishedPipe.totalRecievers) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(
        `[ERROR]: Expected ${totalRecievers} but found ${unestablishedPipe.totalRecievers}.\n`
      )
      return
    }
    // register sender
    unestablishedPipe.sender = this.createSenderOrReceiver(
      'sender',
      req,
      res,
      reqPath
    )
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*'
    })
    res.write(`[INFO]: Waiting for ${totalRecievers} reciever(s)...\n`)
    res.write(`[INFO]: ${unestablishedPipe.totalRecievers} connected so far.\n`)

    const pipe: Pipe | undefined = getPipeIfEstablished(unestablishedPipe)

    if (pipe !== undefined) {
      this.runPipe(reqPath, pipe)
    }
  }

  /**
   * Handle receiver
   *
   * @param req
   * @param res
   * @param reqURL
   */
  private handleReciever(req: HttpReq, res: HttpRes, reqURL: URL): void {
    const reqPath = reqURL.pathname

    if (req.headers['service-worker'] === 'script') {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(`[ERROR] Service worker registration rejected.\n`)
      return
    }

    const totalRecievers = Server.getTotalRecievers(reqURL)

    if (Number.isNaN(totalRecievers)) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(`[ERROR] Number of recievers should be greater than 0.\n`)
      return
    }

    if (this.pathToEstablished.has(reqPath)) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(
        `[ERROR] Connection to ${reqPath} has been established already.\n`
      )
      return
    }

    // get unestablishedPipe
    const unestablishedPipe = this.pathToUnestablishedPipe.get(reqPath)

    if (unestablishedPipe === undefined) {
      const receiver = this.createSenderOrReceiver(
        'receiver',
        req,
        res,
        reqPath
      )

      this.pathToUnestablishedPipe.set(reqPath, {
        recievers: [receiver],
        totalRecievers
      })
      return
    }

    if (totalRecievers !== unestablishedPipe.totalRecievers) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(
        `[ERROR] Number of recievers should be ${unestablishedPipe.totalRecievers} but there are currently ${totalRecievers}.\n`
      )
      return
    }

    if (unestablishedPipe.recievers.length === totalRecievers) {
      res.writeHead(400, {
        'Access-Control-Allow-Origin': '*'
      })
      res.end(`[ERROR] The number of recievers has reached it's limits`)
      return
    }

    // create receiver
    const receiver = this.createSenderOrReceiver('receiver', req, res, reqPath)
    unestablishedPipe.recievers.push(receiver)

    if (unestablishedPipe.sender !== undefined) {
      // update sender with connection message
      unestablishedPipe.sender.reqRes.res.write(
        '[INFO] A receiver has connected.\n'
      )
    }

    // get pipe if established
    const pipe: Pipe | undefined = getPipeIfEstablished(unestablishedPipe)
    if (pipe !== undefined) {
      this.runPipe(reqPath, pipe)
    }
  }

  /**
   * Create sender or receiver
   *
   * Create a sender/receiver which unregisters an unestablishedPipe before
   * establishing it
   *
   * @param removerType
   * @param req
   * @param res
   * @param reqPath
   */
  private createSenderOrReceiver(
    removerType: 'sender' | 'receiver',
    req: HttpReq,
    res: HttpRes,
    reqPath: string
  ): ReqResAndUnsubscribe {
    // create a receiver req & res
    const receiverReqRes: ReqRes = { req, res }
    // close handler
    const closeListener = () => {
      const unestablishedPipe = this.pathToUnestablishedPipe.get(reqPath)
      // if the pipe is registered
      if (unestablishedPipe !== undefined) {
        const remover =
          removerType === 'sender'
            ? (): boolean => {
                // if sender is defined
                if (unestablishedPipe.sender !== undefined) {
                  // remove sender
                  unestablishedPipe.sender = undefined
                  return true
                }
                return false
              }
            : (): boolean => {
                // get receivers
                const receivers = unestablishedPipe.recievers
                // find receivers index
                const idx = receivers.findIndex(
                  (receiver) => receiver.reqRes === receiverReqRes
                )

                if (idx !== -1) {
                  receivers.splice(idx, 1)
                  return true
                }
                return false
              }

        // remove sender | receiver
        const removed: boolean = remover()
        if (removed) {
          // if unestablishedPipe has no senders | receivers, remove unestablishedPipe
          if (
            unestablishedPipe.recievers.length === 0 &&
            unestablishedPipe.sender === undefined
          ) {
            this.pathToUnestablishedPipe.delete(reqPath)
            this.params.logger?.info(`unestablished path ${reqPath} removed`)
          }
        }
      }
    }

    // disconnect on close
    req.once('close', closeListener)
    const unsubscribeCloseListener = () => {
      req.removeListener('close', closeListener)
    }

    return { reqRes: receiverReqRes, unsubscribeCloseListener }
  }

  public close() {
    this.close()
  }
}

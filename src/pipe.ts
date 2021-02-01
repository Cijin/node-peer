import * as http from 'http'
import * as log4js from 'log4js'
//import * as multiparty from 'multiparty'
//import * as stream from 'stream'

import { indexPage } from './pages'

type HttpReq = http.IncomingMessage
type HttpRes = http.ServerResponse

type Handler = (req: HttpReq, res: HttpRes) => void

const RESERVED_PATHS = {
  index: '/',
  help: '/help'
}

export class Server {
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
              // this.handleReciever(req, res, reqUrl)
              break
          }
          break

        default:
          res.end(`[ERROR] Unsupported method: ${req.method}.\n`)
          break
      }
    }
  }

  public close() {
    this.close()
  }
}

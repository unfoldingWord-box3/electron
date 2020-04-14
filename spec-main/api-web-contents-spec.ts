import * as chai from 'chai'
import { AddressInfo } from 'net'
import * as chaiAsPromised from 'chai-as-promised'
import * as path from 'path'
import * as http from 'http'
import { BrowserWindow, ipcMain, webContents, session } from 'electron'
import { emittedOnce } from './events-helpers';
import { closeAllWindows } from './window-helpers';
import { ifdescribe, ifit } from './spec-helpers';

const { expect } = chai

chai.use(chaiAsPromised)

const fixturesPath = path.resolve(__dirname, '..', 'spec', 'fixtures')
const features = process.electronBinding('features')

describe('webContents module', () => {
  describe('getAllWebContents() API', () => {
    afterEach(closeAllWindows)
    it('returns an array of web contents', async () => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: { webviewTag: true }
      })
      w.loadFile(path.join(fixturesPath, 'pages', 'webview-zoom-factor.html'))

      await emittedOnce(w.webContents, 'did-attach-webview')

      w.webContents.openDevTools()

      await emittedOnce(w.webContents, 'devtools-opened')

      const all = webContents.getAllWebContents().sort((a, b) => {
        return a.id - b.id
      })

      expect(all).to.have.length(3)
      expect(all[0].getType()).to.equal('window')
      expect(all[all.length - 2].getType()).to.equal('webview')
      expect(all[all.length - 1].getType()).to.equal('remote')
    })
  })

  describe('will-prevent-unload event', () => {
    afterEach(closeAllWindows)
    it('does not emit if beforeunload returns undefined', (done) => {
      const w = new BrowserWindow({show: false})
      w.once('closed', () => done())
      w.webContents.once('will-prevent-unload', (e) => {
        expect.fail('should not have fired')
      })
      w.loadFile(path.join(fixturesPath, 'api', 'close-beforeunload-undefined.html'))
    })

    it('emits if beforeunload returns false', (done) => {
      const w = new BrowserWindow({show: false})
      w.webContents.once('will-prevent-unload', () => done())
      w.loadFile(path.join(fixturesPath, 'api', 'close-beforeunload-false.html'))
    })

    it('supports calling preventDefault on will-prevent-unload events', (done) => {
      const w = new BrowserWindow({show: false})
      w.webContents.once('will-prevent-unload', event => event.preventDefault())
      w.once('closed', () => done())
      w.loadFile(path.join(fixturesPath, 'api', 'close-beforeunload-false.html'))
    })
  })

  describe('webContents.send(channel, args...)', () => {
    afterEach(closeAllWindows)
    it('throws an error when the channel is missing', () => {
      const w = new BrowserWindow({show: false})
      expect(() => {
        (w.webContents.send as any)()
      }).to.throw('Missing required channel argument')

      expect(() => {
        w.webContents.send(null as any)
      }).to.throw('Missing required channel argument')
    })

    it('does not block node async APIs when sent before document is ready', (done) => {
      // Please reference https://github.com/electron/electron/issues/19368 if
      // this test fails.
      ipcMain.once('async-node-api-done', () => {
        done()
      })
      const w = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          sandbox: false,
          contextIsolation: false
        }
      })
      w.loadFile(path.join(fixturesPath, 'pages', 'send-after-node.html'))
      setTimeout(() => {
        w.webContents.send("test")
      }, 50)
    })
  })

  ifdescribe(features.isPrintingEnabled())('webContents.print()', () => {
    let w: BrowserWindow

    beforeEach(() => {
      w = new BrowserWindow({ show: false })
    })

    afterEach(closeAllWindows)

    it('throws when invalid settings are passed', () => {
      expect(() => {
        // @ts-ignore this line is intentionally incorrect
        w.webContents.print(true)
      }).to.throw('webContents.print(): Invalid print settings specified.')
    })

    it('throws when an invalid callback is passed', () => {
      expect(() => {
        // @ts-ignore this line is intentionally incorrect
        w.webContents.print({}, true)
      }).to.throw('webContents.print(): Invalid optional callback provided.')
    })

    ifit(process.platform !== 'linux')('throws when an invalid deviceName is passed', () => {
      expect(() => {
        w.webContents.print({ deviceName: 'i-am-a-nonexistent-printer' }, () => {})
      }).to.throw('webContents.print(): Invalid deviceName provided.')
    })

    it('does not crash with custom margins', () => {
      expect(() => {
        w.webContents.print({
          silent: true,
          margins: {
            marginType: 'custom',
            top: 1,
            bottom: 1,
            left: 1,
            right: 1
          }
        })
      }).to.not.throw()
    })
  })

  describe('webContents.executeJavaScript', () => {
    describe('in about:blank', () => {
      const expected = 'hello, world!'
      const expectedErrorMsg = 'woops!'
      const code = `(() => "${expected}")()`
      const asyncCode = `(() => new Promise(r => setTimeout(() => r("${expected}"), 500)))()`
      const badAsyncCode = `(() => new Promise((r, e) => setTimeout(() => e("${expectedErrorMsg}"), 500)))()`
      const errorTypes = new Set([
        Error,
        ReferenceError,
        EvalError,
        RangeError,
        SyntaxError,
        TypeError,
        URIError
      ])
      let w: BrowserWindow

      before(async () => {
        w = new BrowserWindow({show: false})
        await w.loadURL('about:blank')
      })
      after(closeAllWindows)

      it('resolves the returned promise with the result', async () => {
        const result = await w.webContents.executeJavaScript(code)
        expect(result).to.equal(expected)
      })
      it('resolves the returned promise with the result if the code returns an asyncronous promise', async () => {
        const result = await w.webContents.executeJavaScript(asyncCode)
        expect(result).to.equal(expected)
      })
      it('rejects the returned promise if an async error is thrown', async () => {
        await expect(w.webContents.executeJavaScript(badAsyncCode)).to.eventually.be.rejectedWith(expectedErrorMsg)
      })
      it('rejects the returned promise with an error if an Error.prototype is thrown', async () => {
        for (const error of errorTypes) {
          await expect(w.webContents.executeJavaScript(`Promise.reject(new ${error.name}("Wamp-wamp"))`))
            .to.eventually.be.rejectedWith(error)
        }
      })
    })

    describe("on a real page", () => {
      let w: BrowserWindow
      beforeEach(() => {
        w = new BrowserWindow({show: false})
      })
      afterEach(closeAllWindows)

      let server: http.Server = null as unknown as http.Server
      let serverUrl: string = null as unknown as string

      before((done) => {
        server = http.createServer((request, response) => {
          response.end()
        }).listen(0, '127.0.0.1', () => {
          serverUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
          done()
        })
      })

      after(() => {
        server.close()
      })

      it('works after page load and during subframe load', (done) => {
        w.webContents.once('did-finish-load', () => {
          // initiate a sub-frame load, then try and execute script during it
          w.webContents.executeJavaScript(`
            var iframe = document.createElement('iframe')
            iframe.src = '${serverUrl}/slow'
            document.body.appendChild(iframe)
          `).then(() => {
            w.webContents.executeJavaScript('console.log(\'hello\')').then(() => {
              done()
            })
          })
        })
        w.loadURL(serverUrl)
      })

      it('executes after page load', (done) => {
        w.webContents.executeJavaScript(`(() => "test")()`).then(result => {
          expect(result).to.equal("test")
          done()
        })
        w.loadURL(serverUrl)
      })

      it('works with result objects that have DOM class prototypes', (done) => {
        w.webContents.executeJavaScript('document.location').then(result => {
          expect(result.origin).to.equal(serverUrl)
          expect(result.protocol).to.equal('http:')
          done()
        })
        w.loadURL(serverUrl)
      })
    })
  })

  describe('login event', () => {
    afterEach(closeAllWindows)

    let server: http.Server
    let serverUrl: string
    let serverPort: number
    let proxyServer: http.Server
    let proxyServerPort: number

    before((done) => {
      server = http.createServer((request, response) => {
        if (request.url === '/no-auth') {
          return response.end('ok')
        }
        if (request.headers.authorization) {
          response.writeHead(200, { 'Content-type': 'text/plain' })
          return response.end(request.headers.authorization)
        }
        response
          .writeHead(401, { 'WWW-Authenticate': 'Basic realm="Foo"' })
          .end('401')
      }).listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as AddressInfo).port
        serverUrl = `http://127.0.0.1:${serverPort}`
        done()
      })
    })

    before((done) => {
      proxyServer = http.createServer((request, response) => {
        if (request.headers['proxy-authorization']) {
          response.writeHead(200, { 'Content-type': 'text/plain' })
          return response.end(request.headers['proxy-authorization'])
        }
        response
          .writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Foo"' })
          .end()
      }).listen(0, '127.0.0.1', () => {
        proxyServerPort = (proxyServer.address() as AddressInfo).port
        done()
      })
    })

    afterEach(async () => {
      await session.defaultSession.clearAuthCache({ type: 'password' })
    })

    after(() => {
      server.close()
      proxyServer.close()
    })

    it('is emitted when navigating', async () => {
      const [user, pass] = ['user', 'pass']
      const w = new BrowserWindow({ show: false })
      let eventRequest: any
      let eventAuthInfo: any
      w.webContents.on('login', (event, request, authInfo, cb) => {
        eventRequest = request
        eventAuthInfo = authInfo
        event.preventDefault()
        cb(user, pass)
      })
      await w.loadURL(serverUrl)
      const body = await w.webContents.executeJavaScript(`document.documentElement.textContent`)
      expect(body).to.equal(`Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`)
      expect(eventRequest.url).to.equal(serverUrl + '/')
      expect(eventAuthInfo.isProxy).to.be.false('is proxy')
      expect(eventAuthInfo.scheme).to.equal('basic')
      expect(eventAuthInfo.host).to.equal('127.0.0.1')
      expect(eventAuthInfo.port).to.equal(serverPort)
      expect(eventAuthInfo.realm).to.equal('Foo')
    })

    it('is emitted when a proxy requests authorization', async () => {
      const customSession = session.fromPartition(`${Math.random()}`)
      await customSession.setProxy({ proxyRules: `127.0.0.1:${proxyServerPort}`, proxyBypassRules: '<-loopback>' } as any)
      const [user, pass] = ['user', 'pass']
      const w = new BrowserWindow({ show: false, webPreferences: { session: customSession } })
      let eventRequest: any
      let eventAuthInfo: any
      w.webContents.on('login', (event, request, authInfo, cb) => {
        eventRequest = request
        eventAuthInfo = authInfo
        event.preventDefault()
        cb(user, pass)
      })
      await w.loadURL(`${serverUrl}/no-auth`)
      const body = await w.webContents.executeJavaScript(`document.documentElement.textContent`)
      expect(body).to.equal(`Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`)
      expect(eventRequest.url).to.equal(`${serverUrl}/no-auth`)
      expect(eventAuthInfo.isProxy).to.be.true('is proxy')
      expect(eventAuthInfo.scheme).to.equal('basic')
      expect(eventAuthInfo.host).to.equal('127.0.0.1')
      expect(eventAuthInfo.port).to.equal(proxyServerPort)
      expect(eventAuthInfo.realm).to.equal('Foo')
    })

    it('cancels authentication when callback is called with no arguments', async () => {
      const w = new BrowserWindow({ show: false })
      w.webContents.on('login', (event, request, authInfo, cb) => {
        event.preventDefault()
        cb()
      })
      await w.loadURL(serverUrl)
      const body = await w.webContents.executeJavaScript(`document.documentElement.textContent`)
      expect(body).to.equal('401')
    })
  })

  it('emits a cancelable event before creating a child webcontents', async () => {
    const w = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true
      }
    })
    w.webContents.on('-will-add-new-contents' as any, (event: any, url: any) => {
      expect(url).to.equal('about:blank')
      event.preventDefault()
    })
    let wasCalled = false
    w.webContents.on('new-window' as any, () => {
      wasCalled = true
    })
    await w.loadURL('about:blank')
    await w.webContents.executeJavaScript(`window.open('about:blank')`)
    await new Promise((resolve) => { process.nextTick(resolve) })
    expect(wasCalled).to.equal(false)
    await closeAllWindows()
  })
})

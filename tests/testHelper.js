const { Readable } = require('node:stream');

/**
 * Lightweight, socket-free HTTP test client for Express applications.
 * Directly dispatches requests through the Express pipeline using node:stream.Readable,
 * allowing instant, deterministic execution without TCP socket permissions.
 */
function request(app) {
  return {
    get: (url) => new TestRequest(app, 'GET', url),
    post: (url) => new TestRequest(app, 'POST', url),
    put: (url) => new TestRequest(app, 'PUT', url),
    delete: (url) => new TestRequest(app, 'DELETE', url),
    options: (url) => new TestRequest(app, 'OPTIONS', url),
  };
}

class TestRequest {
  constructor(app, method, url) {
    this.app = app;
    this.method = method.toUpperCase();
    this.url = url;
    this.headers = { host: 'localhost:3000' };
    this.bodyData = null;
  }

  set(header, value) {
    if (typeof header === 'object') {
      for (const [k, v] of Object.entries(header)) {
        this.headers[k.toLowerCase()] = v;
      }
    } else {
      this.headers[header.toLowerCase()] = value;
    }
    return this;
  }

  send(data) {
    if (typeof data === 'string') {
      this.bodyData = data;
    } else {
      this.bodyData = JSON.stringify(data);
      if (!this.headers['content-type']) {
        this.headers['content-type'] = 'application/json';
      }
    }
    this.headers['content-length'] = String(Buffer.byteLength(this.bodyData));
    return this;
  }

  async end() {
    return new Promise((resolve, reject) => {
      const chunks = this.bodyData !== null ? [Buffer.from(this.bodyData)] : [];
      const req = Object.assign(Readable.from(chunks), {
        method: this.method,
        url: this.url,
        headers: this.headers,
        rawHeaders: Object.entries(this.headers).flat(),
        socket: {
          remoteAddress: this.headers['x-forwarded-for'] || '127.0.0.1',
          encrypted: false
        },
        connection: {
          remoteAddress: this.headers['x-forwarded-for'] || '127.0.0.1'
        }
      });

      const responseHeaders = {};
      let responseBody = '';

      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        setHeader(name, value) {
          responseHeaders[name.toLowerCase()] = String(value);
        },
        getHeader(name) {
          return responseHeaders[name.toLowerCase()];
        },
        getHeaders() {
          return { ...responseHeaders };
        },
        hasHeader(name) {
          return Boolean(responseHeaders[name.toLowerCase()]);
        },
        removeHeader(name) {
          delete responseHeaders[name.toLowerCase()];
        },
        writeHead(statusCode, headers = {}) {
          this.statusCode = statusCode;
          for (const [k, v] of Object.entries(headers)) {
            this.setHeader(k, v);
          }
          return this;
        },
        write(chunk) {
          if (chunk) {
            responseBody += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
          }
          return true;
        },
        end(chunk) {
          if (chunk) {
            responseBody += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
          }

          let parsedJson = null;
          try {
            parsedJson = JSON.parse(responseBody);
          } catch (_) {}

          resolve({
            status: this.statusCode,
            statusCode: this.statusCode,
            headers: responseHeaders,
            body: parsedJson !== null ? parsedJson : responseBody,
            text: responseBody,
            get: (h) => responseHeaders[h.toLowerCase()]
          });
        }
      };

      try {
        this.app(req, res);
      } catch (err) {
        reject(err);
      }
    });
  }

  then(resolve, reject) {
    return this.end().then(resolve, reject);
  }
}

module.exports = { request };

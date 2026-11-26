'use strict';

/**
 * Runs the real waitlist routes (Express, cookie-parser, controllers,
 * validation) on an in-memory database, behind the real same-origin proxy
 * from api/waitlist/application.js, exactly as the page reaches them:
 *
 *   browser/test client -> site server (proxy + optional static files)
 *                       -> backend (Express) -> fake Prisma
 *
 * Used by the end-to-end contract test and by the browser walkthrough.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createFakePrisma } = require('./fakeWaitlistPrisma');

const SRC = path.resolve(__dirname, '..', '..', '..', '..'); // Backend/
const REPO = path.resolve(SRC, '..');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function startWaitlistHarness({ staticRoot = null, sitePort = 0 } = {}) {
  process.env.NODE_ENV = 'test';
  const fake = createFakePrisma();
  const emails = [];
  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  const stubs = {
    '../configs/database': { prisma: fake.prisma },
    '../configs/redis': { getRedisClient: () => null, isRedisReady: () => false, isRedisConfigured: () => false },
    '../utils/logger': silent,
    '../utils/emailService': {
      async sendWelcomeEmail(to, data) {
        emails.push({ kind: 'welcome', to, data });
        return true;
      },
      async sendWaitlistResumeCode(to, data) {
        emails.push({ kind: 'resume_code', to, data });
        return true;
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  let router;
  try {
    for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(SRC, 'src'))) delete require.cache[key];
    router = require(path.join(SRC, 'src', 'route', 'waitlistRoute.js'));
  } finally {
    Module._load = originalLoad;
  }

  const express = require(path.join(SRC, 'node_modules', 'express'));
  const cookieParser = require(path.join(SRC, 'node_modules', 'cookie-parser'));
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser('test-cookie-secret'));
  app.use('/api/v1/waitlist', router);
  app.use((err, req, res, next) => {
    void next;
    res.status(500).json({ success: false, error: 'An unexpected server error occurred', error_type: err.code || err.name });
  });
  const backend = http.createServer(app);
  const backendPort = await listen(backend);

  // The Vercel function, loaded fresh so it reads this backend's URL.
  process.env.BACKEND_API_URL = `http://127.0.0.1:${backendPort}`;
  const proxyPath = path.join(REPO, 'api', 'waitlist', 'application.js');
  delete require.cache[proxyPath];
  const proxy = require(proxyPath);

  let backendDown = false;
  const site = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://site.local');
    const match = url.pathname.match(/^\/api\/waitlist\/application\/(.+)$/);
    if (match) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      // What vercel.json's rewrite hands the function.
      const vreq = { method: req.method, headers: req.headers, url: `/api/waitlist/application?path=${match[1]}`, query: { path: match[1] }, body };
      const vres = {
        setHeader: (name, value) => res.setHeader(name, value),
        status(code) {
          res.statusCode = code;
          return this;
        },
        json(payload) {
          res.end(JSON.stringify(payload));
          return this;
        },
      };
      if (backendDown) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: false, code: 'UPSTREAM_UNAVAILABLE', error: 'The application service is temporarily unavailable.' }));
      }
      return proxy(vreq, vres);
    }
    if (!staticRoot) {
      res.statusCode = 404;
      return res.end('not found');
    }
    // cleanUrls: /waitlist -> waitlist.html, / -> index.html
    let file = path.join(staticRoot, decodeURIComponent(url.pathname));
    if (url.pathname === '/') file = path.join(staticRoot, 'index.html');
    else if (!path.extname(file)) file = `${file}.html`;
    if (!file.startsWith(staticRoot) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  });
  const port = await new Promise((resolve) => site.listen(sitePort, '0.0.0.0', () => resolve(site.address().port)));

  return {
    fake,
    emails,
    siteUrl: `http://127.0.0.1:${port}`,
    backendUrl: `http://127.0.0.1:${backendPort}`,
    proxy,
    setBackendDown(value) {
      backendDown = value;
    },
    async close() {
      await Promise.all([new Promise((resolve) => site.close(resolve)), new Promise((resolve) => backend.close(resolve))]);
    },
  };
}

/** A browser-like client: keeps the cookies the site sets, nothing else. */
function createClient(baseUrl, { origin = baseUrl } = {}) {
  const jar = new Map();
  const client = {
    jar,
    lastSetCookie: [],
    async call(method, action, body, headers = {}) {
      const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
      const response = await fetch(`${baseUrl}/api/waitlist/application/${action}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET' && origin ? { Origin: origin } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      client.lastSetCookie = response.headers.getSetCookie();
      for (const setCookie of client.lastSetCookie) {
        const [pair, ...attributes] = setCookie.split(';');
        const [name, ...value] = pair.split('=');
        const expired = attributes.some((attribute) => /^\s*expires=thu, 01 jan 1970/i.test(attribute)) || attributes.some((a) => /^\s*max-age=0\b/i.test(a));
        if (expired || !value.join('=')) jar.delete(name.trim());
        else jar.set(name.trim(), value.join('='));
      }
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { status: response.status, body: json };
    },
  };
  return client;
}

module.exports = { startWaitlistHarness, createClient };

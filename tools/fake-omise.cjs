#!/usr/bin/env node
/**
 * Fake Omise (Opn Payments) API for development and CI: the subset this app uses, shaped like
 * the real API so OmisePaymentGateway runs unchanged against it.
 *
 *   POST /charges                       PromptPay charge (source.type = promptpay) -> pending + QR
 *   GET  /charges/:id                   charge object
 *   POST /charges/:id/mark_as_paid      test-mode helper, as in real Omise test mode
 *   POST /charges/:id/mark_as_failed    test-mode helper
 *   GET  /charges/:id/documents/qr.svg  placeholder QR image (not scannable)
 *
 * Auth: HTTP Basic with a test secret key (skey_test_...), like Omise. After mark_as_paid/failed
 * it POSTs a charge.complete event to WEBHOOK_URL, as Omise does.
 *
 * Usage: node tools/fake-omise.cjs            (PORT=4010, WEBHOOK_URL=http://localhost:3000/api/v1/billing/webhooks/omise)
 * Point the API at it with OMISE_API_URL=http://localhost:4010 and OMISE_SECRET_KEY=skey_test_anything.
 */
const http = require('http');
const { randomBytes } = require('crypto');

function createFakeOmise({ webhookUrl = null } = {}) {
  const charges = new Map();
  let baseUrl = '';

  const id = (prefix) => `${prefix}_test_${randomBytes(9).toString('base64url').toLowerCase()}`;
  const error = (res, status, code, message) => send(res, status, { object: 'error', location: 'https://docs.opn.ooo/api-errors', code, message });
  function send(res, status, body, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  }

  async function notify(charge) {
    if (!webhookUrl) return;
    const event = { object: 'event', id: id('evnt'), livemode: false, key: 'charge.complete', created_at: new Date().toISOString(), data: charge };
    try {
      await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    } catch {
      // Like Omise, a failed delivery is not the API caller's problem.
    }
  }

  /** QR-looking placeholder: three finder squares plus modules derived from the charge id. */
  function qrSvg(charge) {
    const cell = (x, y) => `<rect x="${20 + x * 10}" y="${20 + y * 10}" width="10" height="10"/>`;
    const finder = (ox, oy) =>
      `<rect x="${20 + ox * 10}" y="${20 + oy * 10}" width="70" height="70"/>` +
      `<rect x="${30 + ox * 10}" y="${30 + oy * 10}" width="50" height="50" fill="#fff"/>` +
      `<rect x="${40 + ox * 10}" y="${40 + oy * 10}" width="30" height="30"/>`;
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
    const seed = Buffer.from(charge.id);
    const modules = [];
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        if (!inFinder(x, y) && (seed[(x * 21 + y) % seed.length] + x * y) % 3 === 0) modules.push(cell(x, y));
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="280" viewBox="0 0 250 280"><rect width="250" height="280" fill="#fff"/><g fill="#0b2a4a">${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}${modules.join('')}</g><text x="125" y="262" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#555">FAKE PromptPay ${(charge.amount / 100).toFixed(2)} THB</text></svg>`;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'charges' && parts[2] === 'documents') {
      const charge = charges.get(parts[1]);
      return charge ? send(res, 200, qrSvg(charge), 'image/svg+xml') : error(res, 404, 'not_found', 'charge was not found');
    }

    const auth = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    const key = auth.split(':')[0];
    if (!key.startsWith('skey_test_')) return error(res, 401, 'authentication_failure', 'authentication failed');

    let body = {};
    if (req.method === 'POST') {
      const raw = await new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => resolve(data));
      });
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return error(res, 400, 'bad_request', 'invalid JSON');
      }
    }

    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'charges') {
      if (!Number.isInteger(body.amount) || body.amount < 2000) return error(res, 400, 'invalid_amount', 'amount must be at least 2000 (20 THB) for promptpay');
      if (String(body.currency).toLowerCase() !== 'thb') return error(res, 400, 'invalid_charge', 'currency is not supported');
      if (!body.source || body.source.type !== 'promptpay') return error(res, 400, 'invalid_charge', 'this fake only supports source.type promptpay');
      const chargeId = id('chrg');
      const now = new Date();
      const charge = {
        object: 'charge',
        id: chargeId,
        livemode: false,
        location: `/charges/${chargeId}`,
        amount: body.amount,
        currency: 'thb',
        description: body.description ?? null,
        metadata: body.metadata ?? {},
        status: 'pending',
        paid: false,
        failure_code: null,
        failure_message: null,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        source: {
          object: 'source',
          id: id('src'),
          type: 'promptpay',
          flow: 'offline',
          amount: body.amount,
          currency: 'thb',
          scannable_code: {
            object: 'barcode',
            type: 'qr',
            image: { object: 'document', filename: 'qrcode.svg', download_uri: `${baseUrl}/charges/${chargeId}/documents/qr.svg` },
          },
        },
      };
      charges.set(chargeId, charge);
      return send(res, 200, charge);
    }

    const charge = parts[0] === 'charges' && parts[1] ? charges.get(parts[1]) : undefined;
    if (!charge) return error(res, 404, 'not_found', 'charge was not found');

    if (req.method === 'GET' && parts.length === 2) return send(res, 200, charge);

    if (req.method === 'POST' && parts.length === 3 && (parts[2] === 'mark_as_paid' || parts[2] === 'mark_as_failed')) {
      if (charge.status !== 'pending') return error(res, 400, 'failed_capture', `charge is already ${charge.status}`);
      if (parts[2] === 'mark_as_paid') Object.assign(charge, { status: 'successful', paid: true, paid_at: new Date().toISOString() });
      else Object.assign(charge, { status: 'failed', failure_code: 'payment_rejected', failure_message: 'payment was rejected (test)' });
      res.on('finish', () => void notify(charge));
      return send(res, 200, charge);
    }

    return error(res, 404, 'not_found', 'path not found');
  });

  return {
    server,
    charges,
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, () => {
          baseUrl = `http://localhost:${server.address().port}`;
          resolve(baseUrl);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createFakeOmise };

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4010);
  const webhookUrl = process.env.WEBHOOK_URL ?? 'http://localhost:3000/api/v1/billing/webhooks/omise';
  createFakeOmise({ webhookUrl })
    .listen(port)
    .then((url) => console.log(`Fake Omise listening on ${url}; webhooks -> ${webhookUrl}`));
}

/**
 * DEPRECATED — This file is kept only for backward compatibility.
 *
 * The JWT-only `authenticate` middleware that was here prevented session-cookie
 * login from working on /api/v1/* routes (it only accepted Bearer tokens).
 *
 * All route files and server.js now import from `sessionAuth.js`, which
 * accepts both HTTP-only session cookies and Bearer JWT tokens.
 *
 * Once all import sites are confirmed updated, delete this file.
 */

const { authenticate } = require('./sessionAuth');

module.exports = authenticate;

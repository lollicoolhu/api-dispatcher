require('dotenv').config();
const { startBothServers } = require('./lib/server-core');

const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || './certs/server.key';
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || './certs/server.crt';

if (HTTPS_ENABLED) {
  startBothServers(HTTP_PORT, HTTPS_PORT, HTTPS_KEY_PATH, HTTPS_CERT_PATH);
} else {
  const { startHttpServer } = require('./lib/server-core');
  startHttpServer(HTTP_PORT);
}


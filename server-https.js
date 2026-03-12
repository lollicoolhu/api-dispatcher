require('dotenv').config();
const { startHttpsServer } = require('./lib/server-core');

const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || './certs/server.key';
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || './certs/server.crt';

try {
  startHttpsServer(HTTPS_PORT, HTTPS_KEY_PATH, HTTPS_CERT_PATH);
} catch (error) {
  console.error('Error:', error.message);
  console.error('\nPlease generate certificates first:');
  console.error('  mkdir certs');
  console.error('  openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.crt -days 365 -nodes');
  process.exit(1);
}

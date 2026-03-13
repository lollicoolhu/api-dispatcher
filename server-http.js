require('dotenv').config();
const { startHttpServer } = require('./lib/server-core');

const HTTP_PORT = process.env.HTTP_PORT || 3000;

startHttpServer(HTTP_PORT);

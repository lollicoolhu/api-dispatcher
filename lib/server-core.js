const config = require('./config');
const { handleAdminRoutes } = require('./admin-routes');
const { handleRequest } = require('./request-handler');

// 加载配置
config.loadData();

// 创建请求处理函数
function createRequestHandler(httpPort, httpsPort) {
  return (req, res) => {
    // 处理管理路由
    if (handleAdminRoutes(req, res, config, config.saveData, httpPort, httpsPort)) {
      return;
    }
    
    // 处理主请求
    handleRequest(req, res, config);
  };
}

// 显示配置信息
function showConfig() {
  const { localFolders, globalServers } = config.getConfig();
  
  // 显示启用的本地文件夹
  const enabledFolders = Object.entries(localFolders)
    .filter(([_, cfg]) => cfg.enabled)
    .map(([path]) => path);
  if (enabledFolders.length > 0) {
    console.log('Local folders (' + enabledFolders.length + '): ' + enabledFolders.join(', '));
  }
  
  // 显示启用的全局服务器
  const enabledServers = Object.entries(globalServers)
    .filter(([_, cfg]) => cfg.enabled)
    .map(([url]) => url);
  if (enabledServers.length > 0) {
    console.log('Global servers (' + enabledServers.length + '): ' + enabledServers.join(', '));
  }
}

// 启动 HTTP 服务器
function startHttpServer(port) {
  const http = require('http');
  const requestHandler = createRequestHandler(port, null);
  const httpServer = http.createServer(requestHandler);
  
  httpServer.listen(port, '0.0.0.0', () => {
    console.log('HTTP server running at http://0.0.0.0:' + port);
    console.log('Admin panel: http://localhost:' + port + '/admin');
    showConfig();
  });
  
  return httpServer;
}

// 启动 HTTPS 服务器
function startHttpsServer(port, keyPath, certPath) {
  const https = require('https');
  const fs = require('fs');
  
  // 检查证书文件
  if (!fs.existsSync(keyPath)) {
    throw new Error('HTTPS key file not found: ' + keyPath);
  }
  
  if (!fs.existsSync(certPath)) {
    throw new Error('HTTPS cert file not found: ' + certPath);
  }
  
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  
  const requestHandler = createRequestHandler(null, port);
  const httpsServer = https.createServer(httpsOptions, requestHandler);
  
  httpsServer.listen(port, '0.0.0.0', () => {
    console.log('HTTPS server running at https://0.0.0.0:' + port);
    console.log('Admin panel: https://localhost:' + port + '/admin');
    showConfig();
  });
  
  return httpsServer;
}

// 同时启动 HTTP 和 HTTPS 服务器
function startBothServers(httpPort, httpsPort, keyPath, certPath) {
  const http = require('http');
  const https = require('https');
  const fs = require('fs');
  
  const requestHandler = createRequestHandler(httpPort, httpsPort);
  
  // 启动 HTTP
  const httpServer = http.createServer(requestHandler);
  httpServer.listen(httpPort, '0.0.0.0', () => {
    console.log('HTTP server running at http://0.0.0.0:' + httpPort);
    console.log('Admin panel: http://localhost:' + httpPort + '/admin');
    showConfig();
  });
  
  // 启动 HTTPS
  try {
    if (!fs.existsSync(keyPath)) {
      console.error('HTTPS key file not found: ' + keyPath);
      console.error('HTTPS server will not start');
      return { httpServer, httpsServer: null };
    }
    
    if (!fs.existsSync(certPath)) {
      console.error('HTTPS cert file not found: ' + certPath);
      console.error('HTTPS server will not start');
      return { httpServer, httpsServer: null };
    }
    
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    
    const httpsServer = https.createServer(httpsOptions, requestHandler);
    httpsServer.listen(httpsPort, '0.0.0.0', () => {
      console.log('HTTPS server running at https://0.0.0.0:' + httpsPort);
      console.log('Admin panel: https://localhost:' + httpsPort + '/admin');
    });
    
    return { httpServer, httpsServer };
  } catch (error) {
    console.error('Failed to start HTTPS server:', error.message);
    return { httpServer, httpsServer: null };
  }
}

module.exports = {
  startHttpServer,
  startHttpsServer,
  startBothServers
};

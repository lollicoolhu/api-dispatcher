const http = require('http');
const config = require('./lib/config');
const { handleAdminRoutes } = require('./lib/admin-routes');
const { handleRequest } = require('./lib/request-handler');

const PORT = 3000;

// 加载配置
config.loadData();

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 处理管理路由
  if (handleAdminRoutes(req, res, config, config.saveData)) {
    return;
  }
  
  // 处理主请求
  handleRequest(req, res, config);
});

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  console.log('Mock server running at http://0.0.0.0:' + PORT);
  console.log('Admin panel: http://localhost:' + PORT + '/admin');
  
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
});

const fs = require('fs');
const path = require('path');
const os = require('os');

const MASTER_CONFIG_FILE = path.join(__dirname, '../.config.json');

// 引导配置 (Master Config)
let masterConfig = {
  externalFolderPath: ''
};

// 加载引导配置
function loadMasterConfig() {
  try {
    if (fs.existsSync(MASTER_CONFIG_FILE)) {
      masterConfig = JSON.parse(fs.readFileSync(MASTER_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load master config:', e.message);
  }
}

// 保存引导配置
function saveMasterConfig() {
  try {
    fs.writeFileSync(MASTER_CONFIG_FILE, JSON.stringify(masterConfig, null, 2));
  } catch (e) {
    console.error('Failed to save master config:', e.message);
  }
}

loadMasterConfig();

function getDataRoot() {
  let root = masterConfig.externalFolderPath;
  if (!root) {
    root = path.join(os.homedir(), '.mock_config');
  }
  
  // 确保目录存在
  if (!fs.existsSync(root)) {
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (e) {
      console.error('Failed to create data root:', root, e.message);
      // 如果创建失败（比如权限问题），回退到项目内的 public
      return path.join(__dirname, '../public');
    }
  }
  return root;
}

function getDataFile() {
  const root = getDataRoot();
  return root ? path.join(root, '.mock-server-data.json') : null;
}

// 配置数据
let tempOverrides = {};  // { path: { content, enabled, priority } }
let urlMappings = {};    // { path: { target, enabled, priority } }
let folderMappings = {}; // { pattern: { folder, enabled, priority } }
let localFolders = {};   // { path: { enabled, priority, remark } }
let globalServers = {};  // { url: { enabled, priority, remark } }
let cookieRewrite = true;

// 加载持久化数据
function loadData() {
  // 重置数据
  tempOverrides = {};
  urlMappings = {};
  folderMappings = {};
  localFolders = {};
  globalServers = {};
  cookieRewrite = true;

  const dataRoot = getDataRoot();
  try {
    const dataFile = getDataFile();
    if (fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      
      // 兼容旧格式 - tempOverrides
      const oldOverrides = data.tempOverrides || {};
      tempOverrides = {};
      for (const [k, v] of Object.entries(oldOverrides)) {
        if (typeof v === 'string') {
          // 极旧格式：字符串
          tempOverrides[k] = [{ id: 'v1', content: v, enabled: true, priority: 1, createdAt: new Date().toISOString() }];
        } else if (!Array.isArray(v)) {
          // 旧格式：单个对象
          const ver = { ...v };
          if (!ver.id) ver.id = 'v1';
          if (!ver.createdAt) ver.createdAt = new Date().toISOString();
          tempOverrides[k] = [ver];
        } else {
          // 新格式：数组
          tempOverrides[k] = v;
        }
      }
      
      // 兼容旧格式 - urlMappings
      const oldMappings = data.urlMappings || data.proxyMappings || {};
      urlMappings = {};
      for (const [k, v] of Object.entries(oldMappings)) {
        if (typeof v === 'string') {
          urlMappings[k] = { target: v, enabled: true, priority: 1 };
        } else {
          urlMappings[k] = v;
        }
      }
      
      folderMappings = data.folderMappings || {};
      localFolders = data.localFolders || {};
      globalServers = data.globalServers || {};
      
      // 兼容旧的单个 globalServer 格式
      if (!data.globalServers && data.globalServer && data.globalServer.url) {
        globalServers[data.globalServer.url] = {
          enabled: data.globalServer.enabled !== false,
          priority: data.globalServer.priority ?? 100,
          remark: data.globalServer.remark || ''
        };
      }
      
      if (data.cookieRewrite !== undefined) cookieRewrite = data.cookieRewrite;
      
      console.log('Loaded ' + Object.keys(tempOverrides).length + ' overrides, ' + 
                  Object.keys(urlMappings).length + ' url mappings, ' + 
                  Object.keys(folderMappings).length + ' folder mappings, ' + 
                  Object.keys(localFolders).length + ' local folders, ' + 
                  Object.keys(globalServers).length + ' global servers');
    }
  } catch (e) {
    console.error('Failed to load data:', e.message);
  }
}

// 保存持久化数据
function saveData() {
  try {
    const dataFile = getDataFile();
    if (!dataFile) return;
    const dir = path.dirname(dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dataFile, JSON.stringify({
      tempOverrides,
      urlMappings,
      folderMappings,
      localFolders,
      globalServers,
      cookieRewrite
    }, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e.message);
  }
}

// 导出配置和方法
module.exports = {
  loadData,
  saveData,
  getConfig: () => ({
    tempOverrides,
    urlMappings,
    folderMappings,
    localFolders,
    globalServers,
    cookieRewrite
  }),
  setConfig: (config) => {
    if (config.tempOverrides !== undefined) tempOverrides = config.tempOverrides;
    if (config.urlMappings !== undefined) urlMappings = config.urlMappings;
    if (config.folderMappings !== undefined) folderMappings = config.folderMappings;
    if (config.localFolders !== undefined) localFolders = config.localFolders;
    if (config.globalServers !== undefined) globalServers = config.globalServers;
    if (config.cookieRewrite !== undefined) cookieRewrite = config.cookieRewrite;
  },
  getMasterConfig: () => ({ ...masterConfig }),
  setMasterConfig: (cfg) => {
    if (cfg.externalFolderPath !== undefined) masterConfig.externalFolderPath = cfg.externalFolderPath;
    saveMasterConfig();
  },
  getDataRoot
};

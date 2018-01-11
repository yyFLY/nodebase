const fs = require('fs');
const path = require('path');
const { loadFile } = require('./index');
const initCwd = process.cwd();

module.exports = resolvePlugin;

function resolvePlugin(configs, env, agent, file) {
  const tree = {};
  for (const plugin in configs) {
    const config = configs[plugin];

    if (config.enable === undefined) config.enable = true;
    if (!config.env || config.env === '*') config.env = [];
    if (!Array.isArray(config.env)) config.env = [config.env];
    if (!config.agent || config.agent === '*') config.agent = [];
    if (!Array.isArray(config.agent)) config.agent = [config.agent];

    const next = 
      !config.enable || 
      (config.env.length && config.env.indexOf(env) === -1) ||
      (config.agent.length && config.agent.indexOf(agent) === -1);
    if (next) continue;

    const pluginPackageName = config.package;
    const pluginPathName = config.path;

    if (!pluginPackageName && !pluginPathName) {
      // throw new Error('miss package');
      continue;
    }

    let pkgPath, modal, exportsPath;

    if (pluginPathName) {
      pkgPath = path.resolve(pluginPathName, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        // throw new Error('miss package');
        continue;
      }
      modal = loadFile(pkgPath);
      exportsPath = path.resolve(pluginPathName, file);
    } else {
      const dir = assertAndReturn(pluginPackageName, __dirname);
      modal = loadFile(dir + '/package.json');
      exportsPath = path.resolve(dir, file);
    }

    if (!modal.nodebasePlugin || modal.nodebasePlugin.name !== plugin) {
      // throw new Error('error plugin');
      continue;
    }

    if (fs.existsSync(exportsPath)) {
      tree[plugin] = {
        dependencies: modal.nodebasePlugin.dependencies || [],
        exports: loadFile(exportsPath)
      }
    }
  }

  return sortDependencies(tree);
}

function sortDependencies(tree) {
  const s = Object.keys(tree);
  const m = [];
  let j = s.length;
  while (j--) {
    const obj = tree[s[j]];

    Object.defineProperty(obj, 'deep', {
      get() {
        if (!obj.dependencies.length) return 0;
        return Math.max(...obj.dependencies.map(d => tree[d].deep)) + 1;
      }
    });
  }

  for (const i in tree) {
    tree[i].name = i;
    m.push(tree[i]);
  }
  console.log(m)
  return m.sort((a, b) => a.deep - b.deep);
}

function assertAndReturn(frameworkName, moduleDir) {
  const moduleDirs = new Set([
    moduleDir,
    // find framework from process.cwd, especially for test,
    // the application is in test/fixtures/app,
    // and framework is install in ${cwd}/node_modules
    path.join(process.cwd(), 'node_modules'),
    // prevent from mocking process.cwd
    path.join(initCwd, 'node_modules'),
  ]);
  for (const moduleDir of moduleDirs) {
    const frameworkPath = path.join(moduleDir, frameworkName);
    if (fs.existsSync(frameworkPath)) return frameworkPath;
  }
  throw new Error(`${frameworkName} is not found in ${Array.from(moduleDirs)}`);
}
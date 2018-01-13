const fs = require('fs');
const ip = require('ip');
const net = require('net');
const path = require('path');
const cfork = require('cfork');
const assert = require('assert');
const cluster = require('cluster');
const IPCMessage = require('ipc-message');
const childprocess = require('child_process');
const debug = require('debug')('nodebase:cluster:master');
const parseOptions = require('../utils/options');
const { costTime, loadFile, checkPortCanUse } = require('../utils');
const Logger = require('../utils/logger');

const toString = Object.prototype.toString;
const agentWorkerFile = path.resolve(__dirname, './agent_worker.js');
const appWorkerFile = path.resolve(__dirname, './app_worker.js');

const agentLifeCycle = [
  'agent:beforeCreate',
  'agent:created',
  'agent:beforeMount',
  'agent:mounted',
  'agent:beforeDestroy',
  'agent:destroyed',
  'app:beforeCreate',
  'app:created',
  'app:beforeMount',
  'app:mounted',
  'app:beforeDestroy',
  'app:destroyed'
];

module.exports = class Master extends IPCMessage {
  constructor(config) {
    super();
    /**
     * Master进程状态
     * this.status
     * 
     * 0: 正常运行中
     * 1: 正在关闭workers进程
     * 2: 正在关闭Agents进程
     * 3: 正在关闭Master进程
     */
    this.status = 0;
    this.env = process.env.NODE_ENV || 'production';

    const optionsPath = path.resolve(config, `options.${this.env}.js`);
    assert(fs.existsSync(optionsPath), `options.${this.env}.js should exist.`);
    const options = loadFile(optionsPath);
    options.configPath = config;

    this.options = parseOptions(options);
    this.console = new Logger(this);
    this.logger = console;
    this.on('message', this.onReceiveMessageHandler.bind(this));
    agentLifeCycle.forEach(life => this.on(life, costTime(life)));
    this.onLifeCycleBinding();
    this.onExitEventBinding();
    this.installize();
  }

  async installize() {
    await checkPortCanUse(this.console, this.options.port);
    const port = await checkPortCanUse(this.console);
    this.options.clusterPort = port;
    this.startSocketService();
    this.forkAgentWorker();
  }

  startSocketService() {
    if (this.options.socket) {
      net.createServer({
        pauseOnConnect: true
      }, this.socketServiceBalance.bind(this))
      .listen(this.options.port);
    }
  }

  socketServiceBalance(socket) {
    if (!socket.remoteAddress) {
      return socket.close();
    }
    var addr = ip.toBuffer(socket.remoteAddress || '127.0.0.1');
    var hash = this.socketServiceHash(addr);

    debug('balacing connection %j', addr);
    this.workers[hash % this.workers.length].send('sticky:balance', socket);
  }

  socketServiceHash(ip) {
    var hash = this.seed;
    for (var i = 0; i < ip.length; i++) {
      var num = ip[i];

      hash += num;
      hash %= 2147483648;
      hash += (hash << 10);
      hash %= 2147483648;
      hash ^= hash >> 6;
    }

    hash += hash << 3;
    hash %= 2147483648;
    hash ^= hash >> 11;
    hash += hash << 15;
    hash %= 2147483648;

    return hash >>> 0;
  }

  async onReceiveMessageHandler(message) {
    const action = message.action;
    await this.emit(action, message);
  }

  // 绑定系统使用的生命周期函数
  onLifeCycleBinding() {
    this.on('agent:mounted', this.onAgentsMounted.bind(this));
    this.on('agent:exit:child:done', this.agentWorkerExitDone.bind(this));
    this.on('app:exit:child:done', this.appWorkerExitDone.bind(this));
    this.on('agent:exit', () => this.status = 3);
    this.on('error', err => this.console.error(err));
  }

  // 绑定系统退出的事件处理机制
  onExitEventBinding() {
    process.on('SIGINT', this.onSignal.bind(this, 'SIGINT'));
    process.on('SIGQUIT', this.onSignal.bind(this, 'SIGQUIT'));
    process.on('SIGTERM', this.onSignal.bind(this, 'SIGTERM'));
    process.on('exit', this.onExit.bind(this));
    ['error', 'rejectionHandled', 'uncaughtException'].forEach(err => {
      process.on(err, e => this.emit('error', e));
    });
  }

  /**
   * 轮询确定是否所有Agents都已经mounted完毕
   * 条件为在IPCMessage上注册的agent个数是否与我们指定的agent个数相同
   * 发生：在任意一个agent的mounted周期上轮询
   */
  onAgentsMounted() {
    const realAgentsCount = Object.keys(this.agents).length;
    const customAgentsCount = this.options.agents.length;
    if (realAgentsCount === customAgentsCount) {
      debug('All agents is mounted, now start to fork workers.');
      this.forkApplicationWorker(this.options.max);
    }
  }

  forkAgentWorker() {
    const argvs = process.argv.slice(2);
    const opt = {
      cwd: this.options.cwd,
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      execArgv: process.execArgv
    }
    for (let i = 0; i < this.options.agents.length; i++) {
      const args = argvs.concat([JSON.stringify(this.options)]);
      args.push(this.options.agents[i].name, this.options.agents[i].path);
      this.registAgent(
        this.options.agents[i].name, 
        childprocess.fork(agentWorkerFile, args, opt)
      );
    }
  }

  forkApplicationWorker(max) {
    const argvs = process.argv.slice(2);
    const args = argvs.concat([JSON.stringify(this.options)]);
    args.push(this.options.app);
    cfork({
      exec: appWorkerFile,
      args,
      silent: false,
      count: max,
      refork: false,
      env: process.env
    });
    cluster.on('exit', worker => {
      if (this.status === 0) {
        this.console.warn('Application worker refork.');
        this.forkApplicationWorker(1);
      }
    });
  }

  async agentWorkerExitDone(message) {
    this.send(message.from, 'agent:exit:child:destroy');
    if (!this._agets) this._agents = [];
    if (this.agents[message.body]) {
      this._agents.push(this.agents[message.body]);
      delete this.agents[message.body];
    }
    if (!Object.keys(this.agents).length) {
      await this.emit('agent:exit');
    }
  }

  async appWorkerExitDone(message) {
    this.send(message.from, 'app:exit:child:destroy');
  }

  onSignal(signal) {
    const timer = setInterval(() => {
      if (this.status === 1) {
        for (const id in cluster.workers) {
          if (!cluster.workers[id].isDead()) return;
        }
        this.status = 2;
        this.send('agents', 'agent:exit:child:notify');
        this.emit('app:exit');
      }
      
      if (this.status === 3) {
        if (this._agents.filter(a => !!a.connected).length) return;
        clearInterval(timer);
        this.console.info(`[${this.pid}]`, 'master is closing process with signal:', signal);
        process.exit(0);
      }
    }, 100);
    
    if (this.status === 0) {
      this.send('workers', 'app:exit:child:notify');
      this.status = 1;
    }
  }

  onExit(code) {
    this.console.info(`[${this.pid}]`, 'master is exited with code:', code);
  }
}
const io = require('socket.io');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('nodebase:socket');
module.exports = class Socket extends io {
  constructor(...args) {
    super(...args);
    this.base = null;
    this.rooms = {};
  }

  loader() {
    const app = this.base;
    if (!app.options.io) app.options.io = 'app/io';
    const ioDir = app.resolve(app.options.io);
    if (!fs.existsSync(ioDir)) return;

    fs.readdirSync(ioDir).forEach(file => {
      const fullpath = path.resolve(ioDir, file);
      if (fs.statSync(fullpath).isFile() && /.js$/.test(file)) {
        const mark = file.replace(/.js$/i, '').replace(/\:/g, '\/');
        const exports = app.utils.loadFile(fullpath);
        this.rooms[mark] = exports;
      }
    });
    debug('rooms', this.rooms);
  }

  nspInstaller() {
    for (const nsp in this.rooms) {
      const room = nsp === 'index' ? this : this.of('/' + nsp);
      const cb = this.rooms[nsp];
      room.on('connection', socket => cb(socket, this.base));
    }
  }
}
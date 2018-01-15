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
        this.rooms[mark] = {
          exports,
          sockets: []
        };
      }
    });
    debug('rooms', this.rooms);
  }

  nspInstaller() {
    for (const nsp in this.rooms) {
      const room = nsp === 'index' ? this : this.of('/' + nsp);
      const cb = this.rooms[nsp].exports;
      const sockets = this.rooms[nsp].sockets;
      room.on('connect', socket => sockets.push(socket));
      room.on('connection', socket => cb(socket, this.base, sockets));
      room.on('disconnect', socket => {
        const index = sockets.indexOf(socket);
        if (index > -1) sockets.splice(index, 1);
      });
    }
  }
}
module.exports = (socket, app) => {
  socket.on('a', a => {
    socket.emit('b', a + 2);
  });
}
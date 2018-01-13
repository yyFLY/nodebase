const fs = require('fs');
module.exports = (app, router) => {
  router.get('/', async ctx => {
    ctx.body = fs.readFileSync(app.resolve('index.html'), 'utf8');
  });
  router.get('/test', app.controller.test.hello);
}
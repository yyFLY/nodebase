const debug = require('debug')('Test:plugin:test1:agent.js');
module.exports = component => {
  [
    'destroy',
    'task:start',
    'task:end',
    'cluster:mounted'
  ].forEach(life => {
    component.on(life, () => {
      debug(`lifecycle \`${life}\` is triggered.`);
    });
  });

  component.use(async (ctx, next) => {
    if (ctx.url === '/a/b/c') {
      ctx.reply(Object.assign({
        m: 'hello',
        n: 'world'
      }, component.config));
    }
  });
}
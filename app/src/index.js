const store = require('./db');
const server = require('./server');
const robot = require('./robot');
const wa = require('./whatsapp');

server.start();
robot.start();

// Cria a conexão do WhatsApp assim que o serviço estiver de pé
(async () => {
  for (let i = 0; i < 30; i++) {
    try { await wa.ensureInstance(); store.log('info', 'Serviço do WhatsApp pronto.'); return; }
    catch { await new Promise((r) => setTimeout(r, 10000)); }
  }
  store.log('erro', 'Não consegui falar com o serviço do WhatsApp (Evolution API).');
})();

process.on('unhandledRejection', (err) => store.log('erro', `Inesperado: ${err && err.message}`));

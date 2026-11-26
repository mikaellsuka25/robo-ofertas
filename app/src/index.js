const store = require('./db');
const server = require('./server');
const engine = require('./automations');
const telegram = require('./telegram');
const wa = require('./whatsapp');
const dispatch = require('./dispatch');

server.start();
engine.start();
telegram.start();

// Prepara os números (cria na Evolution e liga o webhook) assim que o serviço estiver de pé
(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      for (const inst of dispatch.listInstances()) await wa.ensureInstance(inst.name);
      store.log('info', 'Serviço do WhatsApp pronto.');
      return;
    } catch { await new Promise((r) => setTimeout(r, 10000)); }
  }
  store.log('erro', 'Não consegui falar com o serviço do WhatsApp (Evolution API).');
})();

process.on('unhandledRejection', (err) => store.log('erro', `Inesperado: ${err && err.message}`));

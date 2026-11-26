const store = require('./db');
const server = require('./server');
const engine = require('./automations');
const telegram = require('./telegram');
const wa = require('./whatsapp');
const dispatch = require('./dispatch');

server.start();
engine.start();
telegram.start();

// WhatsApp: as mensagens dos grupos chegam direto para as automações
wa.onMessage(engine.onWebhook);
wa.startAll(dispatch.listInstances().map((i) => i.name))
  .then(() => store.log('info', 'WhatsApp iniciado.'))
  .catch((err) => store.log('erro', `WhatsApp: ${err.message}`));

process.on('unhandledRejection', (err) => store.log('erro', `Inesperado: ${err && err.message}`));

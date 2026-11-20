/** Start the server: `npm start` (or `npm run dev` to restart on changes). */
import { loadConfig } from './config.js';
import { connect } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const { client, db } = await connect(config).catch(e => {
  console.error(`Could not connect to MongoDB at ${config.mongoUri}: ${e.message}`);
  process.exit(1);
});
const server = createApp({ db, config }).listen(config.port, () => {
  console.log(`Quantum Pictural Playground on http://localhost:${config.port}  (db "${config.dbName}", auth: ${config.authMode})`);
});
const stop = async () => { server.close(); await client.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

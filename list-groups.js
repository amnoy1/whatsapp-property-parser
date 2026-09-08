'use strict';
require('dotenv').config();
const { connect, disconnect } = require('./src/whatsapp-client');

async function main() {
  console.log('מתחבר...');
  const client = await connect();
  const chats = await client.getChats();
  const groups = chats.filter(c => c.isGroup);
  console.log(`\nנמצאו ${groups.length} קבוצות:\n`);
  const fs = require('fs');
  const names = groups.map(g => g.name);
  fs.writeFileSync('group-names.json', JSON.stringify(names, null, 2), 'utf8');
  console.log('נשמר ל-group-names.json');
  groups.forEach((g, i) => console.log(`${i+1}. ${g.name}`));
  await disconnect(client);
}

main().catch(err => { console.error(err.message); process.exit(1); });

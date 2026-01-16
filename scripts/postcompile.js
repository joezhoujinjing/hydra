const fs = require('fs');
const path = require('path');

const cliEntry = path.join(__dirname, '..', 'out', 'cli', 'index.js');

if (fs.existsSync(cliEntry)) {
  const content = fs.readFileSync(cliEntry, 'utf8');
  if (!content.startsWith('#!/usr/bin/env node')) {
    fs.writeFileSync(cliEntry, '#!/usr/bin/env node\n' + content);
  }
  fs.chmodSync(cliEntry, '755');
}

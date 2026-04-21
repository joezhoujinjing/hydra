const fs = require('fs');
const path = require('path');

const cliEntry = path.join(__dirname, '..', 'out', 'cli', 'index.js');

// Copy src/resources to out/resources
const srcRes = path.join(__dirname, '..', 'src', 'resources');
const outRes = path.join(__dirname, '..', 'out', 'resources');

if (fs.existsSync(srcRes)) {
  if (!fs.existsSync(outRes)) {
    fs.mkdirSync(outRes, { recursive: true });
  }
  fs.readdirSync(srcRes).forEach(file => {
    fs.copyFileSync(path.join(srcRes, file), path.join(outRes, file));
  });
}

if (fs.existsSync(cliEntry)) {
  const content = fs.readFileSync(cliEntry, 'utf8');
  if (!content.startsWith('#!/usr/bin/env node')) {
    fs.writeFileSync(cliEntry, '#!/usr/bin/env node\n' + content);
  }
  fs.chmodSync(cliEntry, '755');
}

// Builds figma/ui.html: Figma loads a plugin's UI as one HTML string, so the
// shared panel CSS, the shared Quiver client and the Figma UI script are inlined.
//   node figma/build.js         (or: node build.js from this folder)
const fs = require('fs');
const path = require('path');

const here = __dirname;
const template = fs.readFileSync(path.join(here, 'src', 'ui.html'), 'utf8');
const out = template.replace(/\/\* @inline (\S+) \*\//g, (_, rel) => {
  const text = fs.readFileSync(path.join(here, rel), 'utf8');
  if (/<\/(script|style)/i.test(text)) throw new Error(`${rel} contains a closing tag that would break inlining`);
  return `\n/* ${rel} */\n${text}`;
});
const note = '<!-- Built by build.js from src/. Edit src/, then run: node build.js -->';
fs.writeFileSync(path.join(here, 'ui.html'), out.replace(/^<!doctype html>/i, (d) => `${d}\n${note}`));
console.log(`ui.html: ${(out.length / 1024).toFixed(1)} KB`);

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const HTML_PATH = path.join(BASE, 'games', 'meme-madness', 'index.html');
const OUTPUT_PATH = path.join(__dirname, 'cat-pack-output.json');

console.log('Reading cat-pack-output.json...');
const output = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));

console.log('Reading index.html...');
let html = fs.readFileSync(HTML_PATH, 'utf8');

// 1. Inject cat pack into PACKS object (append before closing })
//    Current: const PACKS={ishowspeed:[...]};
//    Target:  const PACKS={ishowspeed:[...],cat:[...]};
const packsEnd = 'ishowspeed:';
const closingBrace = '};';

// Find end of PACKS object by finding the semicolon after the last bracket
// The PACKS line is the only const PACKS= line
const packsStart = html.indexOf('const PACKS={');
if (packsStart === -1) { console.error('Could not find PACKS object'); process.exit(1); }

// Find the matching closing }; for PACKS
// The PACKS object ends with ]}; (end of array, end of object, semicolon)
// Since the base64 data contains no }; we can find it by looking for the pattern
// After the PACKS object there should be a newline and then 'var SB_URL'
const afterPacks = html.indexOf('\nvar SB_URL=', packsStart);
if (afterPacks === -1) { console.error('Could not find end of PACKS'); process.exit(1); }

// The PACKS line ends at afterPacks (it's one line)
// Find the }; just before afterPacks
let packsLineEnd = afterPacks;
while (html[packsLineEnd] !== '\n' && packsLineEnd > packsStart) packsLineEnd--;
// Actually the line ends at the \n, so the PACKS line is from packsStart to afterPacks
// The line ends with ]};  We want to insert ,cat:[...] before the };

// Find ]};  or }; at end of PACKS line
const packsLine = html.substring(packsStart, afterPacks);
if (!packsLine.endsWith('}')) {
  // It ends with }; but afterPacks points to \n, so packsLine ends with };
  console.log('PACKS line ends with:', packsLine.slice(-10));
}

// Replace the end of the PACKS line: insert ,cat:[...] before the closing };
const newPacksLine = packsLine.replace(/\};$/, `,${output.packJS}};`);
html = html.substring(0, packsStart) + newPacksLine + html.substring(afterPacks);

// 2. Add cat pack button in host screen (only if not already there)
if (!html.includes("selectPack(this,'cat')")) {
  const speedBtnEnd = '</button>\n  </div>';
  const catBtnInsert = `</button>\n    ${output.packBtnHTML}\n  </div>`;
  html = html.replace(speedBtnEnd, catBtnInsert);
} else {
  console.log('Cat button already present, skipping.');
}

console.log('Writing index.html...');
fs.writeFileSync(HTML_PATH, html);
console.log('Done! Cat pack injected successfully.');

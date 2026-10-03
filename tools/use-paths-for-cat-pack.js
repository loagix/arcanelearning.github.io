// Replace cat pack base64 srcs with relative file paths to shrink the HTML
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'games', 'meme-madness', 'index.html');

const FILES = {
  'chill':          '../../arcaneLerningImages/meMacatchill.webp',
  'clap':           '../../arcaneLerningImages/meMacatclap.gif',
  'cry':            '../../arcaneLerningImages/meMacatcry.gif',
  'dance':          '../../arcaneLerningImages/meMaCatdance.gif',
  'drive':          '../../arcaneLerningImages/meMacatdrive.webp',
  'eating':         '../../arcaneLerningImages/meMacateating.gif',
  'flash':          '../../arcaneLerningImages/meMAcatflash.gif',
  'happyhappy':     '../../arcaneLerningImages/meMacathappyhappy.gif',
  'mad':            '../../arcaneLerningImages/meMacatmad.gif',
  'onkey':          '../../arcaneLerningImages/meMacatonkey.gif',
  'overstimmilate': '../../arcaneLerningImages/meMacatoverstimmilate.gif',
  'punch':          '../../arcaneLerningImages/meMacatpunch.webp',
  'me mawarcat':    '../../arcaneLerningImages/meMawarcat.gif',
};

console.log('Reading HTML...');
let html = fs.readFileSync(HTML_PATH, 'utf8');
const before = html.length;

for (const [name, filePath] of Object.entries(FILES)) {
  // Match: {name:'chill',src:'data:image/...base64,...'}
  const regex = new RegExp(`(\\{name:'${name.replace(/ /g, ' ')}',src:')data:[^']+('\\})`, 'g');
  const replaced = html.replace(regex, `$1${filePath}$2`);
  if (replaced === html) {
    console.warn(`  WARNING: no match for name='${name}'`);
  } else {
    console.log(`  replaced: ${name} → ${filePath}`);
    html = replaced;
  }
}

const after = html.length;
console.log(`Size: ${(before/1e6).toFixed(1)}MB → ${(after/1e6).toFixed(1)}MB`);

console.log('Writing HTML...');
fs.writeFileSync(HTML_PATH, html);
console.log('Done!');

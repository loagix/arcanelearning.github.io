// Re-processes cat pack icon: flood fill from edges to remove ONLY outside black
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = path.join(__dirname, '..');
const ICON_IN = path.join(BASE, 'arcaneLerningImages', 'meanMAcatChatGPT Image Oct 3, 2026, 03_32_22 PM.png');
const ICON_OUT = path.join(BASE, 'arcaneLerningImages', 'catpack-icon-transparent.png');
const HTML_PATH = path.join(BASE, 'games', 'meme-madness', 'index.html');

function readU32(buf, off) {
  return (buf[off] << 24 | buf[off+1] << 16 | buf[off+2] << 8 | buf[off+3]) >>> 0;
}
function writeU32(buf, off, val) {
  buf[off]   = (val >>> 24) & 0xff;
  buf[off+1] = (val >>> 16) & 0xff;
  buf[off+2] = (val >>>  8) & 0xff;
  buf[off+3] =  val         & 0xff;
}
function crc32(buf, start, len) {
  let crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  for (let i = start; i < start + len; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePNG(buf) {
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = readU32(buf, off); off += 4;
    const type = buf.slice(off, off+4).toString('ascii'); off += 4;
    const data = buf.slice(off, off+len); off += len;
    off += 4;
    chunks.push({ type, data });
  }
  return chunks;
}

function buildPNG(chunks) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const parts = [sig];
  for (const { type, data } of chunks) {
    const lenBuf = Buffer.alloc(4); writeU32(lenBuf, 0, data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const all = Buffer.concat([typeBuf, data]);
    writeU32(crcBuf, 0, crc32(all, 0, all.length));
    parts.push(lenBuf, typeBuf, data, crcBuf);
  }
  return Buffer.concat(parts);
}

function undoFilter(raw, width, channels) {
  const stride = width * channels;
  const rows = Math.floor(raw.length / (stride + 1));
  const out = Buffer.alloc(rows * stride);
  let inOff = 0, outOff = 0;
  for (let y = 0; y < rows; y++) {
    const filter = raw[inOff++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[inOff + x];
      const left   = x < channels        ? 0 : out[outOff + x - channels];
      const up     = y === 0             ? 0 : out[outOff - stride + x];
      const upLeft = (x < channels || y === 0) ? 0 : out[outOff - stride + x - channels];
      let val;
      if      (filter === 0) val = cur;
      else if (filter === 1) val = (cur + left) & 0xff;
      else if (filter === 2) val = (cur + up) & 0xff;
      else if (filter === 3) val = (cur + Math.floor((left + up) / 2)) & 0xff;
      else {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        val = (cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      }
      out[outOff + x] = val;
    }
    inOff += stride; outOff += stride;
  }
  return out;
}

console.log('Reading icon...');
const buf = fs.readFileSync(ICON_IN);
const chunks = parsePNG(buf);

const ihdr = chunks.find(c => c.type === 'IHDR').data;
const width  = readU32(ihdr, 0);
const height = readU32(ihdr, 4);
const colorType = ihdr[9];
const inChannels = colorType === 6 ? 4 : 3;

console.log(`Image: ${width}x${height}, colorType=${colorType}`);

const compressed = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
const raw = zlib.inflateSync(compressed);
const pixels = undoFilter(raw, width, inChannels);

// Build RGBA pixel array
const rgba = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  rgba[i*4]   = pixels[i*inChannels];
  rgba[i*4+1] = pixels[i*inChannels+1];
  rgba[i*4+2] = pixels[i*inChannels+2];
  rgba[i*4+3] = inChannels === 4 ? pixels[i*inChannels+3] : 255;
}

// Flood fill from all edge pixels: mark connected near-black pixels as transparent
const BLACK_THRESH = 40;
function isNearBlack(idx) {
  return rgba[idx] < BLACK_THRESH && rgba[idx+1] < BLACK_THRESH && rgba[idx+2] < BLACK_THRESH;
}

const visited = new Uint8Array(width * height);
const queue = [];

// Seed from all 4 edges
for (let x = 0; x < width; x++) {
  for (const y of [0, height - 1]) {
    const i = y * width + x;
    if (!visited[i] && isNearBlack(i * 4)) { visited[i] = 1; queue.push(i); }
  }
}
for (let y = 0; y < height; y++) {
  for (const x of [0, width - 1]) {
    const i = y * width + x;
    if (!visited[i] && isNearBlack(i * 4)) { visited[i] = 1; queue.push(i); }
  }
}

// BFS
let head = 0;
while (head < queue.length) {
  const i = queue[head++];
  const x = i % width, y = Math.floor(i / width);
  const neighbors = [];
  if (x > 0)          neighbors.push(i - 1);
  if (x < width - 1)  neighbors.push(i + 1);
  if (y > 0)          neighbors.push(i - width);
  if (y < height - 1) neighbors.push(i + width);
  for (const n of neighbors) {
    if (!visited[n] && isNearBlack(n * 4)) { visited[n] = 1; queue.push(n); }
  }
}

console.log(`Flood filled ${queue.length} outside-black pixels`);

// Make all flood-filled pixels transparent
for (let i = 0; i < width * height; i++) {
  if (visited[i]) rgba[i*4+3] = 0;
}

// Re-encode as PNG with filter=0
const outStride = width * 4;
const filtered = Buffer.alloc(height * (outStride + 1));
for (let y = 0; y < height; y++) {
  filtered[y * (outStride + 1)] = 0;
  rgba.copy(filtered, y * (outStride + 1) + 1, y * outStride, (y+1) * outStride);
}

const newIhdr = Buffer.from(ihdr);
newIhdr[9] = 6; // RGBA
const newChunks = [
  { type: 'IHDR', data: newIhdr },
  { type: 'IDAT', data: zlib.deflateSync(filtered) },
  { type: 'IEND', data: Buffer.alloc(0) },
];

fs.writeFileSync(ICON_OUT, buildPNG(newChunks));
console.log('Saved new icon.');

// Now update the icon in index.html (replace old embedded icon src)
console.log('Reading index.html...');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const newIconB64 = `data:image/png;base64,${fs.readFileSync(ICON_OUT).toString('base64')}`;

// The cat pack button has: onclick="selectPack(this,'cat')" ... <img src="DATA">
// Find the cat button's img src and replace it
const catBtnPattern = /(selectPack\(this,'cat'\)[^>]*>.*?<img src=")([^"]+)(")/s;
const newHtml = html.replace(catBtnPattern, `$1${newIconB64}$3`);

if (newHtml === html) {
  console.error('Could not find cat button img src to replace!');
  process.exit(1);
}

console.log('Writing index.html...');
fs.writeFileSync(HTML_PATH, newHtml);
console.log('Done!');

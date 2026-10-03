// Processes cat-pack: strips black bg from icon, base64 encodes all memes
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = path.join(__dirname, '..');
const ICON_IN = path.join(BASE, 'arcaneLerningImages', 'meanMAcatChatGPT Image Oct 3, 2026, 03_32_22 PM.png');
const ICON_OUT = path.join(BASE, 'arcaneLerningImages', 'catpack-icon-transparent.png');
const MEMES_DIR = path.join(BASE, 'arcaneLerningImages');

// ---- minimal PNG read/write with zlib ----

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
  let off = 8; // skip signature
  const chunks = [];
  while (off < buf.length) {
    const len = readU32(buf, off); off += 4;
    const type = buf.slice(off, off+4).toString('ascii'); off += 4;
    const data = buf.slice(off, off+len); off += len;
    off += 4; // skip CRC
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
    const crcVal = crc32(Buffer.concat([typeBuf, data]), 0, typeBuf.length + data.length);
    writeU32(crcBuf, 0, crcVal);
    parts.push(lenBuf, typeBuf, data, crcBuf);
  }
  return Buffer.concat(parts);
}

function parseSIGFilter(raw, width, channels) {
  // undo PNG filter per scanline
  const stride = width * channels;
  const out = Buffer.alloc(raw.length - Math.ceil(raw.length / (stride + 1)));
  let inOff = 0, outOff = 0;
  const rows = Math.floor(raw.length / (stride + 1));
  for (let y = 0; y < rows; y++) {
    const filter = raw[inOff++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[inOff + x];
      const left = x < channels ? 0 : out[outOff + x - channels];
      const up = y === 0 ? 0 : out[outOff - stride + x];
      const upLeft = (x < channels || y === 0) ? 0 : out[outOff - stride + x - channels];
      let val;
      if (filter === 0) val = cur;
      else if (filter === 1) val = (cur + left) & 0xff;
      else if (filter === 2) val = (cur + up) & 0xff;
      else if (filter === 3) val = (cur + Math.floor((left + up) / 2)) & 0xff;
      else { // paeth
        const a = left, b = up, c = upLeft;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = (cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      out[outOff + x] = val;
    }
    inOff += stride; outOff += stride;
  }
  return out;
}

function applyFilter0(pixels) {
  // use filter type 0 (None) for all rows — simplest
  const rows = pixels.length;
  const out = Buffer.alloc(rows + Math.ceil(rows / pixels.length));
  // just prepend 0 byte per row
  return pixels; // we'll handle inline below
}

function stripBlackBackground(inPath, outPath) {
  const buf = fs.readFileSync(inPath);
  const chunks = parsePNG(buf);

  const ihdr = chunks.find(c => c.type === 'IHDR').data;
  const width = readU32(ihdr, 0);
  const height = readU32(ihdr, 4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];

  // colorType 2=RGB, 6=RGBA
  const inChannels = colorType === 6 ? 4 : 3;
  const outChannels = 4; // always RGBA out

  // concatenate IDAT
  const idatChunks = chunks.filter(c => c.type === 'IDAT');
  const compressed = Buffer.concat(idatChunks.map(c => c.data));
  const raw = zlib.inflateSync(compressed);

  // undo filter
  const stride = width * inChannels;
  const pixels = parseSIGFilter(raw, width, inChannels);

  // build RGBA output, replacing black/near-black with transparent
  const outPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inIdx = (y * width + x) * inChannels;
      const outIdx = (y * width + x) * 4;
      const r = pixels[inIdx], g = pixels[inIdx+1], b = pixels[inIdx+2];
      const a = inChannels === 4 ? pixels[inIdx+3] : 255;
      // threshold: black or near-black → transparent
      const isBlack = r < 40 && g < 40 && b < 40;
      outPixels[outIdx]   = r;
      outPixels[outIdx+1] = g;
      outPixels[outIdx+2] = b;
      outPixels[outIdx+3] = isBlack ? 0 : a;
    }
  }

  // build filtered raw with filter=0 per row
  const outStride = width * 4;
  const filteredBuf = Buffer.alloc(height * (outStride + 1));
  for (let y = 0; y < height; y++) {
    filteredBuf[y * (outStride + 1)] = 0; // filter None
    outPixels.copy(filteredBuf, y * (outStride + 1) + 1, y * outStride, (y+1) * outStride);
  }

  const newIdat = zlib.deflateSync(filteredBuf);

  // build new IHDR (force colorType=6 RGBA)
  const newIhdr = Buffer.from(ihdr);
  newIhdr[9] = 6; // RGBA
  newIhdr[8] = 8; // 8-bit

  const newChunks = [
    { type: 'IHDR', data: newIhdr },
    { type: 'IDAT', data: newIdat },
    { type: 'IEND', data: Buffer.alloc(0) },
  ];

  fs.writeFileSync(outPath, buildPNG(newChunks));
  console.log(`Saved transparent icon: ${outPath}`);
}

// ---- base64 encode all cat memes ----

const CAT_MEME_FILES = [
  'meMacatchill.webp',
  'meMacatclap.gif',
  'meMacatcry.gif',
  'meMaCatdance.gif',
  'meMacatdrive.webp',
  'meMacateating.gif',
  'meMAcatflash.gif',
  'meMacathappyhappy.gif',
  'meMacatmad.gif',
  'meMacatonkey.gif',
  'meMacatoverstimmilate.gif',
  'meMacatpunch.webp',
  'meMawarcat.gif',
];

function mimeType(filename) {
  if (filename.endsWith('.gif')) return 'image/gif';
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function friendlyName(filename) {
  return filename
    .replace(/^meMAcat|^meMacat|^meMaCat/i, '')
    .replace(/\.(gif|webp|png|jpg)$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
}

// Process icon
console.log('Stripping black background from cat pack icon...');
stripBlackBackground(ICON_IN, ICON_OUT);

// Encode icon
const iconData = fs.readFileSync(ICON_OUT);
const iconB64 = `data:image/png;base64,${iconData.toString('base64')}`;

// Encode memes
console.log('Encoding cat memes...');
const memeEntries = CAT_MEME_FILES.map(f => {
  const fpath = path.join(MEMES_DIR, f);
  if (!fs.existsSync(fpath)) { console.warn(`  MISSING: ${f}`); return null; }
  const data = fs.readFileSync(fpath);
  const b64 = `data:${mimeType(f)};base64,${data.toString('base64')}`;
  const name = friendlyName(f);
  console.log(`  encoded: ${f} (${name})`);
  return `{name:'${name}',src:'${b64}'}`;
}).filter(Boolean);

// Output JS snippet to paste into index.html
const output = {
  iconB64,
  packJS: `cat:[${memeEntries.join(',')}]`,
  packBtnHTML: `<button class="pack-btn" onclick="selectPack(this,'cat')" style="background:transparent;border:none;border-radius:50%;padding:0;overflow:hidden;width:200px;height:200px;cursor:pointer;transition:transform .2s,opacity .2s"><img src="${iconB64}" style="width:100%;height:100%;display:block;border-radius:50%;object-fit:cover"></button>`,
};

fs.writeFileSync(path.join(__dirname, 'cat-pack-output.json'), JSON.stringify({ packJS: output.packJS, packBtnHTML: output.packBtnHTML }, null, 0));
console.log('\nDone! Output written to tools/cat-pack-output.json');
console.log('Pack JS length:', output.packJS.length, 'chars');

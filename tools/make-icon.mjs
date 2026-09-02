// Generates a 1024x1024 source icon from a hand-placed 32x32 pixel grid.
// Dependency-free PNG encoder (zlib + raw scanlines) so this needs no image lib.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { crc32 as nodeCrc } from 'node:zlib';

const N = 32, SCALE = 32, W = N * SCALE;
const DARK = [0x28, 0x28, 0x28, 255];
const SKY  = [0xA9, 0xD8, 0xFF, 255];
const NONE = [0, 0, 0, 0];

const px = Array.from({ length: N }, () => Array.from({ length: N }, () => DARK));
const set = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N) px[y][x] = c; };
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };

// pixel-rounded corners: knock out 2px steps so it reads as a retro tile
for (const [cx, cy] of [[0,0],[N-1,0],[0,N-1],[N-1,N-1]]) {
  set(cx, cy, NONE);
  set(cx === 0 ? 1 : N-2, cy, NONE);
  set(cx, cy === 0 ? 1 : N-2, NONE);
}

// speech bubble (sky) with implicit dark border from the background
rect(4, 5, 27, 21, SKY);
// tail, stepping down-left
rect(7, 22, 12, 22, SKY);
rect(7, 23, 10, 23, SKY);
rect(7, 24, 8, 24, SKY);

// checkmark in dark on the sky bubble (dark on pastel, per the palette rule).
// 2px stroke: heavy enough to survive a 16x16 favicon, light enough to read.
const down = [[10,13],[11,14],[12,15],[13,16]];
const up   = [[14,15],[15,14],[16,13],[17,12],[18,11],[19,10],[20,9]];
for (const [x, y] of [...down, ...up]) rect(x, y, x + 1, y + 1, DARK);


// scale up + encode
const raw = Buffer.alloc((W * 4 + 1) * W);
let o = 0;
for (let y = 0; y < W; y++) {
  raw[o++] = 0; // filter: none
  const row = px[Math.floor(y / SCALE)];
  for (let x = 0; x < W; x++) {
    const c = row[Math.floor(x / SCALE)];
    raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2]; raw[o++] = c[3];
  }
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(nodeCrc(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2], png);
console.log('wrote', process.argv[2], png.length, 'bytes', W + 'x' + W);

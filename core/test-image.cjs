// Small synthetic fixture for capability probes; never captures the owner's screen.
const zlib = require('node:zlib');
function redPng() {
  const crc = (buffer) => {
    let n = 0xffffffff;
    for (const b of buffer) {
      n ^= b;
      for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type),
      length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([length, t, data, sum]);
  };
  const h = Buffer.alloc(13);
  h.writeUInt32BE(64, 0);
  h.writeUInt32BE(64, 4);
  h[8] = 8;
  h[9] = 2;
  const pixels = Buffer.alloc(64 * 193);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', h),
      chunk('IDAT', zlib.deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64')
  );
}
module.exports = { redPng };

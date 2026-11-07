'use strict';
// 图片：列表、读图（加密的 .png_ / .rpgmvp 解密后给浏览器）；视频（预览用）
const fs = require('fs');
module.exports = function (ctx) {
  const { project } = ctx;
  return {
    get: {
      images: (T, q) => ({ sub: q('sub'), names: project.listImages(q('sub') || 'pictures') }),
      img(T, q) {
        const img = project.loadImage(q('sub') || 'pictures', q('name') || '');
        if (!img) return { raw: { status: 404, type: 'text/plain; charset=utf-8', body: '找不到图片' } };
        return { raw: { status: 200, type: img.mime, headers: { 'cache-control': 'private, max-age=300', etag: img.stamp }, body: img.buf } };
      },
      // 视频（预览播放视频层插件用）：支持 Range，浏览器能边下边播、循环
      movie(T, q, req) {
        const f = project.findMovie(q('name') || '');
        if (!f) return { raw: { status: 404, type: 'text/plain; charset=utf-8', body: '找不到视频' } };
        const size = fs.statSync(f).size;
        const type = f.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
        const m = /^bytes=(\d*)-(\d*)$/.exec((req && req.headers.range) || '');
        if (m && (m[1] || m[2])) {
          let a = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
          let b = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (a >= size || a > b) return { raw: { status: 416, type: 'text/plain', headers: { 'content-range': `bytes */${size}` }, body: '' } };
          const buf = Buffer.alloc(b - a + 1);
          const fd = fs.openSync(f, 'r');
          try { fs.readSync(fd, buf, 0, buf.length, a); } finally { fs.closeSync(fd); }
          return { raw: { status: 206, type, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${size}`, 'cache-control': 'private, max-age=300' }, body: buf } };
        }
        return { raw: { status: 200, type, headers: { 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=300' }, body: fs.readFileSync(f) } };
      },
    },
    post: {},
  };
};

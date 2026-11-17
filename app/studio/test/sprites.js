'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 直接检查行走图生成逻辑，画布只接收生成的像素，不需要启动浏览器。
const ctx = vm.createContext({
  ImageData: class {
    constructor(width, height) { this.data = new Uint8ClampedArray(width * height * 4); }
  },
  document: {
    createElement() {
      const canvas = { getContext: () => ({ putImageData: image => { canvas.pixels = image.data; } }) };
      return canvas;
    },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/js/sprites.js'), 'utf8'), ctx);

function stand(scale, pose) {
  const width = 28 * scale, height = 32 * scale;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = y0 * scale; y < y1 * scale; y++) {
      for (let x = x0 * scale; x < x1 * scale; x++) {
        const i = (y * width + x) * 4;
        pixels.set([...color, 255], i);
      }
    }
  };
  rect(5, 0, 23, 19, [50, 50, 200]);
  if (pose === 'robe') {
    rect(5, 19, 23, 32, [190, 180, 175]);
    rect(13, 19, 15, 32, [25, 25, 25]);
  } else if (pose === 'staggered') {
    rect(9, 19, 15, 32, [93, 86, 62]);
    rect(15, 19, 20, 30, [33, 54, 32]);
    rect(14, 19, 15, 32, [31, 31, 31]);
    rect(15, 30, 16, 32, [31, 31, 31]);
  } else {
    rect(9, 19, 14, 32, [245, 95, 70]);
    rect(pose === 'touching' ? 14 : 16, 19, 20, 32, [70, 245, 95]);
    if (pose === 'touching') rect(14, 19, 15, 32, [20, 20, 20]);
    rect(2, 14, 4, 32, [20, 22, 255]);
  }
  return { cv: { width, height }, pixels, ...ctx.walkFootprint(pixels, width, height) };
}

function bottom(frame, channel) {
  const { width, height, pixels } = frame;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + channel] > 230) return y;
    }
  }
  return -1;
}

for (const scale of [1, 3]) {
  for (const pose of ['separate', 'touching']) {
    const b = stand(scale, pose);
    const { width, height } = b.cv;
    const feet = ctx.walkFeet(b, false);
    assert(feet, '有脚缝或两只靴子贴在一起，都应该能够分脚');
    for (const view of ['front', 'back']) {
      for (const leftStep of [true, false]) {
        const raised = Number(leftStep === (view === 'front'));
        const frame = ctx.stepFrame(b, view, leftStep, { lift: 3 }, feet);
        assert.equal(bottom(frame, raised), height - 4);
        assert.equal(bottom(frame, 1 - raised), height - 1);
        for (let y = 14 * scale; y < height; y++) {
          const start = (y * width + 2 * scale) * 4, end = (y * width + 4 * scale) * 4;
          assert.deepEqual(frame.pixels.subarray(start, end), b.pixels.subarray(start, end), '触地的道具保留原位');
        }
      }
    }
  }
  assert.equal(ctx.walkFeet(stand(scale, 'robe'), false), null, '长袍的暗褶皱不应生成双脚');
  const rear = stand(scale, 'staggered');
  const feet = ctx.walkFeet(rear, false);
  assert(feet, '鞋底错开时，应识别出深色靴子之间较淡的接缝');
  const onLeftStep = ctx.stepFrame(rear, 'back', true, { lift: 3 * scale }, feet);
  const sole = ((rear.cv.height - 1) * rear.cv.width + 15 * scale) * 4 + 3;
  assert.equal(onLeftStep.pixels[sole], 0, '抬起左脚时，鞋底越过接缝的细边也要一起抬起');
}
console.log('脚缝、贴合和错开的鞋形、触地道具及长袍识别：通过');

function avatar(view, holding = false) {
  const width = 60, height = 96;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const tone = [166, 220, 160, 255];
  const rect = (left, top, right, bottom, color) => {
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) pixels.set(color, (y * width + x) * 4);
    }
  };
  const shirt = [39, 50, 90, 255];
  rect(13, 0, 47, 45, shirt);
  if (view === 'front') rect(25, 29, 37, 42, tone);
  rect(18, 43, 43, 75, shirt);
  rect(22, 74, 29, 96, shirt);
  rect(32, 74, 39, 96, shirt);
  if (view === 'left') rect(28, 59, 35, 68, tone);
  else {
    rect(12, 59, 19, 68, tone);
    rect(42, 59, 49, 68, tone);
  }
  if (holding) rect(12, 31, 14, 88, [110, 68, 35, 255]);
  return { cv: { width, height }, pixels, ...ctx.walkFootprint(pixels, width, height) };
}

const handColors = ctx.walkFaceColors(avatar('front'));
for (const view of ['front', 'back', 'left']) {
  const b = avatar(view);
  const feet = ctx.walkFeet(b, view === 'left');
  const hands = ctx.walkHands(b, feet, view, handColors);
  assert.equal(hands.length, view === 'left' ? 1 : 2);
  const leftStep = ctx.stepFrame(b, view, true, { lift: 5, stride: 4, sideLift: 2, arm: 2 }, feet, hands);
  const rightStep = ctx.stepFrame(b, view, false, { lift: 5, stride: 4, sideLift: 2, arm: 2 }, feet, hands);
  const handPosition = (frame, from, to) => {
    let xTotal = 0, yTotal = 0, count = 0;
    for (let y = 54; y < 70; y++) for (let x = from; x < to; x++) {
      if (frame.pixels[(y * b.cv.width + x) * 4 + 1] !== 220) continue;
      xTotal += x; yTotal += y; count++;
    }
    return [xTotal / count, yTotal / count];
  };
  if (view === 'left') {
    assert(handPosition(rightStep, 20, 40)[0] < handPosition(leftStep, 20, 40)[0], '侧面露出的手随对侧脚往前摆');
    for (const frame of [leftStep, rightStep]) {
      for (let y = 59; y < 68; y++) for (let x = 18; x < 43; x++) {
        assert.equal(frame.pixels[(y * b.cv.width + x) * 4 + 3], 255, '摆开手后衣服仍连续');
      }
    }
  } else {
    const [from, to] = view === 'front' ? [0, 30] : [30, 60];
    assert(handPosition(leftStep, from, to)[1] < handPosition(rightStep, from, to)[1], '左脚迈步时右手摆向前');
  }
}
const withStaff = avatar('front', true);
const freeHands = ctx.walkHands(withStaff, ctx.walkFeet(withStaff, false), 'front', handColors);
assert.equal(freeHands.length, 1);
assert.equal(freeHands[0].sign, 1, '握住长物件的一侧应保持原姿势');
console.log('正背面双手、侧面可见手、持物兜底及摆臂方向：通过');

#!/usr/bin/env node
'use strict';
// 编辑框回归测试（只读，不保存）：
//   文本模式：着色层（pre）和输入框（textarea）必须一模一样地折行
//   规范模式：一行一块，打字、回车、插入选项 / 如果、折叠、选项条件，改的都是同一份文字
//   node studio/test/editor.js <游戏目录>        要装 playwright（npm i playwright && npx playwright install chromium）
// 对不齐的后果：看着在改这一行，字却进了上一行 / 下一行。以前输入框自己出滚动条，浏览器缩放不是 100% 时
// 滚动条宽度不是整数，两层差零点几个像素就会这样。这里在几种缩放、几种宽度下：
//   1. 塞几百行长短不一的字，比两层折出来的总高度
//   2. 在着色层上看到的某一行点一下、打一个字，看字是不是进了那一行
//   3. 在最后连按回车、粘贴一大段：输入框自己不能滚（滚的是外框），两层高度一直一样
const path = require('path');
const os = require('os');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('要先装 playwright：npm i playwright && npx playwright install chromium'); process.exit(2); }
const { createStudio } = require('../handler.js');

const dir = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!dir) { console.error('用法：node studio/test/editor.js <游戏目录>'); process.exit(2); }
const studio = createStudio({ gameDir: path.resolve(dir), readOnly: true, settingsFile: path.join(os.tmpdir(), 'studio-test-settings.json'), backupsDir: path.join(os.tmpdir(), 'studio-test-backups') });

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const CH = '一二三四五六七八九十的了是我你他她们这那里在有个好感度医务室传送变量abcdefghijklmnopqrstuvwxyz ilI.,;:!0123456789「」：，。≥■│';
const MANY = Array.from({ length: 300 }, () => { let n = 10 + Math.floor(rnd() * 60), s = ''; while (n--) s += CH[Math.floor(rnd() * CH.length)]; return s; }).join('\n');
const BASES = ['│ │■ 如果 变量 107「SayakaRivalAffection」 ≥ ', '│ │ │#变量 沙耶好感度40医务室2 = ', '圣佳：我本来以为今天会很平常，结果在医务室门口碰到了马库斯，他拉开帘子', '│ #传送 纱耶、凪、枫的房间 12 10 朝下 ', '马库斯：Hey, what are you doing here? 你怎么在这里……\\N[3] 也在吗', '│ │■ 选了「<<[!s[24]]>>\\N[8] Wallpaper」'];
const STORY = Array.from({ length: 60 }, (_, k) => BASES[k % BASES.length] + '一二三四五六七八九十abcdefghij０１２３４５６７８９'.slice(0, (k * 7) % 40) + (k % 3 ? ' 0' : '')).join('\n');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

(async () => {
  const srv = http.createServer((req, res) => studio.handle(req, res).then(h => { if (!h) { res.writeHead(404); res.end(); } }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const list = await (await fetch(base + '/api/studio/ces')).json();
  let ce = 0;
  for (const c of list.ces || []) { const v = await (await fetch(base + '/api/studio/ce?id=' + c.id)).json(); if (v.script && v.script.editable) { ce = c.id; break; } }
  if (!ce) { console.error('这个游戏里没有能用编辑框改的公共事件'); process.exit(2); }

  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });   // 要有真的滚动条
  const open = async (zoom, width) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1.25 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(base + '/studio#/ce/' + ce);
    await page.waitForSelector('.modebar');
    await page.click('.modebar [data-m="edit"]');
    await page.waitForSelector('.edmode [data-mode="text"]');
    await page.click('.edmode [data-mode="text"]');
    await page.waitForSelector('.editor textarea');
    await page.addStyleTag({ content: `.editor{width:${width}px!important}` });
    if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom);
    page.errs = errs;
    return page;
  };
  const setText = (page, t) => page.evaluate(t => { const ta = document.querySelector('.editor textarea'); ta.value = t; ta.dispatchEvent(new Event('input')); }, t);
  const heights = page => page.evaluate(() => { const w = document.querySelector('.editor'), ta = w.querySelector('textarea'), pre = w.querySelector('pre'); return { ta: ta.scrollHeight, pre: Math.max(pre.offsetHeight, 340), taScroll: ta.scrollTop, plain: w.classList.contains('plain') }; });

  // 1. 总高度
  for (const z of [1, 0.9, 1.1, 1.25, 0.8, 1.5, 0.67]) for (const w of [380, 457, 533]) {
    const page = await open(z, w);
    await setText(page, MANY);
    await page.waitForTimeout(150);
    const h = await heights(page);
    ok(Math.abs(h.ta - h.pre) < 10 && !h.plain, `缩放 ${z}、宽 ${w}：两层高度 ${h.ta} / ${h.pre}${h.plain ? '（关了颜色）' : ''}`);
    ok(!page.errs.length, '页面报错：' + page.errs.join(' | '));
    await page.close();
  }
  // 2. 点着色层上的那一行打字
  for (const [w, z] of [[360, 1], [430, 1.1], [360, 1.25], [520, 0.9]]) {
    const page = await open(z, w);
    await setText(page, STORY);
    await page.waitForTimeout(150);
    for (const i of [3, 15, 28, 41, 53, 59]) {
      const pt = await page.evaluate(i => {
        const box = document.querySelector('.editor'), pre = box.querySelector('pre'), ta = box.querySelector('textarea');
        const end = ta.value.split('\n').slice(0, i + 1).join('\n').length;   // 这一行行尾
        const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        let n, left = end;
        while ((n = walker.nextNode())) { if (left <= n.length) break; left -= n.length; }
        const r = document.createRange(); r.setStart(n, Math.max(0, left - 1)); r.setEnd(n, left);
        const last = () => { const rs = r.getClientRects(); return rs[rs.length - 1]; };
        box.scrollIntoView({ block: 'center' });
        box.scrollTop += last().top - box.getBoundingClientRect().top - box.clientHeight / 2;
        const rc = last();
        if (rc.bottom > innerHeight) window.scrollBy(0, rc.bottom - innerHeight + 40);
        const rc2 = last();
        return { x: rc2.left + rc2.width / 2, y: rc2.top + rc2.height / 2 };
      }, i);
      await page.mouse.click(pt.x, pt.y);
      await page.keyboard.type('Q');
      const at = await page.evaluate(() => document.querySelector('.editor textarea').value.split('\n').findIndex(l => l.includes('Q')));
      ok(at === i, `缩放 ${z}、宽 ${w}：点第 ${i + 1} 行打字，字进了第 ${at + 1} 行`);
      await setText(page, STORY);
    }
    await page.close();
  }
  // 3. 回车、粘贴
  {
    const page = await open(1.1, 420);
    await setText(page, STORY);
    await page.evaluate(() => { const ta = document.querySelector('.editor textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    let worst = 0;
    for (let i = 0; i < 20; i++) { await page.keyboard.press('Enter'); await page.keyboard.type('第' + i + '行'); const h = await heights(page); worst = Math.max(worst, h.taScroll, Math.abs(h.ta - h.pre)); }
    ok(worst < 2, '连按回车：输入框自己滚了 / 两层高度差了 ' + worst);
    await page.keyboard.insertText(Array.from({ length: 50 }, (_, i) => '粘贴的第' + i + '行').join('\n'));
    const h = await heights(page);
    ok(h.taScroll === 0 && Math.abs(h.ta - h.pre) < 2, '粘贴一大段以后 ' + JSON.stringify(h));
    const wrapScroll = await page.evaluate(() => document.querySelector('.editor').scrollTop);
    ok(wrapScroll > 0, '粘贴到后面：外框跟着光标滚下去了');
    await page.close();
  }
  // 4. 规范模式
  {
    const page = await open(1, 900);
    const T0 = ['林屿：第一句', '＋第二行', '■ 选项（2 个）：甲 / 乙', '■ 选了「<<[!s[1]]>>甲」', '│ 林屿：选了甲', '│ #传送 1 3 4 朝上', '■ 选了「乙」', '│ 林屿：选了乙', '■ 选项结束', '#变量 1 = 2'].join('\n');
    await setText(page, T0);
    await page.click('.edmode [data-mode="blocks"]');
    await page.waitForSelector('#blocks .bk');
    const text = () => page.$eval('.editor textarea', t => t.value);
    const kinds = await page.$$eval('#blocks .bk', els => els.map(e => [...e.classList].find(c => c.startsWith('bk-') && c !== 'bk-k')));
    ok(JSON.stringify(kinds) === JSON.stringify(['bk-say', 'bk-more', 'bk-chead', 'bk-branch', 'bk-say', 'bk-cmd', 'bk-branch', 'bk-say', 'bk-end', 'bk-cmd']), '规范模式一行一块：' + kinds.join(' '));
    ok(await page.$eval('.bk-cmd .chip', e => e.classList.contains('c-tp') && /\(3, 4\)/.test(e.textContent)), '传送是蓝色按钮，写着去哪一格');
    ok(!(await page.$('.bk-condbox')), '选项的条件默认收起');
    await page.click('.bk-branch .cond-pill');
    await page.waitForSelector('.bk-condbox b');
    ok(/开关 1.*为开/.test(await page.$eval('.bk-condbox', e => e.textContent)), '点「条件」展开：要满足开关 1 为开');
    // 只展开选项 2
    await page.click('.bk-chead .opt-pill:nth-child(2)');
    const hiddenSay = await page.$$eval('#blocks .bk[hidden]', els => els.map(e => e.textContent));
    ok(hiddenSay.some(t => /选了甲/.test(t)) && !hiddenSay.some(t => /选了乙/.test(t)), '点「2 乙」：只展开选项 2');
    // 打字、回车
    await page.click('.bk-say .bk-text');
    await page.keyboard.press('End');
    await page.keyboard.type('呀');
    await page.keyboard.press('Enter');
    await page.keyboard.type('第三句');
    ok(/林屿：第一句呀\n＋第二行\n林屿：第三句/.test(await text()), '改台词、回车 = 下一句同一个人');
    // 选中选项 2，插一组新选项 → 在选项 2 里面；选中新选项的「选项 1」再插如果 → 不许
    const br = await page.$$('.bk-branch');
    await (await br[1].$('.bk-tag')).click();
    await page.click('#insChoice');
    await page.waitForSelector('dialog[open] .cbrow input');
    const ins = await page.$$('dialog[open] .cbrow input');
    await ins[0].fill('左'); await ins[1].fill('右');
    await page.click('dialog[open] [data-ok]');
    await page.waitForTimeout(150);
    ok(/■ 选了「乙」\n│ #选项 左 \| 右\n│ #1\n│ #2\n│ 林屿：选了乙/.test(await text()), '选中选项 2 再插选项：插在它里面');
    // 撤销
    await page.click('#blkUndo');
    ok(!/#选项 左/.test(await text()), '撤销');
    // 删一行
    const cmd = await page.$('.bk-cmd:last-child');
    await cmd.hover();
    await page.click('.bk-cmd:last-child [data-act="del"]');
    ok(!/#变量 1 = 2/.test(await text()), '删掉一行');
    // 切回文本模式：文字一样
    await page.click('.edmode [data-mode="text"]');
    ok(await page.$eval('.editor', e => !e.hidden), '切回文本模式');
    ok(!page.errs.length, '规范模式页面报错：' + page.errs.join(' | '));
    await page.close();
  }
  await browser.close();
  srv.close();
  if (fails.length) { console.log(`✖ ${fails.length} 项没过（${pass} 项通过）`); for (const f of fails) console.log('  ' + f); process.exit(1); }
  console.log(`全部通过（${pass} 项）`);
})().catch(e => { console.error(e); process.exit(1); });

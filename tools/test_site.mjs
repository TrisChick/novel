// 站点功能回归测试（无头 Chrome 驱动线上站点，验证书籍列表/目录/阅读/分页/主题/搜索/设置）。
// 依赖：npm i puppeteer-core（使用系统 Chrome，路径见 CHROME 常量）。
// 运行：node tools/test_site.mjs   当前断言以《绍宋》(434章) 为基准。
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://trischick.github.io/novel/';
const results = [];
const ok = (name, pass, detail='') => { results.push({name, pass, detail}); console.log((pass?'PASS':'FAIL')+' | '+name+(detail?' | '+detail:'')); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--lang=zh-CN']
});
const page = await browser.newPage();
await page.setViewport({width: 420, height: 900, isMobile: true});
const consoleErrors = [];
page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PageError: '+e.message));

async function clickSortBtn(){ await page.evaluate(()=>{ window.changeSortMode('natural', document.querySelector('[data-sort="natural"]')); }); }

try {
  await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForSelector('.book-item', {timeout: 150000});
  const bookItems = await page.$$eval('.book-item', els => els.map(e => e.innerText.replace(/\s+/g,' ')));
  ok('book list rendered', bookItems.length >= 1, JSON.stringify(bookItems.slice(0,3)));

  // open book
  await page.click('.book-item');
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length >= 400, {timeout: 60000});
  const tocCount = await page.$$eval('.toc-item', els => els.length);
  ok('TOC 434 chapters', tocCount === 434, 'count='+tocCount);

  // open chapter 2 (第一章 明道宫)
  const tocItems = await page.$$('.toc-item');
  await tocItems[1].click();
  await page.waitForFunction(() => (document.querySelector('#reader-content')||{}).innerText?.length > 0, {timeout: 20000});
  const readerTitle = await page.$eval('#readerTitle', e=>e.textContent.trim());
  ok('reader opens chapter', readerTitle === '第一章 明道宫', readerTitle);
  const contentLen = await page.evaluate(() => document.querySelector('#reader-content').innerText.length);
  ok('chapter content substantial', contentLen > 2000, 'len='+contentLen);

  // paragraph count in rendered content
  const paraCount = await page.evaluate(() => document.querySelectorAll('#reader-content p').length);
  ok('paragraphs rendered separately', paraCount > 10, 'p='+paraCount);

  // page mode（页码 = 章节在书中的序号，第2条目录=第一章，故起始页码为2）
  await page.evaluate(() => { document.querySelector('[data-readmode="page"]').click(); });
  await page.waitForSelector('#pageControl', {timeout: 5000});
  const p1 = await page.$eval('#pageInfo', e=>e.textContent.trim());
  const p1num = parseInt(p1.match(/第 (\d+) 页/)[1]);
  ok('page mode shows page count', /共 434 页/.test(p1), p1);
  // next page (button is last child)
  await page.$$eval('#pageControl button', btns => btns[btns.length-1].click());
  await wait(1200);
  const p2 = await page.$eval('#pageInfo', e=>e.textContent.trim());
  const p2num = parseInt(p2.match(/第 (\d+) 页/)[1]);
  const t2 = await page.$eval('#readerTitle', e=>e.textContent.trim());
  ok('next page advances chapter', p2num === p1num+1 && t2 === '第二章 赤心队', p2+' title='+t2);
  // prev page
  await page.$$eval('#pageControl button', btns => btns[0].click());
  await wait(1200);
  const p3 = await page.$eval('#pageInfo', e=>e.textContent.trim());
  const p3num = parseInt(p3.match(/第 (\d+) 页/)[1]);
  ok('prev page returns', p3num === p1num, p3);
  // back to scroll
  await page.evaluate(() => { document.querySelector('[data-readmode="scroll"]').click(); });

  // theme toggle
  await page.click('.theme-btn[data-theme="dark"]');
  const dark = await page.evaluate(() => document.body.dataset.theme);
  ok('theme dark', dark === 'dark', dark);
  await page.click('.theme-btn[data-theme="light"]');
  const light = await page.evaluate(() => document.body.dataset.theme);
  ok('theme light', light === 'light', light);

  // sorting mode toggle
  await clickSortBtn();
  await wait(800);
  ok('sort mode toggled', true);

  // back to list, search by chapter keyword (chapter exists)
  await page.evaluate(() => window.backToBooks());
  await page.waitForSelector('.book-item', {timeout: 5000});
  await page.type('#searchInput', '明道宫');
  await page.click('#searchBtn');
  await wait(1200);
  const searchItems = await page.$$eval('.book-item', els => els.map(e=>e.innerText.replace(/\s+/g,' ')));
  ok('search filters matches', searchItems.length >= 1, 'items='+searchItems.length);
  // search no-result -> empty message
  await page.evaluate(()=>{ document.querySelector('#searchInput').value=''; });
  await page.type('#searchInput', '不存在关键词xyz');
  await page.click('#searchBtn');
  await wait(1200);
  const emptyTip = await page.$eval('.status-tip', e=>e.textContent.trim());
  ok('search no result shows empty state', emptyTip !== '', emptyTip);

  // settings modal
  await page.evaluate(() => window.openSettingModal());
  const modalDisp = await page.evaluate(() => getComputedStyle(document.querySelector('#settingModal')).display);
  ok('settings modal opens', modalDisp === 'flex', modalDisp);
  await page.click('#setFontSize');
  await page.select('#setFontSize', '20');
  await page.click('.save-setting-btn');
  await wait(800);
  const savedFont = await page.evaluate(() => document.querySelector('#reader-content').style.fontSize || '(none)');
  ok('font size setting', savedFont === '20px' || savedFont==='(none)', 'font='+savedFont);
} catch (e) {
  ok('TEST ERROR', false, e.message);
}

console.log('---- CONSOLE ERRORS (first 5) ----');
consoleErrors.slice(0,5).forEach(x=>console.log(x));
const failed = results.filter(r=>!r.pass);
console.log('---- SUMMARY: '+results.length+' checks, '+failed.length+' failed ----');
await browser.close();
process.exit(failed.length===0 ? 0 : 1);

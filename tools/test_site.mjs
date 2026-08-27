// 站点功能回归测试（无头 Chrome 驱动线上站点）。
// 覆盖：首页书籍列表 -> 详情页(目录) -> 阅读页(章节正文) 的页面跳转，
//       阅读页 上一章/目录/下一章、设置(字号/行距/页边距)、主题切换、首页搜索。
// 依赖：npm i puppeteer-core（使用系统 Chrome，路径见 CHROME 常量）。
// 运行：node tools/test_site.mjs   当前断言以《绍宋》(434 章) 为基准。
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HOME = 'https://trischick.github.io/novel/index.html';
const results = [];
const ok = (name, pass, detail='') => { results.push({name, pass, detail}); console.log((pass?'PASS':'FAIL')+' | '+name+(detail?' | '+detail:'')); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--lang=zh-CN']
});
const page = await browser.newPage();
await page.setViewport({width: 420, height: 900, isMobile: true});
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PageError: '+e.message));

async function waitUrl(suffix){ await page.waitForFunction(s => location.pathname.endsWith(s), {timeout:30000}, suffix); }

try {
  await page.goto(HOME, {waitUntil:'domcontentloaded', timeout:60000});
  await page.waitForSelector('.book-item', {timeout:60000});
  let books = await page.$$eval('.book-item', els => els.map(e=>e.innerText.replace(/\s+/g,' ')));
  ok('home book list', books.length>=1, JSON.stringify(books.slice(0,3)));
  ok('home shows 绍宋 434章', books[0].includes('绍宋') && books[0].includes('共 434 章'), books[0]);

  const navBtns = await page.$$eval('.nav-actions button', els=>els.map(e=>e.textContent.trim()));
  ok('nav has theme+settings', navBtns.length===2, 'nav='+JSON.stringify(navBtns));
  ok('no sort-mode buttons on home', await page.$('[data-sort]')===null && await page.$('.mode-switch')===null, '');

  await Promise.all([ waitUrl('detail.html'), page.click('.book-item') ]);
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length >= 400, {timeout:30000});
  const detailTitle = await page.$eval('#detailTitle', e=>e.textContent.trim());
  const tocCount = await page.$$eval('.toc-item', els=>els.length);
  const firstToc = await page.$eval('.toc-item', e=>e.textContent.trim());
  ok('detail title', detailTitle==='绍宋', detailTitle);
  ok('detail TOC 434', tocCount===434, 'count='+tocCount);
  ok('detail first chapter', firstToc==='内容简介', firstToc);
  ok('detail URL has book param', page.url().includes('book='), page.url());

  await page.$$eval('.toc-item', els => els[1].click());
  await page.waitForFunction(() => document.body.dataset.page==='reader' && (document.querySelector('#reader-content')||{}).innerText?.length>0, {timeout:30000});
  const readTitle = await page.$eval('#readerTitle', e=>e.textContent.trim());
  const pageInfo = await page.$eval('#pageInfo', e=>e.textContent.trim());
  const contentLen = await page.evaluate(()=>document.querySelector('#reader-content').innerText.length);
  ok('reader opens chapter', readTitle==='第一章 明道宫', readTitle);
  ok('reader pageInfo 第2/共434', pageInfo==='第 2 章 / 共 434 章', pageInfo);
  ok('reader content single-chapter', contentLen>1000 && contentLen<20000, 'len='+contentLen);
  const paraCount = await page.evaluate(()=>document.querySelectorAll('#reader-content p').length);
  ok('reader paragraphs rendered', paraCount>10, 'p='+paraCount);
  ok('reader URL has book+ch', page.url().includes('book=') && page.url().includes('ch='), page.url());

  const prevDisabled = await page.$eval('#prevChBtn', e=>e.disabled);
  const nextDisabled = await page.$eval('#nextChBtn', e=>e.disabled);
  ok('prev enabled (000 exists)', prevDisabled===false, 'prevDisabled='+prevDisabled);
  ok('next enabled', nextDisabled===false, 'nextDisabled='+nextDisabled);

  await Promise.all([ waitUrl('reader.html'), page.click('#nextChBtn') ]);
  await page.waitForFunction(() => (document.querySelector('#reader-content')||{}).innerText?.length>0, {timeout:30000});
  const t2 = await page.$eval('#readerTitle', e=>e.textContent.trim());
  ok('next chapter works', t2==='第二章 赤心队', t2);

  await Promise.all([ waitUrl('detail.html'), page.click('#tocBtn') ]);
  await page.waitForFunction(() => document.querySelectorAll('.toc-item').length>=400, {timeout:30000});
  ok('toc button back to detail', (await page.$eval('#detailTitle',e=>e.textContent.trim()))==='绍宋', '');

  await page.goto('https://trischick.github.io/novel/reader.html?book='+encodeURIComponent('绍宋')+'&ch=001.txt', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => (document.querySelector('#reader-content')||{}).innerText?.length>0, {timeout:30000});
  await page.evaluate(()=>window.openSettingModal());
  const modalDisp = await page.evaluate(()=>getComputedStyle(document.querySelector('#settingModal')).display);
  ok('settings modal opens', modalDisp==='flex', modalDisp);
  await page.select('#setFontSize','20');
  await page.select('#setPageMargin','40');
  await page.click('.save-setting-btn');
  await wait(600);
  const font20 = await page.evaluate(()=>document.querySelector('#reader-content').style.fontSize);
  const pad40 = await page.evaluate(()=>document.querySelector('#reader-content').style.paddingLeft);
  ok('font size applies', font20==='20px', font20);
  ok('page margin applies', pad40==='40px', pad40);

  const themeBtnLabel0 = await page.$eval('#themeBtn', e=>e.textContent.trim());
  await page.click('#themeBtn');
  const themeDark = await page.evaluate(()=>document.body.dataset.theme);
  const themeBtnLabel1 = await page.$eval('#themeBtn', e=>e.textContent.trim());
  ok('theme toggles dark', themeDark==='dark', 'label '+themeBtnLabel0+' -> '+themeBtnLabel1);
  await page.click('#themeBtn');
  const themeLight = await page.evaluate(()=>document.body.dataset.theme);
  ok('theme toggles light', themeLight==='light', themeLight);

  await page.goto(HOME, {waitUntil:'domcontentloaded'});
  await page.waitForSelector('.book-item', {timeout:60000});
  await page.type('#searchInput','绍宋');
  await page.click('#searchBtn');
  await wait(700);
  const vis = await page.$$eval('.book-item', els=>els.filter(e=>e.style.display!=='none').length);
  ok('search filters book', vis===1, 'visible='+vis);
} catch (e) {
  ok('TEST ERROR', false, e.message);
}

console.log('---- CONSOLE ERRORS (first 5) ----');
errs.slice(0,5).forEach(x=>console.log(x));
const failed = results.filter(r=>!r.pass);
console.log('---- SUMMARY: '+results.length+' checks, '+failed.length+' failed ----');
await browser.close();
process.exit(failed.length===0?0:1);

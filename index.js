const { default: start } = require('./start.js');
const { createClient } = require("redis");
// const puppeteer = require('puppeteer-extra');
const puppeteer = require('puppeteer-core');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require("node:fs");
const xlsx = require('node-xlsx').default;

(async () => {

  const filename = "河海大学电气学院";
  const url = "https://dqxy.ahu.edu.cn/6130/list.htm";
  const selector = ".wp_articlecontent a";
  const button = "middle";
  const next_page_element = null;

  const client = await createClient()
    .on('error', err => console.log('Redis Client Error', err))
    .connect();


  // puppeteer.use(StealthPlugin());
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ignoreHTTPSErrors: true,
    useAutomationExtension: false,
    args: [ "--no-sandbox", "--disable-setuid-sandbox" ],
  },);

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    delete navigator.__proto__.webdriver;
  });
  await page.evaluateOnNewDocument(() => {
    const newProto = navigator.__proto__;
    delete newProto.webdriver;
    navigator.__proto__ = newProto;
  });
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3");

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if(req.resourceType() === 'image'){
      req.abort();
    }else {
      req.continue();
    }
  });

  browser.on('targetcreated', async e => {
    console.log(e.url());

    if (e.url()) {
      if (e.url().startsWith(url) || e.url() === 'about:blank') {
        try {
          const page1 = await e.page();
          await page1.waitForNetworkIdle();
          await page1.close();
        } catch (e) {
          // console.error(e);
        }
        // 一般来说只有 # 跳转才会出现当前页面开头一致
        await client.del("latest")
        return;
      }
      const page1 = await e.page();
      if (page1) {
        try {
          const latest_name = await client.get("latest");
          await client.lPush("mapped", JSON.stringify({ url: e.url(), name: latest_name }));

          // await page1.waitForNetworkIdle();
          // await new Promise(resolve => setTimeout(resolve, 1500));
          // const content = await page1.evaluate(() => document.body.innerText)
          // await client.set(e.url(), content);
          await client.del("latest")
          await page1.close();
        } catch (e) {
          console.error(e);
        }

      }
    }
  });

  await start({ page, client, url, selector, button, next_page_element });

  await new Promise(resolve => setTimeout(resolve, 3000));

  browser.removeAllListeners('targetcreated');
  await build_data(browser, client, filename);

  await browser.close()

})()
  .then(() => console.log('Script complete!'))
  .catch((err) => console.error('Error running script' + err));


async function build_data(browser, client, filename) {
  const mapping = await client.lRange("mapped", 0, -1)

  const email_regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gm

  const users = [];
  let context = await browser.createBrowserContext();
  const promise_tasks = [];
  let i = 0;
  for (let map of mapping) {
    const user = [];
    users.push(user);

    const { url, name } = JSON.parse(map);
    user.push(name);
    // const content = await client.get(url);
    // await client.del(url);
    promise_tasks.push(context.newPage().then(async page => {
      await page.evaluateOnNewDocument(() => {
        delete navigator.__proto__.webdriver;
      });
      await page.evaluateOnNewDocument(() => {
        const newProto = navigator.__proto__;
        delete newProto.webdriver;
        navigator.__proto__ = newProto;
      });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3");
      page.setDefaultNavigationTimeout(0);
      page.setDefaultTimeout(0);
      page.once('dialog', dialog => {
        console.log(dialog.message());
        console.log("Dismissing " + dialog.type());
        dialog.dismiss();
      });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if(req.resourceType() == 'stylesheet' || req.resourceType() == 'font' || req.resourceType() == 'image'){
          // page.evaluate(() => {
          //   [...document.getElementsByTagName('img')].forEach(e => e.onerror = null)
          // })
          req.abort();
        }else {
          req.continue();
        }
      });
      const response = await page.goto(url);
      try {
        await Promise.any([
          page.waitForNetworkIdle(),
          new Promise(resolve => setTimeout(resolve, 5000))
        ])

        const content = await page.evaluate(() => document.body.innerText);

        await page.close();
        if (content) {
          const email = content.match(email_regex)
          if (email && email.length > 0) {
            user.push(email[0]);
            user.push(url);
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }


      user.push(null);
      user.push(url);
    }));

    if (++i % 20 === 0) {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  await Promise.all(promise_tasks);
  await context.close();

  await client.del("mapped");
  const buffer = xlsx.build([ { name: 'sheet1', data: users } ]);
  fs.writeFileSync(`${ filename }.xlsx`, buffer);
}

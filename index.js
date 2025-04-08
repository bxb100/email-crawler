const { default: start } = require('./start.js');
const { createClient } = require("redis");
// const puppeteer = require('puppeteer-extra');
const puppeteer = require('puppeteer-core');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require("node:fs");
const xlsx = require('node-xlsx').default;

(async () => {

	const filename = "储运与建筑工程学院";
	const url = "https://cj.upc.edu.cn/szdw/list.htm";
	const selector = "#teacherBox li";
	const button = "middle";
	const next_page_element = null;

	const client = await createClient()
		.on('error', err => console.log('Redis Client Error', err))
		.connect();

	// puppeteer.use(StealthPlugin());

	const browser = await puppeteer.launch({
		headless: true,
		executablePath: puppeteer.executablePath('chrome'),
		ignoreHTTPSErrors: true,
		args: [ "--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox", '--disable-infobars', '--window-position=0,0', '--ignore-certificate-errors', '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", ],
	},);

	let homepage_context = await browser.createBrowserContext();
	const page = await homepage_context.newPage();
	await page_inject(page);

	homepage_context.on('targetcreated', async e => {
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
					await client.zAdd("mapped", {
						score: 0, value: JSON.stringify({ url: e.url(), name: latest_name })
					});
					await client.del("latest")
					await page1.close();
				} catch (e) {
					console.error(e);
				}

			}
		}
	});

	await start({ page, client, url, selector, button, next_page_element });
	await homepage_context.close();

	await build_data(browser, client, filename);

	await browser.close();
	await client.disconnect();

})()
	.then(() => console.log('Script complete!'))
	.catch((err) => console.error('Error running script' + err))
	.finally(() => process.exit());

async function build_data(browser, client, filename) {
	const email_regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gm
	const users = [];

	const mapping = await client.zRange("mapped", 0, -1)
	let context = await browser.createBrowserContext();

	let promise_tasks = [];
	let i = 0;


	for (let map of mapping) {
		const user = [];
		users.push(user);

		const { url, name } = JSON.parse(map);
		user.push(name);

		promise_tasks.push(new Promise(async (resolve) => {
			let content = await client.get(url);
			if (!content) {
				try {
					const page = await context.newPage();
					page.setDefaultNavigationTimeout(0);
					page.setDefaultTimeout(0);
					await page_inject(page);
					await page.goto(url, { waitUntil: 'networkidle0', timeout: 13000 });
					await new Promise(resolve => setTimeout(resolve, 3000));

					content = await page.$eval("body", el => el.innerText);
					const md = await fetchAndProcessPage(page);
					await client.set(url, md);
					await page.close();
				} catch (e) {
					console.error(e);
				}
			}

			if (content) {
				const email = content.match(email_regex)
				if (email && email.length > 0) {
					user.push(email[0]);
				} else {
					user.push(null);
				}
				const department = content.match(/当前位置：首页\s*(.+)/gm);
				if (department && department.length > 0) {
					user.push(department[0].replace(/当前位置：首页/g, "").trim());
				}else {
					user.push(null);
				}

				user.push(url);
				resolve()
				return;
			}
			user.push(null);
			user.push(null);
			user.push(url);
			resolve()
		}))

    if (++i % 20 === 0) {
      await Promise.all(promise_tasks);
      promise_tasks = [];
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  await Promise.all(promise_tasks);
  await context.close();

  await client.del("mapped");
  const buffer = xlsx.build([ { name: 'sheet1', data: users } ]);
  fs.writeFileSync(`${ filename }.xlsx`, buffer);
}

async function page_inject(page) {
	await page.evaluateOnNewDocument(() => {
		delete navigator.__proto__.webdriver;
	});
	await page.evaluateOnNewDocument(() => {
		const newProto = navigator.__proto__;
		delete newProto.webdriver;
		navigator.__proto__ = newProto;
	});
	await page.evaluateOnNewDocument(() => {
		[ ...document.getElementsByTagName('img') ].forEach(i => i.onerror = null);
	});
	page.once('dialog', dialog => {
		console.log(dialog.message());
		console.log("Dismissing " + dialog.type());
		dialog.dismiss();
	});
	await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3");
	await page.setRequestInterception(true);
	page.on('request', (req) => {
		if (req.resourceType() === 'font' || req.resourceType() === 'image') {
			req.abort();
		} else {
			req.continue();
		}
	});
	return page;
}

async function fetchAndProcessPage(page, enableDetailedResponse) {
	return await page.evaluate((enableDetailedResponse) => {
		function extractArticleMarkdown() {
			const readabilityScript = document.createElement('script');
			readabilityScript.src = 'https://unpkg.com/@mozilla/readability/Readability.js';
			document.head.appendChild(readabilityScript);

			const turndownScript = document.createElement('script');
			turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
			document.head.appendChild(turndownScript);

			let md = 'no content';

      // Wait for the libraries to load
      md = Promise.all([
        new Promise((resolve) => (readabilityScript.onload = resolve)),
        new Promise((resolve) => (turndownScript.onload = resolve)),
      ]).then(() => {
        // Readability instance with the current document
        const reader = new Readability(document.cloneNode(true), {
          charThreshold: 0,
          keepClasses: true,
          nbTopCandidates: 500,
        });

				// Parse the article content
				const article = reader.parse();

				// Turndown instance to convert HTML to Markdown
				const turndownService = new TurndownService();

				let documentWithoutScripts = document.cloneNode(true);
				documentWithoutScripts.querySelectorAll('script').forEach((browserItem) => browserItem.remove());
				documentWithoutScripts.querySelectorAll('style').forEach((browserItem) => browserItem.remove());
				documentWithoutScripts.querySelectorAll('iframe').forEach((browserItem) => browserItem.remove());
				documentWithoutScripts.querySelectorAll('noscript').forEach((browserItem) => browserItem.remove());

				// article content to Markdown
				const markdown = turndownService.turndown(enableDetailedResponse ? documentWithoutScripts : article.content);

				return markdown;
			});

			return md;
		}

		return extractArticleMarkdown();
	}, enableDetailedResponse);
}

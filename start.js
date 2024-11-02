"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = async ({ page, client, url, selector, button = 'middle', next_page_element }) => {

  await page.goto(url, { waitUntil: 'networkidle0' });

  await handle(page, client, selector, button, null);
  if (next_page_element) {
    await handle_next_page(page, client, selector, button, next_page_element);
  }

  await page.close();
};


async function handle_next_page(page, client, selector, button, next_page_element) {
  const next_page = await page.$(next_page_element)
  if (next_page) {
    const innerText = await page.evaluate(() => document.body.innerText);

    next_page.click();

    try {
      await handle(page, client, selector, button, innerText);
      await handle_next_page(page, client, selector, button, next_page_element);
    } catch (e) {
      console.log(e.message);
    }
  }
}

async function handle(page, client, selector, button, page_hash) {
  await page.waitForNetworkIdle();
  await page.waitForSelector(selector);

  if (page_hash) {
    const innerText = await page.evaluate(() => document.body.innerText);

    if (page_hash === innerText) {
      throw new Error('Duplicate page');
    }
  }

  const elements = await page.$$(selector)
  let options = {
    button
  };
  for (let element of elements) {
    if (await element.isVisible()) {
      let name = await page.evaluate(el => el.innerText.replace(/(\p{Script=Hani})\s+(?=\p{Script=Hani})/gu, '$1'), element);
      name = name.trim();
      if (!name) {
        continue;
      }
      await client.set('latest', name);
      try {
        await element.click(options);
        const now = process.hrtime.bigint();
        while (await client.get('latest')) {
          // 10s
          if (process.hrtime.bigint() - now > 10000000000) {
            console.log('Timeout', name);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (e) {
        console.error(e);
      }
    }
  }
}

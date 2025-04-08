# 通用的院校教师邮箱抓取

虽然还有更简单的方案, 但是这个方案目前看起来最通用

## 流程

1. 获取教师详情页链接, 利用 redis 来做一个 lock free
2. 然后重建一个 context, 批量重新 fetch 详情页
3. 获取正文, 然后用 regex 来获取邮箱 (所以有的页面没有邮箱, 但是 footer 有院长邮箱, 导致出现问题)
4. 保存到 Excel 中

## 出现的问题

- `stealth` 大部分对于院校的防爬虫是无用的, 但是 `delete webdriver` 还是有用的
- 有的详情页会直接弹出 dialog
- 有的页面 img onerror 塞入的图片是个 404
- 有的页面会先 416, 然后设置 cookie 重新跳转, 不满足条件直接报 400
- 有的学校教师的联系方式请求是 N + 1, 所以直接匹配 body text 不是个通用的方案
- `networkidle0` 一般来说是最佳的通用等待方案, 除了上面 onerror 的无限循环
- 大部分院校系教师列表都是 unique 的, 但是有的会博导, 硕导这样分配导致重复, 这个使用 `zset` 来保证唯一性

## 使用 LLM 改善

- 使用 claude, gemini 无法生成结构化的 json 数据
- 直接使用 [readability](https://github.com/mozilla/readability) 转成 markdown 会导致有些网页的信息丢失,
  然后 gpt-4o 就会有幻觉
- 使用 [browser-use](https://github.com/browser-use/browser-use) 无法有效的 goback 点击下一个
- 使用 [manus](https://manus.im/share/AJrY7kFFjUu6vw2liJfkPB?replay=1) 效果还行, 但是也会出现由于用户详情页
  dom 不同导致输出有问题的数据
    - 先获得所有用户, url 的 json
    - 然后根据 DOM 生成对应的 python 脚本
    - 执行生成给用户

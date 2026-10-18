# 海斗战记 · Mayhem Chronicles

独立的 5v5 海克斯大乱斗互动文字游戏。单人模式在浏览器本地运行，进度会保存在当前浏览器；服务器版提供与朋友进入同一房间的联机对战。

[在线游戏](https://xiaokai2810.github.io/haidou-zhanji/) · [原版构筑实验室](https://xiaokai2810.github.io/haidou-lunzhan/)

联机版部署后从 `http://101.132.103.55/haidou-zhanji/duel.html` 进入；服务器的根页面和 GitHub Pages 页面仍提供单人模式。服务器安装与运维说明见 [deploy/README.md](deploy/README.md)。

## 玩法

1. 开局抽到两张随机英雄卡，也可从四张队伍备选卡中换入英雄，再锁定角色。两张起手卡和公共备选席参考了 Riot 的 [ARAM 英雄卡机制](https://www.leagueoflegends.com/en-au/news/game-updates/patch-25-13-notes/)；本站的卡池抽样和备选席数量是游戏规则。
2. 在四轮战斗前分别从三张随机海克斯中选一张，每轮可以整体刷新候选一次。游戏提供 195 张现役海克斯图鉴供检索；实际选择仍遵循随机三选一。强化会累积，并与英雄定位和装备触发联动。
3. 花金币买组件、出门装、鞋子和成装。商店提供 183 件可购买物品；已有的合成组件可抵扣价格。装备会即时改变面板及后续团战。其余 13 件资料包含消耗品、进化装备和特殊物品，保留在数据快照中但不直接出售。
4. 匹配四名队友和五名对手。每轮团战先指定一名敌方英雄为集火目标，再分别选择开团、临场应对和收尾战术；每个阶段至少八种战术。对手也会逐轮获得装备和强化。
5. 团战后选择推塔、清线发育、争夺地图补给或回防，最后一轮还可冒险偷塔。团战、连胜和战后行动影响金币、塔的耐久与地图控制，进而影响后续团战和最终胜负。战报列出伤害、击倒、经济及触发的联动。
6. 四轮打完后查看最终比分、推进结果和个人战绩，也可以重新匹配。进度自动存于浏览器 `localStorage`。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm ci
npm run dev
```

用 `npm test` 测试游戏规则，用 `npm run build` 构建本地版本。推送到 `main` 后，`.github/workflows/pages.yml` 运行安装、测试和构建，并部署到 GitHub Pages。仓库部署前需在 GitHub 的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。构建时设置 `GITHUB_PAGES=true`，资源前缀会自动变为 `/haidou-zhanji/`。

```bash
npm test
GITHUB_PAGES=true npm run build
```

仓库只包含独立游戏所需的页面、引擎、测试和静态数据，不依赖原版构筑实验室仓库。英雄插画、图标和字体通过各自的公开资源地址加载；资源暂时不可用时，游戏可继续使用文字占位。

## 数据与模拟口径

静态快照见 `public/data/meta.json`：当前模式版本 26.20、Data Dragon 16.20.1、统计日期 2026-10-16。英雄和装备基础属性来自 [Riot Data Dragon](https://ddragon.leagueoflegends.com/api/versions.json)；海克斯目录、稀有度及选取率参考 [ARAMMayhem 开放数据](https://arammayhem.com/data/)（CC BY 4.0）；补丁变化参考 [Riot 26.20 公告](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/)；部分翻译和图标参考 [CommunityDragon](https://raw.communitydragon.org/) 与 [ARAMKit](https://aramkit.cn/zh-CN)。目录排除了公开资料中标记退役的海克斯和禁用、不可购买装备。每条快照的具体来源地址记录在 `meta.json`。

英雄卡结构、强化选择节点和部分英雄、海克斯、装备机制以原游戏为参考。随机卡权重、整组三张强化刷新、对战公式、联动系数、敌我 AI、团战战术、成长层数和金币奖励是本站设计。当前公开数据不含完整的海斗发牌概率、英雄对位组合胜率或逐场赛末层数，因此战报属于可玩的模拟结果，**不是官方胜率预测，也不能代表实际对局结果**。无法直接量化的技能和条件被动只作有限近似。查看 [Riot 模式介绍](https://www.leagueoflegends.com/en-ph/news/dev/dev-augmentmaxxing-aram-mayhem/) 了解原游戏。

本项目为非官方爱好者作品，未获 Riot Games 背书。League of Legends 的名称、英雄、物品及素材权利归 Riot Games 所有。

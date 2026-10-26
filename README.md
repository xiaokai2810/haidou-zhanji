# 海斗战记 · 七波 5v5 指挥模式

[在线游戏（单机或联机入口）](https://xiaokai2810.github.io/haidou-zhanji/) · [服务器联机](http://101.132.103.55/haidou-zhanji/squad.html)

新首页支持一人管理整支五英雄战队，也支持最多十名玩家分为两队。每队可以由 1–5 人分配五个英雄席位；开局后仅能操作自己负责的英雄，阶段锁定后统一结算。

- 七波等级为 **3、5、7、11、15、18、18**，每波都有独立出装、逐英雄战术和集火目标。
- 每个英雄分别拥有金币、六格装备、海克斯、永久成长和战绩。第 1、2、4、6 波提供三选一强化，每次可刷新一次。
- 团战按实际阵亡人数判定大获全胜、胜利、惨胜、平局、惜败或战败。胜负、击杀、助攻、终结赏金和追赶经济共同影响下一波。
- 战后可以推塔、清线、控制回血包或回防；最后两波可尝试偷塔。完整打完七波，再依次比较基地耐久、团战积分、累计阵亡；完全相同为平局。
- 英雄 × 海克斯 × 装备有明确组合成就和有限成长。触发概率与战术系数是本站规则，均非官方实战概率。
- 本地进度自动保存；联机房间在服务器持久化。邀请链接仅携带房间码，席位凭证仅保存在自己的浏览器。

最新数据核验、来源与覆盖范围见 [数据研究记录](docs/data-research.md)。英雄技能、站位和部分海克斯以文字游戏模型近似；目录完整程度不等于所有机制均已精确实现。

经典四波单机保留在 `classic.html`，经典双人对战保留在 `duel.html`。

## 本地开发与测试

```bash
npm ci
npm test
npm run dev
```

Vite 仅用于前端开发；联机本地验证需先 `npm run build`，再 `npm start`。服务器运行于 `127.0.0.1:3000`。生产子路径构建使用 `GITHUB_PAGES=true npm run build`。部署方式见 [部署说明](deploy/README.md)。

## 联机协议

`POST /api/squads` 创建房间，`POST /api/squads/:code/join` 选择队伍并加入，`GET /api/squads/:code` 获取自己视角，`POST /api/squads/:code/actions` 提交操作。读房间与操作均使用 `Authorization: Bearer`。每次游戏操作附带 `expectedRound` 与 `expectedPhase`，过时操作不会影响下一阶段。服务器验证席位归属、金币、阶段与全队准备情况。


<details><summary>经典模式说明</summary>

# 海斗战记 · Mayhem Chronicles

独立的 5v5 海克斯大乱斗互动文字游戏。单人模式在浏览器本地运行，进度会保存在当前浏览器；服务器版提供与朋友进入同一房间的联机对战。

[在线游戏](https://xiaokai2810.github.io/haidou-zhanji/) · [原版构筑实验室](https://xiaokai2810.github.io/haidou-lunzhan/)

联机版部署后从 `http://101.132.103.55/haidou-zhanji/duel.html` 进入；新的默认首页为七波指挥模式，经典单人模式位于 `classic.html`。服务器安装与运维说明见 [deploy/README.md](deploy/README.md)。

## 玩法

1. 开局抽到两张随机英雄卡，也可从四张队伍备选卡中换入英雄，再锁定角色。两张起手卡和公共备选席参考了 Riot 的 [ARAM 英雄卡机制](https://www.leagueoflegends.com/en-au/news/game-updates/patch-25-13-notes/)；本站的卡池抽样和备选席数量是游戏规则。
2. 在四轮战斗前分别从三张随机海克斯中选一张，每轮可以整体刷新候选一次。海克斯目录与新模式共享当前快照；实际选择仍遵循随机三选一。强化会累积，并与英雄定位和装备触发联动。
3. 花金币买组件、出门装、鞋子和成装。商店支持已有合成组件抵扣价格。装备会改变面板及后续团战；消耗品、进化装备和特殊物品是否可购买，以各模式商店规则为准。
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

静态快照见 `public/data/meta.json`，已与新模式共同更新至 26.21 / Data Dragon 16.21.1。来源、退池处理和模拟范围详见 [数据研究记录](docs/data-research.md)。经典模式继续采用原有四轮近似规则。

英雄卡结构、强化选择节点和部分英雄、海克斯、装备机制以原游戏为参考。随机卡权重、整组三张强化刷新、对战公式、联动系数、敌我 AI、团战战术、成长层数和金币奖励是本站设计。当前公开数据不含完整的海斗发牌概率、英雄对位组合胜率或逐场赛末层数，因此战报属于可玩的模拟结果，**不是官方胜率预测，也不能代表实际对局结果**。无法直接量化的技能和条件被动只作有限近似。查看 [Riot 模式介绍](https://www.leagueoflegends.com/en-ph/news/dev/dev-augmentmaxxing-aram-mayhem/) 了解原游戏。

本项目为非官方爱好者作品，未获 Riot Games 背书。League of Legends 的名称、英雄、物品及素材权利归 Riot Games 所有。

</details>

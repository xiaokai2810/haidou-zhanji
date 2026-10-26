# 海斗战记数据与机制核对

核对日期：**2026-10-26（Asia/Shanghai）**。线上正式版本为 **26.21**，Riot Data Dragon 的对应资源编号为 **16.21.1**。26.22 的测试服消息不纳入本轮正式卡池。

## 可核验来源

- [Riot 26.21 更新公告](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/)：2026-10-20 发布；页面另含 10-22 热修。Mayhem 的新主题是 Journey to Stardom，公布 35 个新强化和 13 个移除强化，以及 K/DA、HEARTSTEEL、True Damage、Pentakill 等全局环境。其他模式的平衡条目不能当作 Mayhem 的独立参数。
- [Riot 资源版本索引](https://ddragon.leagueoflegends.com/api/versions.json)、[中文英雄数据](https://ddragon.leagueoflegends.com/cdn/16.21.1/data/zh_CN/champion.json)、[中文装备数据](https://ddragon.leagueoflegends.com/cdn/16.21.1/data/zh_CN/item.json)：本次实际下载并验证版本一致。基础属性不包含全部模式专属修正。
- [ARAMKit 当前强化目录](https://aramkit.cn/zh-CN/augments)：页面标示 16.21，数据日期 2026-10-25。各强化的中文效果、图标及稀有度来自其详情页。提取图标的文字替代信息，避免丢掉“法术强度”“最大法力值”等公式单位。
- [ARAM Mayhem 当前目录](https://arammayhem.com/augments/)：页面同时含当前池和历史榜单，导入使用 `data-current-augment` 当前池，共 223 个记录；没有把历史排行榜当作最新卡池。其 JSON API 本次返回 403，因此改用公开页面。
- [ARAMKit 稀有度概率](https://aramkit.cn/zh-CN/augment-rarity)：检索快照仍是 16.20 的样本，只可作随机阶段设计参考；不是 26.21 的官方抽卡概率。

## 本次导入与限制

实际导入 **173 位英雄、198 件装备、220 个海克斯**，含官方新增的全部 **35 个**海克斯。220 个强化均取得 16.21 中文详情；旧版描述保留数为 0。`public/data/meta.json` 记录了版本、核对日期、数量、来源和模拟边界。

当前目录的 `yowch_my_coins` 存在退池信息冲突，`one_trick_pony` 无法交叉确认当前稀有度与中文描述，`double_defense` 无法取得有效效果；三个条目暂不进入可抽取池，并在元数据列出。官方列出的 13 个退池条目全部排除，其中两个原本就不在旧目录中。目录覆盖率应如实显示，不能宣称完整还原所有模式效果。

装备保留 12 号地图对应的合法商店条目，包括 Mayhem 使用的特殊编号 `126697` 狂妄、`123430` 毁坏仪式和 `124011` 花晓之剑；新增多兰之弓、多兰之盔、暴食胫甲。破碎护臂是条件性隐藏变体，本轮不提供直接购买。进化装备和任务奖励仍不能直接从商店买到。

新版本的选取率没有导入，因此 `pickRate` 为 `null`，旧选取率只保存在标明 26.20 的 `historicalPickRate`。缺失数据不应显示为 0 胜率，选取率也不能作为抽到某张卡的概率。

成长数值按本局团战累计。未取得可核验的全服终局平均叠层，不能把预设数字宣传为真实平均值。七波等级、伤亡、经济、压力、彩蛋概率和收益封顶均属本站玩法设计；真实游戏没有这套七回合裁判系统。

## 已核对的面板参数

| 项目 | 26.21 可确认的规则 | 本站处理 |
| --- | --- | --- |
| 灵巧 / 循环往复 | 60% 攻速 / 60 急速 | 原参数正确 |
| 歌利亚巨人 | 35% 生命、15% 适应之力 | 原参数正确 |
| 星界躯体 | 1500 生命、伤害降低 10% | 原参数正确 |
| 巫师式思考 | 随等级 20–80 法强 | 修复低等级直接得到 80；按 1–18 级线性折算 |
| 时光之杖 | 每层 10 生命、30 法力、3 法强，最多 10 层 | 修复旧的 20 法力 / 4 法强；额外等级由战役阶段规则处理 |
| 霸王血铠 | 额外生命的 2.5% 转攻击力 | 修复旧的 2% |
| 尤里卡 | 法强的 30% 转急速 | 队伍引擎单独处理，不在公共面板重复计入 |
| 扇巴掌 | 每次定身/缚地 10 适应之力，阵亡损失 50% | 历史社区攻略的 20 数值已过时 |
| 叠角龙 | 永久技能层数额外获得 100% | 不读取竞技场数据中不同的 75% |
| 质变：棱彩阶 / 混沌 | 获得一张随机棱彩 / 两张随机强化 | 不解释为升级之前所有强化 |

生命转法强、法强转急速等转换需要单次有界结算，避免代码递归导致无穷大。技能专属急速、距离触发、5 秒内刷新等机制不能统一当作永久面板数值。

## 彩蛋联动设计依据

下列“触发概率、成就名称和额外奖励”均为本站原创。机制依据和社区玩法灵感分开记录；玩家组合达成后可以概率解锁成就，每名英雄每局最多触发一次，收益封顶。长时间叠层应该付出经济、装备槽位或团战存活的代价。

| 组合及 ID | 依据与模拟建议 |
| --- | --- |
| 牛头 / 辛德拉 + 扇巴掌 + 尤里卡；`Alistar/Syndra + slap_around + eureka` | [扇巴掌社区组合](https://arammayhem.com/zh-cn/augments/slap-around/)和[尤里卡说明](https://arammayhem.com/zh-cn/augments/eureka/)支持“控制叠适应之力→法强转急速→更多控制”的反馈思路。该页旧数值与当前版本有差异，以 ARAMKit 当前描述为准。彩蛋可叫“左脚踩右脚”，不宣称必定无限控制。 |
| 小法 + 超凡邪恶 + 尤里卡；`Veigar + phenomenal_evil + eureka` | [超凡邪恶](https://arammayhem.com/zh-cn/augments/phenomenal-evil/)配合法强成长。每波按有效施法次数累积，急速设模拟上限，避免第一波就完全成型。 |
| 狗头 / 大虫子 / 小龙 + 叠角龙；`Nasus/Chogath/Smolder + stackosaurusrex` | [叠角龙适配与社区组合](https://arammayhem.com/zh-cn/augments/stackosaurusrex/)对应英雄自身的永久成长。狗头配 `3078` 三相可以做“千层酥”；不把所有临时战斗增益都当永久叠层。 |
| 火男 + 炼狱导管 + 兰德里；`Brand + infernal_conduit + 6653` | [炼狱导管](https://arammayhem.com/zh-cn/augments/infernal-conduit/)提供灼烧与冷却反馈，布兰德为相关适配英雄。适合持续战，敌方分散/强开可降低其输出窗口。 |
| 塞恩 / 大虫子 + 钢化你心 + 心之钢；`Sion/Chogath + quest_steel_your_heart + 3084` | [任务规则](https://arammayhem.com/zh-cn/augments/quest-steel-your-heart/)为 300 层门槛与倍增。模拟若压缩层数门槛需明确标示；应与“叠钢”战术、近身时间和存活相关。 |
| 娑娜 + 会心治疗 + 月石；`Sona + critical_healing + 6617` | [会心治疗页面](https://arammayhem.com/zh-cn/augments/critical-healing/)列出月石及娑娜适配。奖励全队续航，不直接变成无条件全队复活，重伤可以克制。 |
| 萨勒芬妮 + 冰杖 + 扇巴掌；`Seraphine + 3116 + slap_around` | [扇巴掌社区组合](https://arammayhem.com/zh-cn/augments/slap-around/)描述冰杖配 E 的强化控制思路。作为社区灵感彩蛋，不能把一次技能无限重复判定。 |
| 吸血鬼 + 巫妖大脑 + 裂隙；`Vladimir + lich_brain + 4633` | [26.21 官方新增说明](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/)确认额外生命转法强机制。围绕生命/法强互补创作“血法共鸣”；单次转换和收益封顶，不能声称官方支持无限互相转换。 |

另可用 `MasterYi/Jax + mystic_punch` 实现连击流彩蛋，[秘术冲拳说明](https://arammayhem.com/zh-cn/augments/mystic-punch/)支持普攻命中缩减冷却。`master_of_duality` 的双修增益持续 5 秒并刷新，跨波保留会改变机制，应仅作为团战内临时效果。

## 更新与验证

运行 `python3 scripts/update-data.py`。脚本钉住 26.21 / 16.21.1 并检查源数据版本；跨版本更新前需要审查官方新增/退池清单。公共页面保存在系统临时目录的 `haidou-data-26-21/`，用于本次快照的可重复生成；若要检查同版本热修，先清空该快照缓存。

`node --test tests/data-refresh.test.js` 覆盖新版卡池、特殊装备编号、低等级法强成长以及当前装备层数转换。目录可核验不意味着所有技能已完整建模，界面应保留模拟说明。

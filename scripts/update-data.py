#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refresh the pinned live snapshot. Run with Python 3; only public sources.

A newer patch needs an intentional audit of NEW/REMOVED below. This script
never treats a newer timestamp or a historical tier table as a current pool.
"""
import concurrent.futures
import datetime
import hashlib
import html
import json
import re
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data'
PATCH, DD = '26.21', '16.21.1'
CHECKED = '2026-10-26'
PATCH_URL = 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/'
CACHE = Path(tempfile.gettempdir()) / 'haidou-data-26-21'
CACHE.mkdir(exist_ok=True)
REMOVED = {'combusting_interest', 'crit_n_cast', 'critical_missile', 'dimension_shift', 'dropbear', 'dropkick', 'fan_the_hammer', 'hide_on_bush', 'high_roller', 'our_healing', 'poro_stampede', 'spiritual_purification', 'ult_bot'}
# Current sources disagree about this row; exclude it from offers until resolved.
UNCONFIRMED = {'yowch_my_coins', 'one_trick_pony', 'double_defense'}
NEW = {'blue_barrier','flow_of_spirit','fruitify','gift_of_the_drowned','hands_off_the_talent','lich_brain','lonely_warrior','no_mana_no_problem','sound_barrier','ultimate_recursion','arcane_axiom','armored_impact','bees','brass_blast','crimson_cobalt','double_time','enchanting_butterflies','get_jinxed','heavy_is_the_crown','jeweled_bracelet','recoil','salvation','sap_magic','still_here','take_em_down_down_down','the_boom_and_the_bass','tickle_monster','upgrade_stormsurge','weapon_of_destiny','big_shot','bouncing_bees','group_hug','mosh_monster','third_times_the_harm','totentanz'}

def fetch(url):
    cached = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if cached.exists():
        return cached.read_text()
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 HaidouCatalog/1.0'})
    with urllib.request.urlopen(req, timeout=25) as response:
        result = response.read().decode('utf-8')
    cached.write_text(result)
    return result

def plain(value):
    value = re.sub(r'<img\b[^>]*\balt="([^"]*)"[^>]*>', lambda m: html.unescape(m[1]), value)
    value = re.sub(r'<br\s*/?>|</div>', ' · ', value)
    value = html.unescape(re.sub(r'<[^>]+>', '', value))
    value = re.sub(r'(法术强度|攻击速度|额外生命值|最大法力值|额外护甲|额外攻击力|穿甲|暴击几率)\1', r'\1', value)
    value = re.sub(r'获得(?:法术强度|攻击速度|暴击几率)(?=\d|\()', '获得', value)
    value = value.replace('等级', '（随等级）').replace('强化符文位阶', '').replace('可可', '可').replace('当前对局数值', 'N')
    return re.sub(r'\s+', ' ', value).strip(' ·')

def attr(value, key):
    match = re.search(r'\b' + re.escape(key) + r'="([^"]*)"', value)
    return html.unescape(match[1]) if match else ''

def norm(value):
    return re.sub('[^a-z0-9]', '', value.lower()).removeprefix('quest')

def effect_block(page):
    opening = re.search(r'<div\b[^>]*class="augment-effect-content"[^>]*>', page)
    if not opening:
        return ''
    depth = 1
    for tag in re.finditer(r'</?div\b[^>]*>', page[opening.end():]):
        depth += -1 if tag[0].startswith('</') else 1
        if depth == 0:
            result = plain(page[opening.end():opening.end() + tag.start()])
            result = re.sub(r'(?:已造成的伤害|已获得法术强度|已获得生命值|当前对局数值)[：:]?\s*(?:0|N)', 'N', result)
            return result
    return ''

def read(name):
    return json.loads((OUT / (name + '.json')).read_text())

def write(name, value):
    (OUT / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')

versions = json.loads(fetch('https://ddragon.leagueoflegends.com/api/versions.json'))
if versions[0] != DD:
    raise SystemExit('Live patch changed. Audit current pool and update pinned versions before refreshing.')
champions_source = f'https://ddragon.leagueoflegends.com/cdn/{DD}/data/zh_CN/champion.json'
items_source = f'https://ddragon.leagueoflegends.com/cdn/{DD}/data/zh_CN/item.json'
champs = json.loads(fetch(champions_source))
items_zh = json.loads(fetch(items_source))
items_en = json.loads(fetch(f'https://ddragon.leagueoflegends.com/cdn/{DD}/data/en_US/item.json'))
assert champs['version'] == items_zh['version'] == DD
champions = [{**{k:c[k] for k in ['id','key','name','title','tags','stats']}, 'icon':f'https://ddragon.leagueoflegends.com/cdn/{DD}/img/champion/{c["id"]}.png','splash':f'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/{c["id"]}_0.jpg'} for c in champs['data'].values()]

items = []
existing = {r['id']:r for r in read('items')}
for ident, source in items_zh['data'].items():
    old = existing.get(ident)
    eligible = source.get('maps', {}).get('12') and source.get('gold', {}).get('purchasable') and source.get('inStore', True) and not source.get('hideFromAll') and not source.get('requiredChampion') and not source.get('requiredAlly') and 'Trinket' not in source.get('tags', []) and source['gold']['total'] > 0 and (int(ident) < 10000 or ident in {'126697','123430','124011'})
    if not old and not eligible:
        continue
    if old and old['purchasable'] and not eligible:
        continue
    tags = source.get('tags', [])
    category = old['category'] if old else ('boots' if 'Boots' in tags else 'starter' if 'Lane' in tags and source['gold']['total'] < 1000 else 'consumable' if 'Consumable' in tags else 'component' if source.get('into') else 'legendary')
    stats_html = re.search(r'<stats>(.*?)</stats>', source.get('description', ''), re.S)
    stat_text = plain(stats_html[1]) if stats_html else ''
    def listed(pattern):
        match = re.search(pattern, stat_text)
        return float(match[1]) if match else 0
    extras = {'haste':listed(r'(\d+(?:\.\d+)?)\s*技能急速'),'lethality':listed(r'(\d+(?:\.\d+)?)\s*穿甲'),'magicPen':listed(r'(\d+(?:\.\d+)?)\s*法术穿透'),'armorPenPct':listed(r'(\d+(?:\.\d+)?)%\s*护甲穿透'),'magicPenPct':listed(r'(\d+(?:\.\d+)?)%\s*法术穿透'),'critPct':listed(r'(\d+(?:\.\d+)?)%\s*暴击几率'),'moveFlat':listed(r'(\d+(?:\.\d+)?)\s*移动速度')}
    items.append({**(old or {}),'id':ident,'name':source['name'],'english':items_en['data'].get(ident, {}).get('name',source['name']),'category':category,'purchasable':old['purchasable'] if old else True,'tags':tags,'gold':source['gold']['total'],'from':source.get('from',[]),'into':source.get('into',[]),'stats':source.get('stats',{}),'extras':extras,'description':plain(source.get('description','')),'icon':f'https://ddragon.leagueoflegends.com/cdn/{DD}/img/item/{ident}.png','sourcePatch':PATCH})

mayhem = fetch('https://arammayhem.com/augments/')
aramkit = fetch('https://aramkit.cn/zh-CN/augments')
assert f'Augments — {PATCH}' in mayhem and 'v16.21' in aramkit, 'Source patch mismatch'
catalog = re.findall(r'<a[^>]+data-current-augment="([^"]+)" href="/augments/([^"]+)/">(.*?)</a>', mayhem, re.S)
assert len(catalog) >= 200 and NEW.issubset({r[0] for r in catalog})
rarities = {attr(row,'data-augment-id'):attr(row,'data-rarity') for row in re.findall(r'<a data-latest-row\b.*?</a>', mayhem,re.S)}
kit_rows = {slug:row for slug,row in re.findall(r'<a href="/zh-CN/augments/([^\"]+)" class="table-row augment-table-row">(.*?)</a>',aramkit,re.S)}
old_augments = {a['id']:a for a in read('augments')}
kit_by_normal = {norm(slug):slug for slug in kit_rows}
kit_by_name = {attr(row,'alt'):slug for slug,row in kit_rows.items()}

def make_augment(row):
    ident, slug, english = row
    old = old_augments.get(ident, {})
    # Some source slugs preserve apostrophes or omit the Quest prefix.
    kitslug = slug if slug in kit_rows else kit_by_normal.get(norm(slug)) or kit_by_name.get(old.get('name','').replace('任务：',''))
    summary = kit_rows.get(kitslug, '')
    name = attr(summary,'alt') or old.get('name') or plain(english)
    rarity = attr(summary,'data-rarity') or rarities.get(ident) or old.get('rarity')
    if not rarity:
        raise ValueError(f'Missing verified rarity: {ident}')
    effect = ''
    if kitslug:
        try:
            effect = effect_block(fetch('https://aramkit.cn/zh-CN/augments/' + kitslug))
        except Exception:
            pass
    source = 'ARAMKit 16.21' if effect else old.get('source','未覆盖')
    result = {**old,'id':ident,'slug':slug,'name':name,'english':plain(english),'rarity':rarity,'pickRate':None,'effect':effect or old.get('effect',''),'icon':attr(summary,'src') or old.get('icon',''),'source':source,'sourceUrl':'https://aramkit.cn/zh-CN/augments/'+kitslug if kitslug else old.get('sourceUrl',''),'sourcePatch':PATCH if effect else old.get('sourcePatch','26.20'),'isNew':ident in NEW,'modelNote':'文字团战采用简化效果；技能专属触发、实时距离与连锁频率不等同客户端。'}
    if old.get('pickRate') is not None:
        result['historicalPickRate'] = old['pickRate']
        result['historicalPickRatePatch'] = '26.20'
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    augments = list(pool.map(make_augment,[r for r in catalog if r[0] not in REMOVED | UNCONFIRMED]))
# No unverified English-only cards or empty effects are admitted to the pool.
missing = [a['id'] for a in augments if not a['effect']]
if missing:
    raise SystemExit('Missing descriptions; review manually: '+','.join(missing))
assert len({a['id'] for a in augments}) == len(augments)
assert not ({a['id'] for a in augments} & (REMOVED | UNCONFIRMED))
meta = {'patch':PATCH,'ddragonVersion':DD,'statsDate':'2026-10-25','checkedAt':CHECKED,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseId':'verified-26.21-20261026','sources':{'champions':champions_source,'items':items_source,'augments':'https://aramkit.cn/zh-CN/augments','augmentCatalog':'https://arammayhem.com/augments/','patchNotes':PATCH_URL,'versionIndex':'https://ddragon.leagueoflegends.com/api/versions.json'},'counts':{'champions':len(champions),'items':len(items),'augments':len(augments)},'dataCoverage':{'catalogPatch':PATCH,'officialNewAugments':35,'removedFromOffers':sorted(REMOVED),'unconfirmedExcluded':sorted(UNCONFIRMED),'retainedOldDescriptions':[a['id'] for a in augments if a['sourcePatch'] != PATCH],'statistics':'已核对来源日期；不把选取率作为抽卡概率或预测胜率。新版本选取率尚未导入。','simulation':'七波团战、伤亡判定、经济、成长速度和彩蛋概率由本站模拟；不是 Riot 原游戏战斗引擎。','growth':'成长值由本局团战累计；未取得可核验的全服终局平均叠层，不宣称采用该平均值。','limits':'Data Dragon 基础属性不含全部海克斯大乱斗专属调整；技能伤害、局内距离和触发链采用简化模型。'}}
write('champions',champions);write('items',items);write('augments',augments);write('meta',meta)
print(json.dumps({'patch':PATCH,'counts':meta['counts'],'retainedOldDescriptions':meta['dataCoverage']['retainedOldDescriptions']},ensure_ascii=False))

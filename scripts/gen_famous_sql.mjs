import { writeFileSync } from 'node:fs'
const RAW = 'https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/'
const clean = (v) => String(v == null ? '' : v).trim()
async function fetchJson(p){for(let i=1;i<=3;i++){try{const r=await fetch(RAW+encodeURI(p));if(!r.ok)return null;return await r.json()}catch{if(i===3)return null;await new Promise(r=>setTimeout(r,i*1000))}}return null}
const famous=new Set()
const add=(t,a)=>{t=clean(t);if(!t)return;famous.add(`${t}|${clean(a)}`);famous.add(`${t}|`)}
const ci300=await fetchJson('宋词/宋词三百首.json')
if(Array.isArray(ci300))for(const e of ci300){const rh=clean(e.rhythmic);let ti=clean(e.title)||rh;if(rh&&ti&&!ti.startsWith(rh))ti=`${rh}·${ti}`;add(ti,e.author);add(rh,e.author)}
for(const f of ['sanzijing-new.json','sanzijing-traditional.json','baijiaxing.json','qianziwen.json','dizigui.json','shenglvqimeng.json','youxueqionglin.json','zengguangxianwen.json','wenzimengqiu.json','zhuzijiaxun.json','guwenguanzhi.json']){
  const d=await fetchJson('蒙学/'+f); if(!d)continue; add(d.title,d.author)
  if(Array.isArray(d.content))for(const c of d.content){const inner=Array.isArray(c.content)?c.content:[];for(const x of inner)add(x.chapter||c.chapter||d.title,x.author||d.author);if(!inner.length&&c.chapter)add(c.chapter,d.author)}
}
const qjs=await fetchJson('蒙学/qianjiashi.json')
if(qjs&&Array.isArray(qjs.content))for(const c of qjs.content){const inner=Array.isArray(c.content)?c.content:[];for(const x of inner){add(clean(x.chapter),x.author);add(clean(x.chapter),'')}}
const keys=[...famous]
const esc=s=>s.replace(/'/g,"''")
const vals=keys.map(k=>`('${esc(k)}')`).join(',')
writeFileSync('scripts/famous_insert.sql',`INSERT INTO tmp_famous (k) VALUES ${vals} ON CONFLICT DO NOTHING;`)
console.log('keys =',keys.length)

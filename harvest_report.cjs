/**
 * harvest_report.cjs
 * Symbol Harvest Report
 * - terminal table output
 * - optional CSV output (UTF-8 BOM)
 * - no config file
 */

const fs = require('fs');
const path = require('path');

/* ================= 設定 ================= */
const MAX_ROWS = 20;              // 表示件数
const CSV_ENABLED = true;         // CSV出力 ON / OFF
const CSV_DIR = './reports';      // CSV出力先
const DEFAULT_HTTP = 'http://localhost:3000';
const DEFAULT_HTTPS = 'https://localhost:3000';

/* ================= HTTP ================= */
async function fetchJson(base, p) {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
  return r.json();
}
async function probe(base) {
  await fetchJson(base, '/node/health');
  return base;
}
async function resolveBaseUrl() {
  try { return await probe(DEFAULT_HTTP); } catch {}
  return probe(DEFAULT_HTTPS);
}

/* ================= Utils ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').replace(/'/g,'').replace(/^0x/i,'').toUpperCase();

function formatComma(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function roundXYM(amount, div) {
  const a = BigInt(amount ?? 0);
  const b = 10n ** BigInt(div);
  return ((a + b/2n) / b).toString(); // 四捨五入
}
function decXYM(amount, div) {
  const a = BigInt(amount ?? 0);
  const b = 10n ** BigInt(div);
  return `${a/b}.${(a%b).toString().padStart(div,'0')}`;
}

/* ================= JST ================= */
function jstDate(ms) {
  return new Date(ms + 9*3600*1000);
}
function jstString(ms) {
  const d = jstDate(ms);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function jstFileStamp(now = Date.now()) {
  const d = jstDate(now);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
}

/* ================= 表幅（全角対応） ================= */
function isWide(cp){
  return (
    cp>=0x1100 && (
      cp<=0x115f || cp===0x2329 || cp===0x232a ||
      (0x2e80<=cp && cp<=0xa4cf) ||
      (0xac00<=cp && cp<=0xd7a3) ||
      (0xf900<=cp && cp<=0xfaff) ||
      (0xfe10<=cp && cp<=0xfe6f) ||
      (0xff00<=cp && cp<=0xff60) ||
      (0x3040<=cp && cp<=0x30ff) ||
      (0x4e00<=cp && cp<=0x9fff)
    )
  );
}
function dWidth(s){
  let w=0;
  for(const c of String(s)){
    w+= isWide(c.codePointAt(0)) ? 2 : 1;
  }
  return w;
}
function padR(s,w){
  s = String(s ?? '');
  const dw=dWidth(s);
  return dw>=w ? s : s + ' '.repeat(w-dw);
}

/* ================= Base32 ================= */
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(buf){
  let bits=0,val=0,out='';
  for(const b of buf){
    val=(val<<8)|b; bits+=8;
    while(bits>=5){
      out+=B32[(val>>(bits-5))&31]; bits-=5;
    }
  }
  if(bits>0) out+=B32[(val<<(5-bits))&31];
  return out;
}
function rawToAddr(hex){
  return b32(Buffer.from(norm(hex),'hex'));
}

/* ================= Importance % ================= */
function impPct(imp,total){
  const i=BigInt(String(imp ?? '0').replace(/'/g,''));
  const t=BigInt(String(total ?? '1').replace(/'/g,''));
  const scale=10n**6n;
  const v=i*100n*scale/t;
  return `${v/scale}.${(v%scale).toString().padStart(6,'0')}%`;
}

/* ================= 報酬 ================= */
async function reward(base,h,raw,mosaic){
  let sum=0n;
  for(const p of [`/statements/block?height=${h}`,`/statements/transaction?height=${h}`]){
    try{
      const r=await fetchJson(base,p);
      for(const s of r.data??[]){
        for(const rc of (s.statement?.receipts ?? s.receipts ?? [])){
          if(norm(rc.recipientAddress ?? rc.targetAddress)===raw && norm(rc.mosaicId)===mosaic)
            sum+=BigInt(rc.amount);
        }
      }
    }catch{}
  }
  return sum;
}

/* ================= 表（ターミナル） ================= */
function printTable(base, rows){
  const cols=[
    ['no','No'],
    ['linkKey','リンクキー'],
    ['addr','ウォレットアドレス'],
    ['balance','残高'],
    ['imp','インポータンス'],
    ['height','ブロック高'],
    ['time','日時(JST)'],
    ['reward','数量'],
  ];

  const widths=cols.map(([k,t])=>{
    let w=dWidth(t);
    for(const r of rows) w=Math.max(w,dWidth(r[k]));
    return w;
  });

  console.log(`REST: ${base}`);
  console.log(`MAX_ROWS: ${MAX_ROWS}`);

  const head=cols.map(([_,t],i)=>padR(t,widths[i])).join(' | ');
  const sep='-'.repeat(dWidth(head));
  console.log(sep);
  console.log(head);
  console.log(sep);

  for(const r of rows){
    console.log(cols.map(([k],i)=>padR(r[k],widths[i])).join(' | '));
  }
  console.log(sep);
}

/* ================= CSV（UTF-8 BOM） ================= */
function csvEscape(v){
  const s=String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function writeCsv(rows){
  if(!CSV_ENABLED) return;

  fs.mkdirSync(CSV_DIR,{recursive:true});
  const file = path.join(CSV_DIR, `${jstFileStamp()}-Harvest_Report.csv`);

  const header=['No','リンクキー','ウォレットアドレス','残高','インポータンス','ブロック高','日時(JST)','数量'];
  const lines=[header.map(csvEscape).join(',')];

  for(const r of rows){
    lines.push([
      r.no,r.linkKey,r.addr,r.balance,r.imp,r.height,r.time,r.reward
    ].map(csvEscape).join(','));
  }

  const BOM = '\uFEFF';
  fs.writeFileSync(file, BOM + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`CSV出力: ${file}`);
}

/* ================= main ================= */
(async()=>{
  const base=await resolveBaseUrl();

  const net=await fetchJson(base,'/network/properties');
  const epoch=Number(net.network.epochAdjustment.match(/\d+/)[0]);

  const mosaicId=norm(net.chain.currencyMosaicId);
  const mosaic=await fetchJson(base,`/mosaics/${mosaicId}`);
  const div=mosaic.mosaic.divisibility;
  const totalImp=net.chain.totalChainImportance;

  const unlocked=(await fetchJson(base,'/node/unlockedaccount')).unlockedAccount;
  const accCache=new Map();
  const getAcc=async k=>{
    if(!accCache.has(k)) accCache.set(k,(await fetchJson(base,`/accounts/${k}`)).account);
    return accCache.get(k);
  };

  let blocks=[];
  for(const k of unlocked){
    try{
      const r=await fetchJson(base,`/blocks?signerPublicKey=${k}&order=desc&pageSize=50`);
      r.data?.forEach(v=>blocks.push(v.block));
    }catch{}
    await sleep(20);
  }

  blocks.sort((a,b)=>{
    const ah=BigInt(a.height), bh=BigInt(b.height);
    return ah===bh?0:(ah<bh?1:-1);
  });

  const seen=new Set(), rows=[];
  for(const b of blocks){
    if(seen.has(b.height)) continue;
    seen.add(b.height);
    if(rows.length>=MAX_ROWS) break;

    const rAcc=await getAcc(b.signerPublicKey);
    const mainKey=rAcc.supplementalPublicKeys?.linked?.publicKey ?? b.signerPublicKey;
    const acc=await getAcc(mainKey);

    const raw=norm(acc.address);
    const bal=acc.mosaics.find(m=>norm(m.id)===mosaicId)?.amount ?? 0;
    const rew=await reward(base,b.height,raw,mosaicId);

    rows.push({
      no:String(rows.length+1),
      linkKey:b.signerPublicKey,
      addr:rawToAddr(raw),
      balance:formatComma(roundXYM(bal,div)),
      imp:impPct(acc.importance,totalImp),
      height:String(b.height),
      time:jstString(Number(b.timestamp)+epoch*1000),
      reward:decXYM(rew,div),
    });
  }

  printTable(base,rows);
  writeCsv(rows);
})().catch(e=>{
  console.error('ERROR:',e);
  process.exit(1);
});


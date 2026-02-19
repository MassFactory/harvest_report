/**
 * harvest_report.cjs
 * Symbol Harvest Report（ノード運営者向け）
 *
 * 目的:
 * - 自ノードでの委任者がハーベストしたブロック情報を集計して一覧表示する
 * - ターミナルに表形式で出力する
 * - 必要に応じてCSV(UTF-8 BOM付き)で保存する
 *
 * 前提:
 * - Symbol ノードの REST が localhost:3000 で動いている想定（http/https を自動判定）
 * - ノードの MongoDB(catapult) の内容は REST 経由で参照する
 */

const fs = require('fs');
const path = require('path');

/* ================= 設定 ================= */
/**
 * ターミナルに表示する最大行数（最新から MAX_ROWS 件）
 * ※CSVも同じ件数になります
 */
const MAX_ROWS = 20;

/**
 * true: CSV出力する / false: CSV出力しない
 * ※ターミナル表示は常に行う
 */
const CSV_ENABLED = false;

/**
 * CSVの出力先ディレクトリ（なければ自動作成）
 */
const CSV_DIR = './reports';

/**
 * REST の接続先候補
 * まず http://localhost:3000 を試し、ダメなら https://localhost:3001 を試す
 */
const DEFAULT_HTTP = 'http://localhost:3000';
const DEFAULT_HTTPS = 'https://localhost:3001';

/* ================= HTTP ================= */
/**
 * REST API にアクセスして JSON を返す共通関数
 * - base: 'http://localhost:3000' など
 * - p: '/node/health' など（先頭スラッシュ付き）
 */
/**
 * REST リクエストのタイムアウト(ms)
 */
const REQUEST_TIMEOUT_MS = 10000;

async function fetchJson(base, p) {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);  
  return r.json();
}

/**
 * REST の生存確認（/node/health が取れればOK）
 */
async function probe(base) {
  await fetchJson(base, '/node/health');
  return base;
}

/**
 * http / https を自動判定して、使える baseURL を返す
 */
async function resolveBaseUrl() {
  try { return await probe(DEFAULT_HTTP); } catch {}
  return probe(DEFAULT_HTTPS);
}

/* ================= Utils ================= */
/** 指定msだけ待つ（REST叩きすぎ防止） */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * REST応答に混ざることがある "'(シングルクォート)" や "0x" を除去し、
 * さらに大文字化して比較しやすくする
 */
const norm = s => String(s ?? '').replace(/'/g,'').replace(/^0x/i,'').toUpperCase();

/** 数値文字列にカンマを入れる（例: 1234567 -> 1,234,567） */
function formatComma(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 通貨モザイク量(最小単位)を divisibility で丸めて「整数XYM」にする
 * - BigIntで扱う（桁が大きいので Number は危険）
 * - 四捨五入して整数として返す
 */
function roundXYM(amount, div) {
  const a = BigInt(amount ?? 0);
  const b = 10n ** BigInt(div);
  return ((a + b/2n) / b).toString(); // 四捨五入
}

/**
 * 通貨モザイク量(最小単位)を "123.456789" のような小数表記にする
 * - BigIntで扱う（桁が大きいので Number は危険）
 */
function decXYM(amount, div) {
  const a = BigInt(amount ?? 0);
  const b = 10n ** BigInt(div);
  return `${a/b}.${(a%b).toString().padStart(div,'0')}`;
}

/* ================= JST ================= */
/**
 * Symbolのtimestamp/epochはUTCベースなので、JST表示用に +9時間する
 * ※ここでは Date の UTC系 getter を使って表示のズレを防いでいる
 */
function jstDate(ms) {
  return new Date(ms + 9*3600*1000);
}

/** JST "YYYY-MM-DD HH:MM:SS" 形式で返す */
function jstString(ms) {
  const d = jstDate(ms);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** ファイル名用 "YYYY-MM-DD_HH-MM" のスタンプ（JST） */
function jstFileStamp(now = Date.now()) {
  const d = jstDate(now);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
}

/* ================= 表幅（全角対応） ================= */
/**
 * ターミナルの表を崩さないために、全角(日本語)を幅2として計算する
 * - 表示上の幅を "だいたい" 合わせる目的
 */
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

/** 文字列の表示幅（半角=1, 全角=2） */
function dWidth(s){
  let w=0;
  for(const c of String(s)){
    w+= isWide(c.codePointAt(0)) ? 2 : 1;
  }
  return w;
}

/** 右パディングして列幅を揃える（全角考慮） */
function padR(s,w){
  s = String(s ?? '');
  const dw=dWidth(s);
  return dw>=w ? s : s + ' '.repeat(w-dw);
}

/** 左パディングして右寄せ（全角考慮） ★残高列の右寄せ用に追加 */
function padL(s,w){
  s = String(s ?? '');
  const dw=dWidth(s);
  return dw>=w ? s : ' '.repeat(w-dw) + s;
}

/* ================= Base32 ================= */
/**
 * Symbol アドレスの表示用（Rawアドレス=16進） -> Base32文字列へ変換
 * RESTが返す address は raw(16進)形式なので、人間が見やすいBase32へ変換する
 */
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

/** rawアドレス(16進) -> Base32アドレス文字列 */
function rawToAddr(hex){
  const cleaned = norm(hex);
  if (!/^[0-9A-F]{48}$/.test(cleaned)) return 'INVALID_ADDRESS';
  return b32(Buffer.from(cleaned,'hex'));
}

/* ================= Importance % ================= */
/**
 * Importance を "xx.xxxxxx%" にして表示する
 * - totalChainImportance を分母として、割合(%)を小数6桁で出す
 * - BigIntで計算して精度を落とさない
 */
function impPct(imp,total){
  const i=BigInt(String(imp ?? '0').replace(/'/g,''));
  const t=BigInt(String(total ?? '1').replace(/'/g,''));
  const scale=10n**6n;
  const v=i*100n*scale/t;
  return `${v/scale}.${(v%scale).toString().padStart(6,'0')}%`;
}

/* ================= 報酬 ================= */
/**
 * 指定ブロック高における「自ノード宛の通貨モザイク受領量」を receipts から合算する
 * - /statements/block と /statements/transaction の両方を見る
 * - recipient/target が自ノードの raw address と一致し、mosaicId が通貨なら加算
 *
 * 注意:
 * - REST実装/ノード設定により receipts のフィールド名が揺れることがあるため、
 *   recipientAddress / targetAddress どちらも見ている
 */
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
/**
 * 集計結果をターミナルに表形式で出す
 * - 列幅は全角対応で計算
 */
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
    console.log(cols.map(([k],i)=>{
      // ★残高の「値」だけ右寄せ（見出しは左寄せのまま）
      if(k === 'balance') return padL(r[k], widths[i]);
      return padR(r[k], widths[i]);
    }).join(' | '));
  }
  console.log(sep);
}

/* ================= CSV（UTF-8 BOM） ================= */
/**
 * CSVに書くためのエスケープ処理
 * - ダブルクォート/改行/カンマが含まれる場合は "..." で囲む
 * - " は "" にする（CSV仕様）
 */
function csvEscape(v){
  const s=String(v ?? '');
  const hardened=/^[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(hardened) ? `"${hardened.replace(/"/g,'""')}"` : hardened;
}


/**
 * 集計結果をCSVとして保存する
 * - UTF-8 BOM を付ける（Excelで文字化けしにくくするため）
 * - 改行は CRLF（Windows/Excelでの互換性）
 */
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
  // RESTのベースURL（http/https）を自動決定
  const base=await resolveBaseUrl();

  // network/properties から epochAdjustment や 通貨モザイクID 等を取得
  const net=await fetchJson(base,'/network/properties');

  // epochAdjustment は "123456" のような文字列なので数値だけ抜く（秒）
  const epoch=Number(net.network.epochAdjustment.match(/\d+/)[0]);

  // 通貨モザイク（XYMなど）のIDと divisibility を取得
  const mosaicId=norm(net.chain.currencyMosaicId);
  const mosaic=await fetchJson(base,`/mosaics/${mosaicId}`);
  const div=mosaic.mosaic.divisibility;

  // インポータンス割合計算の分母（チェーン全体の重要度）
  const totalImp=net.chain.totalChainImportance;

  // ノードに設定されている「unlocked account」（ハーベスト可能なアカウント）の公開鍵一覧
  const unlocked=(await fetchJson(base,'/node/unlockedaccount')).unlockedAccount;

  // accounts/{publicKey} は何度も呼ぶので簡易キャッシュする
  const accCache=new Map();
  const getAcc=async k=>{
    if(!accCache.has(k)) accCache.set(k,(await fetchJson(base,`/accounts/${k}`)).account);
    return accCache.get(k);
  };

  // unlocked account それぞれについて、署名者がその公開鍵のブロックを取得する
  // pageSize=50 の最新側を取得し、全部まとめて後で height 降順でソートする
  let blocks=[];
  for(const k of unlocked){
    try{
      const r=await fetchJson(base,`/blocks?signerPublicKey=${k}&order=desc&pageSize=50`);
      r.data?.forEach(v=>blocks.push(v.block));
    }catch{}
    // 連打を避けるため軽く待つ（運用環境に優しい）
    await sleep(20);
  }

  // height を BigInt で扱って降順ソート（最新ブロックを先頭へ）
  blocks.sort((a,b)=>{
    const ah=BigInt(a.height), bh=BigInt(b.height);
    return ah===bh?0:(ah<bh?1:-1);
  });

  // 同じheightが重複することがあるので seen で排除
  // MAX_ROWS 件集まったら終了
  const seen=new Set(), rows=[];
  for(const b of blocks){
    if(seen.has(b.height)) continue;
    seen.add(b.height);
    if(rows.length>=MAX_ROWS) break;

    // signerPublicKey は「リンクキー」の可能性があるため、linked key を辿って mainKey を決める
    const rAcc=await getAcc(b.signerPublicKey);
    const mainKey=rAcc.supplementalPublicKeys?.linked?.publicKey ?? b.signerPublicKey;

    // mainKey 側のアカウント情報を取得（残高・importanceなど）
    const acc=await getAcc(mainKey);

    // raw address（16進）を正規化
    const raw=norm(acc.address);

    // 通貨モザイク残高を探す（なければ 0）
    const bal=acc.mosaics.find(m=>norm(m.id)===mosaicId)?.amount ?? 0;

    // 対象ブロック高で自ノード宛に入った報酬(通貨モザイク)を receipts から合算
    const rew=await reward(base,b.height,raw,mosaicId);

    // 表／CSV 用に整形
    rows.push({
      no:String(rows.length+1),
      linkKey:b.signerPublicKey,
      addr:rawToAddr(raw),

      // 残高の数値の後に XYM が付きます。付けない場合は、下のコメント部分を使ってね。
      // balance:formatComma(roundXYM(bal,div)),
      balance:`${formatComma(roundXYM(bal,div))}XYM`,

      imp:impPct(acc.importance,totalImp),
      height:String(b.height),
      time:jstString(Number(b.timestamp)+epoch*1000), // Symbol timestamp(ms) = timestamp + epochAdjustment

      // 数量の数値の後に XYM が付きます。付けない場合は、下のコメント部分を使ってね。
      // reward:decXYM(rew,div),
      reward:`${decXYM(rew,div)}XYM`,

    });
  }

  // ターミナル出力
  printTable(base,rows);

  // CSV出力（設定ONのときのみ）
  writeCsv(rows);
})().catch(e=>{
  console.error('ERROR:',e);
  process.exit(1);
});
 

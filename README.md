# harvest_report
A harvest history aggregation script for Symbol node operators.  
The script retrieves data from the node’s MongoDB (catapult) database and outputs delegator harvest results to the terminal and CSV format.

---



Symbol ノード運営者向けのハーベスト履歴集計スクリプトです。  
ノードが保持している MongoDB（catapult）データを参照し、  
自ノードに接続されている委任者のハーベスト結果をターミナル表示および CSV として出力します。

---

## Target

- Symbol ノード運営者
- 自前でノードを構築・運用している環境
- MongoDB（catapult）へ直接アクセス可能な構成

---

## Features

- ハーベスト履歴の集計（ターミナル表示）
- CSV 出力対応（UTF-8 BOM）
- 出力件数・出力形式を設定可能
- ノード内部データのみを使用（外部API不要）

---

## Requirements

- Node.js 18 以上
- Symbol-bootstrap が稼働していること
- MongoDB が稼働していること

---

## Files

- `harvest_report.cjs`  
  メインスクリプト

---

## Usage

```bash
node harvest_report.cjs


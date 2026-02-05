# harvest_report
The tool collects and aggregates harvested block information of accounts delegated to your own node by directly querying the Symbol REST API, and displays the results in a clear, tabular format in the terminal.
Optionally, the aggregated data can also be exported as a UTF-8 BOM–encoded CSV file.

This tool is implemented using Node.js standard features only and does not depend on external libraries or the Symbol SDK.
As a result, it can be placed directly in a node operation environment and is easy to maintain for long-term use.

---

# Symbol ノード 運営者用ハーベスト集計スクリプトです。

## 概要 (Overview)

運営ノードに委任されているアカウントがハーベストしたブロック情報を、
Symbol REST API を直接参照して収集・集計し、
ターミナル上に 表形式でわかりやすく表示します。
また、必要に応じて UTF-8 BOM 付き CSV として出力することも可能です。

本ツールは Node.js の標準機能のみで実装されており、
外部ライブラリや Symbol SDK に依存しません。
そのため、ノード運用環境にそのまま配置でき、
長期運用やメンテナンスが容易な構成となっています。

---

## 主な特徴

- Symbol REST API を直接使用（Symbol SDK 不要）
- ハーベスト結果をターミナルに表形式で表示（全角文字対応）
- 残高・インポータンス・報酬量を BigInt で正確に計算
- Raw アドレスを Base32 アドレスに変換して表示
- Excel で扱いやすい UTF-8 BOM / CRLF の CSV 出力に対応（任意）
- HTTP / HTTPS の REST エンドポイントを自動判定
- ノード常駐・定期実行を想定した安定動作設計

---

## 動作要件

- OS: Ubuntu 20.04 LTS 以上
- Node.js 18 以上
- Symbol ノード REST API が稼働していること（既定: localhost:3000,3001）

---

## インストールと実行

1.  **ノードのインストールディレクトリに移動**
    ターミナルを開き、`cd`コマンドであなたの`symbol-bootstrap`もしくは `symbol-shoestring`ノードがインストールされているディレクトリに移動します。
    
    ```sh
    # 例
    cd /home/user/my-symbol-node
    ```

2.  **リポジトリをクローン**
    現在のディレクトリ（ノードのルート）に、このスクリプトのリポジトリをダウンロードします。
    ```sh
    git clone https://github.com/MassFactory/harvest_report.git
    ```
    これにより、`harvest_report`という名前の新しいフォルダが作成されます。

3.  **スクリプトのディレクトリに移動**
    作成されたフォルダの中に移動します。
    ```sh
    cd harvest_report
    ```
4.  **nodejsのバージョン確認**
    Node.js 18 以上が必要です。
    ```sh
    node -v
    ```
    ※`symbol-shoestring` には、node.jsがインストールされていない可能性があります。
      その場合は、サーバ環境を壊さず依存関係を含めてアプリを管理できる、snapなどで
      ご用意ください。使い方は、snap を調べてください。下記、インストール例
    ```sh
    sudo snap install node --classic
    node -v
    ```
5.  **スクリプトの実行**
    ```sh
    node harvest_report.cjs
    ```
    
---

## 設定方法
   harvest_report.cjs を、お好きなエディタ nano vim 等で編集してください。
   - **表示・出力件数の設定**: const MAX_ROWS = 20;
   - **CSV 出力の有効／無効**: const CSV_ENABLED = false;
   - **CSV 出力先ディレクトリ**: const CSV_DIR = './reports';

---

## 表示項目の説明

- **リンクキー**: ブロックを生成したアカウントの公開鍵です。
- **ウォレットアドレス**: ハーベスト報酬の受取先となるアカウントのアドレス（Base32 表記）です。
- **残高**: 対象アカウントが保有する XYM の現在残高です。
- **インポータンス**: チェーン全体の重要度に対する、対象アカウントの重要度の割合（％）です。
- **ブロック高**: ハーベストされたブロックの高さ（ブロック番号）です。
- **日時（JST）**: ブロックが生成された日時を日本時間（JST）で表示したものです。
- **数量**: 対象ブロックにおいて受領したハーベスト報酬量です。


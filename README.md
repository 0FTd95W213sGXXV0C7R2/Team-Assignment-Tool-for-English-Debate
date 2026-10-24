
# Team Assignment Tool for English Debate

英語ディベート部向けのチーム分け・論題管理システムです。

## 開発版について

このブランチでは、既存のチーム分け機能と論題管理機能を維持しながら、次の機能を追加することを目指しています。

- 論題の追加・編集・実施履歴の記録
- Cloudflare Worker APIを経由した書き込み
- 論題の変更履歴の保存
- 論題の論理削除（ごみ箱）と復元
- 管理者パスワードによる管理機能の保護
- Cloudflare R2への日次バックアップ
- 更新時の競合検出と書き込み回数制限

## 現在の状態

**開発中・未検証・未公開**

このブランチのコードは本番環境にデプロイしていません。

既存の `main` ブランチ、SupabaseのRLS設定、
公開中のCloudflare Workerを変更しないでください。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `worker.js` | Cloudflare WorkerのAPI |
| `wrangler.jsonc` | Worker・R2・定期実行の設定 |
| `public/index.html` | 利用者画面と管理者画面 |
| `schema.sql` | データベース拡張案 |
| `lockdown.sql` | 本番移行時のアクセス制限案 |
| `tests/worker.test.js` | APIの自動テスト |
| `tests/browser_smoke.py` | ブラウザ操作テスト |
| `package.json` | Node.jsのテスト設定 |
| `.github/workflows/check.yml` | GitHub Actionsの検証設定 |

## ローカルでの基本検証

Node.js 22以降を使用します。

```bash
npm test
npm run check
```

ブラウザテストにはPython、Playwright、
Chromiumが必要です。

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/browser_smoke.py
```

これらのテストでは外部サービスを模擬します。
本物のSupabaseやR2との接続成功を保証するものではありません。

## データベースについて

既存のSupabaseをデータの保存先として使う設計です。

ただし、SQLファイルは既存のテーブル構造や
アクセス権限と適合するか、まだ検証していません。

**`schema.sql` と `lockdown.sql` は、
現段階では実行しないでください。**

特に `lockdown.sql` は既存のRLSポリシーを変更するため、
公開中のアプリの動作に影響する可能性があります。

## Cloudflareについて

Workerで使用する設定値：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `RATE_SALT`

R2バケットのバインディング名：

- `BACKUPS`

`SUPABASE_SERVICE_ROLE_KEY`、
`ADMIN_PASSWORD`、`RATE_SALT` は秘密情報です。

GitHubのソースコードや公開HTMLには記載しません。

設定ファイルに記載されたWorker名は、
本番のWorker名と重複する可能性があります。

**隔離したテスト環境を準備するまで、
`wrangler deploy` を実行しないでください。**

## バックアップ

Cloudflare WorkersのCron Triggerで、
毎日日本時間03:00（UTC 18:00）に
R2へバックアップする設計です。

バックアップには論題データと変更履歴を含めます。

保存期間は90日を想定しています。

実際の自動実行・保存・復元は未検証です。

## 本番移行前の確認事項

1. 既存のSupabaseテーブル構造を確認する
2. 既存のRLSポリシーを確認する
3. WorkerとSQLの整合性を検証する
4. 自動テストをすべて成功させる
5. 隔離したSupabaseとR2で動作確認する
6. 既存のチーム分け機能に問題がないか確認する
7. データのバックアップと復元を検証する
8. 本番環境への移行手順をレビューする

上記が完了するまで、
本番デプロイやRLS変更は行いません。

## セキュリティ上の注意

現時点でSupabaseの既存RLSを変更していないため、
既存の公開APIからの直接書き込みを防止できるとは限りません。

また、匿名利用者に論題の追加・編集を許可する設計では、
不適切な操作を完全に防止することはできません。

回数制限、変更履歴、ごみ箱、バックアップによって
リスクを軽減する方針です。

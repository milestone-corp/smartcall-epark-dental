# EPARK歯科予約システム RPA仕様書

**バージョン**: 1.0
**作成日**: 2025-12-25
**対象**: SmartCall EPARK RPA連携開発者

本ドキュメントは、EPARK歯科予約システムに対するRPA処理の仕様をまとめたものです。

---

## 1. 空き枠の取得

### 1.1 概要

アポイント管理台帳画面から、指定期間内の空き枠情報を取得します。

### 1.2 対象URL

```
https://control.haisha-yoyaku.jp/{店舗ID}/timeAppoint4M/appointmanager/
```

### 1.3 処理フロー

```
1. アポイント管理台帳ページに遷移
2. 取得日数を8日間に設定（.parts_menu_select の data-select 属性を変更）
3. 以下を終了日まで繰り返し（逐次取得）:
   1. 現在の開始日からスケジュールを描画（Schedule.draw 関数を呼び出し）
   2. drawschedule API のレスポンスを待機
   3. DOM から以下の情報を抽出:
        - スタッフ情報（.all_staff_list）
        - シフト情報（.parts_shift_body .parts_shift_date p）
        - 既存予約情報（.parts_schedule_body_reserve）
        - 空き枠（.parts_schedule_body_column.active）
   4. シフト時間帯でフィルタリング
   5. 既存予約と重複する枠を除外
   6. 次の取得開始日に移動（8日後）
4. 結果を返却
```

※ 8日を超える期間を指定した場合、8日ずつ分割して逐次取得します。

### 1.4 使用するセレクター

| セレクター                                | 用途                         |
|------------------------------------------|------------------------------|
| `.parts_menu_select`                     | 取得日数選択メニュー           |
| `.parts_schedule_head_date_day`          | 日付ヘッダー（読み込み待機用）  |
| `.all_staff_list`                        | スタッフ一覧（hidden input）   |
| `.parts_schedule_body_column.active`     | 空き枠セル                     |
| `.parts_schedule_body_reserve`           | 既存予約                       |
| `.parts_shift_body .parts_shift_date p`  | シフト時間帯                   |

### 1.5 使用するAPI

| エンドポイント                                | メソッド  | 用途             |
|----------------------------------------------|----------|------------------|
| `/timeAppoint4M/appointmanager/drawschedule` | POST     | スケジュール描画   |

### 1.6 データ属性

空き枠セル（`.parts_schedule_body_column`）のdata属性:

| 属性         | 形式     | 説明       |
|--------------|----------|------------|
| `data-date`  | YYYYMMDD | 日付       |
| `data-start` | HHmm     | 開始時刻   |
| `data-end`   | HHmm     | 終了時刻   |
| `data-staff` | 数値     | スタッフID |

### 1.7 出力形式

```typescript
interface SlotInfo {
  date: string;         // 日付（YYYY-MM-DD形式）
  time: string;         // 時刻（HH:MM形式）
  duration_min: number; // 所要時間（分）
  stock: number;        // 空き枠数
  resource_name: string; // スタッフ名
}
```

---

## 2. 予約の作成

### 2.1 概要

アポイント管理台帳画面から新規予約を登録します。

### 2.2 処理フロー

```
1. 予約日のスケジュールを描画（Schedule.draw）
2. 予約登録ポップアップを表示（popup_registFromTable3UI 関数を呼び出し）
3. 簡易フォームが表示されるまで待機
4. 詳細情報ボタンをクリック（#btnOpenAppointHover）
5. 詳細フォームに顧客情報を入力:
   - WEBメニュー（#selAppointMenu）※任意
   - 姓（#txtAppointLastName）
   - 名（#txtAppointFirstName）
   - 電話番号（#txtAppointTelNo）
   - 備考（#txtAppointMemo）※任意
6. 登録ボタンをクリック（.guest_foot_entry）
7. registappoint API のレスポンスを確認
8. 成功時: 登録された予約のIDをDOMから取得
9. 失敗時: エラーコードを判定して返却
```

### 2.3 使用するグローバル関数

#### popup_registFromTable3UI

新規予約登録ポップアップを表示する関数。

```typescript
popup_registFromTable3UI(
  dateTime: string,    // 予約日時（YYYYMMDDHHMM形式）
  staffId: string,     // スタッフID
  lineNo: string,      // ライン番号
  lineType: string,    // ライン種別
  menuId: null,        // メニューID（未使用）
  hourFrom: string,    // 開始時刻の時（HH形式）
  minuteFrom: string,  // 開始時刻の分（mm形式）
  hourTo: string,      // 終了時刻の時（HH形式）
  minuteTo: string     // 終了時刻の分（mm形式）
)
```

### 2.4 使用するセレクター

| セレクター                           | 用途               |
|-------------------------------------|--------------------|
| `.register_appointment_simple_view` | 簡易予約フォーム   |
| `#btnOpenAppointHover`              | 詳細情報ボタン     |
| `.appointment_detail_info`          | 詳細予約フォーム   |
| `#selAppointMenu`                   | WEBメニュー選択    |
| `#txtAppointLastName`               | 姓入力欄           |
| `#txtAppointFirstName`              | 名入力欄           |
| `#txtAppointTelNo`                  | 電話番号入力欄     |
| `#txtAppointMemo`                   | 備考入力欄         |
| `.guest_foot_entry`                 | 登録ボタン         |

### 2.5 WEBメニュー選択

メニュー名（`menu_name`）は `option` 要素の `title` 属性と照合します。

### 2.6 使用するAPI

| エンドポイント                                   | メソッド  | 用途     |
|-------------------------------------------------|----------|----------|
| `/timeAppoint4M/scheduleregister/registappoint` | POST     | 予約登録 |

### 2.7 APIレスポンス

```typescript
interface RegistAppointResponse {
  result: boolean;          // 成功/失敗
  err_messages?: string[];  // エラーメッセージ配列
  alert_message?: string;   // アラートメッセージ
}
```

### 2.8 エラー判定

| 条件                                     | エラーコード            |
|------------------------------------------|-------------------------|
| `err_messages` に「他の予約が存在」を含む | `DUPLICATE_RESERVATION` |
| `alert_message` に「勤務時間外」を含む    | `SLOT_NOT_AVAILABLE`    |
| その他の失敗                             | `SYSTEM_ERROR`          |

### 2.9 予約IDの取得

登録成功後、DOM上の予約要素から`data-id`属性を取得します。

```
セレクター: .parts_schedule_body_reserve[data-date="{日付}"][data-start="{開始時刻}"][data-end="{終了時刻}"]
```

---

## 3. 予約のキャンセル

### 3.1 概要

既存の予約を検索し、キャンセル処理を実行します。

### 3.2 処理フロー

```
1. 予約日のスケジュールを描画（Schedule.draw）
2. DOM上で該当予約を検索（日時・顧客名・電話番号で照合）
3. 予約編集ポップアップを表示（popup_editFromTable3UI 関数を呼び出し）
4. 詳細フォームが表示されるまで待機
5. 受付キャンセルボタンをクリック（.guest_foot_cancel）
6. キャンセル確認ダイアログが表示されるまで待機
7. キャンセル理由を選択:
   - 当日の場合: 「当日、連絡なし」（#rdoReasonNoContact）
   - 当日以外: 「連絡あり」（#rdoReasonContact）
8. 決定ボタンをクリック（.guest_foot_confirm_cancel_appointment）
9. cancelappoint API のレスポンスを確認
10. 結果を返却
```

### 3.3 予約の検索

既存予約を特定するため、以下の条件でDOM要素を検索します:

1. 日付（`data-date`）と開始時刻（`data-start`）が一致
2. ラベルテキストに顧客名と電話番号が含まれる

ラベル形式: `院内予約 / テスト太郎 / 09012345678`

### 3.4 使用するグローバル関数

#### popup_editFromTable3UI

予約編集ポップアップを表示する関数。

```typescript
popup_editFromTable3UI(
  dateTime: number,   // 予約日時（YYYYMMDDHHMM形式の数値）
  staffId: number,    // スタッフID
  lineNo: number,     // ライン番号
  lineType: number,   // ライン種別
  appointId: string,  // 予約ID
  mode: number        // モード（1: 編集モード）
)
```

### 3.5 使用するセレクター

| セレクター                               | 用途                       |
|-----------------------------------------|----------------------------|
| `.parts_schedule_body_reserve`          | 予約要素                   |
| `.parts_schedule_body_reserve_label`    | 予約ラベル                 |
| `.appointment_detail_info.open`         | 詳細フォーム（開いた状態）   |
| `.guest_foot_cancel`                    | 受付キャンセルボタン         |
| `.confirm_cancel_appointment.open`      | キャンセル確認ダイアログ     |
| `#rdoReasonNoContact`                   | キャンセル理由（当日・連絡なし） |
| `#rdoReasonContact`                     | キャンセル理由（連絡あり）   |
| `.guest_foot_confirm_cancel_appointment` | キャンセル決定ボタン       |

### 3.6 使用するAPI

| エンドポイント                                   | メソッド  | 用途            |
|-------------------------------------------------|----------|-----------------|
| `/timeAppoint4M/scheduleregister/cancelappoint` | POST     | 予約キャンセル   |

### 3.7 APIレスポンス

```typescript
interface CancelAppointResponse {
  result: boolean;      // 成功/失敗
  messages?: string[];  // メッセージ配列
}
```

### 3.8 注意事項

- ラジオボタンはカスタムスタイルで`<span>`がオーバーレイされているため、クリック時に`force: true`オプションが必要
- 予約が見つからない場合は`RESERVATION_NOT_FOUND`エラーを返却

---

## 4. 予約の削除

### 4.1 概要

既存の予約を検索し、削除処理を実行します。

※ この機能はRPA SDK仕様にはない独自拡張です。キャンセルとは異なり、予約履歴を残さずに完全に削除します。

### 4.2 処理フロー

```
1. 予約日のスケジュールを描画（Schedule.draw）
2. DOM上で該当予約を検索（日時・顧客名・電話番号で照合）
3. 予約編集ポップアップを表示（popup_editFromTable3UI 関数を呼び出し）
4. 詳細フォームが表示されるまで待機
5. 受付削除ボタンをクリック（.guest_foot_remove）
6. 削除確認ダイアログが表示されるまで待機
7. OKボタンをクリック（.parts_dialog_ok）
8. deleteappoint API のレスポンスを確認
9. 結果を返却
```

### 4.3 予約の検索

キャンセルと同様の方法で予約を検索します（3.3 参照）。

### 4.4 使用するセレクター

| セレクター                            | 用途                     |
|--------------------------------------|--------------------------|
| `.parts_schedule_body_reserve`        | 予約要素                 |
| `.parts_schedule_body_reserve_label`  | 予約ラベル               |
| `.appointment_detail_info.open`       | 詳細フォーム（開いた状態） |
| `.guest_foot_remove`                  | 受付削除ボタン           |
| `.parts_dialog_home`                  | 削除確認ダイアログ       |
| `.parts_dialog_ok`                    | OKボタン                 |
| `.parts_dialog_cancel`                | キャンセルボタン         |

### 4.5 使用するAPI

| エンドポイント                                   | メソッド  | 用途     |
|-------------------------------------------------|----------|----------|
| `/timeAppoint4M/scheduleregister/deleteappoint` | POST     | 予約削除 |

### 4.6 APIレスポンス

```typescript
interface DeleteAppointResponse {
  result: boolean;      // 成功/失敗
  messages?: string[];  // メッセージ配列（失敗時）
}
```

### 4.7 注意事項

- 削除された予約は復元できません
- 予約が見つからない場合は`RESERVATION_NOT_FOUND`エラーを返却

---

## 5. エラーコード一覧

| コード                  | 説明           | 発生条件                          |
|-------------------------|----------------|---------------------------------|
| `AUTH_FAILED`           | 認証失敗       | ログイン失敗時                    |
| `TIMEOUT`               | タイムアウト   | Playwright操作タイムアウト時       |
| `SHOP_NOT_FOUND`        | 店舗が不正     | 店舗ページが404エラー              |
| `DUPLICATE_RESERVATION` | 重複予約       | 同一時間帯に既存予約あり            |
| `SLOT_NOT_AVAILABLE`    | 空き枠なし     | 勤務時間外への予約                 |
| `RESERVATION_NOT_FOUND` | 予約未発見     | キャンセル/削除対象が見つからない   |
| `SYSTEM_ERROR`          | システムエラー | その他のエラー                     |

---

## 6. スクリーンショット

各処理ステップでスクリーンショットを保存します。

### 6.1 ステップスクリーンショット

| ファイル名                          | タイミング                   |
|-------------------------------------|----------------------------|
| `01-login-page.png`                 | ログインページ表示時         |
| `02-after-login.png`                | ログイン完了後               |
| `03-appoint-page.png`               | アポイント管理台帳表示時      |
| `04-fetch-slots-{n}.png`            | 空き枠取得時（逐次取得の各回） |
| `05-{nn}-reservation-form.png`       | 予約フォーム表示時           |
| `06-{nn}-reservation-filled.png`     | フォーム入力完了時           |
| `07-{nn}-reservation-submitted.png`  | 予約登録完了時              |
| `05-{nn}-cancel-form.png`            | キャンセルフォーム表示時     |
| `06-{nn}-cancel-confirm-dialog.png`  | キャンセル確認ダイアログ     |
| `07-{nn}-cancel-submitted.png`       | キャンセル完了時            |
| `05-{nn}-delete-form.png`            | 削除フォーム表示時          |
| `06-{nn}-delete-confirm-dialog.png`  | 削除確認ダイアログ          |
| `07-{nn}-delete-submitted.png`       | 削除完了時                 |

### 6.2 エラースクリーンショット

| ファイル名                       | タイミング               |
|---------------------------------|-------------------------|
| `error-shop-not-found.png`      | 店舗404エラー時          |
| `error-auth.png`                | 認証エラー時             |
| `error-timeout.png`             | タイムアウト時           |
| `error-{nn}-reservation.png`     | 予約作成エラー時         |
| `error-{nn}-cancel-result.png`   | キャンセルAPIエラー時    |
| `error-{nn}-cancel.png`          | キャンセル例外時         |
| `error-{nn}-delete-result.png`   | 削除APIエラー時          |
| `error-{nn}-delete.png`          | 削除例外時              |

---

## 7. 関連資料

- [SmartCall RPA SDK 仕様書](https://github.com/milestone-corp/smartcall-rpa-sdk/blob/main/docs/API_SPEC.md)

---

## 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0 | 2025-12-25 | 初版作成 |
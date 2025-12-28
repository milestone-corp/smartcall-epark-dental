/**
 * 予約JSONファイルをEPARK歯科に一括登録するスクリプト
 *
 * 使用方法:
 *   npm run import -- <jsonファイルパス>
 *
 * 例:
 *   npm run import -- ./input/reservations_2025-12-28.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { ScreenshotManager } from '@smartcall/rpa-sdk';
import { LoginPage } from './pages/LoginPage.js';
import { AppointPage, type ReservationRequest, type ReservationResult } from './pages/AppointPage.js';

// dayjsのタイムゾーンプラグインを有効化
dayjs.extend(utc);
dayjs.extend(timezone);

async function main() {
  // コマンドライン引数からJSONファイルパスを取得
  const jsonPath = process.argv[2];

  if (!jsonPath) {
    console.error('使用方法: npm run import -- <JSONファイルパス>');
    console.error('例: npm run import -- ./input/reservations_2025-12-28.json');
    process.exit(1);
  }

  // 環境変数から認証情報を取得
  const loginKey = process.env.RPA_LOGIN_KEY;
  const loginPassword = process.env.RPA_LOGIN_PASSWORD;
  const shopId = process.env.EPARK_SHOP_ID;

  if (!loginKey || !loginPassword || !shopId) {
    console.error('環境変数を設定してください:');
    console.error('  RPA_LOGIN_KEY: EPARKログインID');
    console.error('  RPA_LOGIN_PASSWORD: EPARKログインパスワード');
    console.error('  EPARK_SHOP_ID: EPARK店舗ID');
    process.exit(1);
  }

  // JSONファイルを読み込み
  console.log(`\n📂 JSONファイル読み込み: ${jsonPath}`);
  let reservations: ReservationRequest[];
  try {
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    reservations = JSON.parse(jsonContent) as ReservationRequest[];
    console.log(`  予約件数: ${reservations.length}件\n`);
  } catch (error) {
    console.error(`ファイル読み込みエラー: ${error}`);
    process.exit(1);
  }

  // スクリーンショットマネージャーを準備
  const timestamp = dayjs().format('YYYYMMDD_HHmmss');
  const jobId = `import_${timestamp}`;
  const screenshot = new ScreenshotManager(jobId, {
    directory: './screenshots',
    enabled: true,
  });

  // ブラウザを起動
  console.log('🌐 ブラウザ起動中...');
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });

  const context = await browser.newContext({
    viewport: { width: 1485, height: 1440 },
  });

  const page = await context.newPage();

  const BASE_URL = `https://control.haisha-yoyaku.jp/${shopId}`;
  const results: ReservationResult[] = [];

  try {
    // ログインページに遷移
    console.log('🔑 ログイン中...');
    await page.goto(`${BASE_URL}/`);
    await screenshot.captureStep(page, '01-login-page');

    // ログインを実行
    const loginPage = new LoginPage(page);
    await loginPage.login(loginKey, loginPassword);
    await screenshot.captureStep(page, '02-after-login');
    console.log('  ログイン成功\n');

    // アポイント管理台帳ページに遷移
    const appointPage = new AppointPage(page, screenshot);
    await appointPage.navigate(BASE_URL);
    await screenshot.captureStep(page, '03-appoint-page');

    // 予約を1件ずつ処理
    console.log('📝 予約登録開始...\n');

    for (let i = 0; i < reservations.length; i++) {
      const reservation = reservations[i];
      const progress = `[${i + 1}/${reservations.length}]`;

      console.log(`${progress} ${reservation.reservation_id}`);
      console.log(`  日時: ${reservation.slot?.date} ${reservation.slot?.start_at}`);
      console.log(`  顧客: ${reservation.customer?.name}`);
      console.log(`  メニュー: ${reservation.menu?.menu_name}`);

      try {
        // 予約を処理
        const result = await appointPage.processReservations([reservation]);
        results.push(...result);

        const status = result[0]?.result.status;
        if (status === 'success') {
          console.log(`  ✅ 成功 (external_id: ${result[0]?.result.external_reservation_id})`);
        } else if (status === 'conflict') {
          console.log(`  ⚠️ 重複: ${result[0]?.result.error_message}`);
        } else {
          console.log(`  ❌ 失敗: ${result[0]?.result.error_message}`);
        }
      } catch (error) {
        console.log(`  ❌ エラー: ${error}`);
        results.push({
          reservation_id: reservation.reservation_id,
          operation: reservation.operation as 'create' | 'update' | 'cancel' | 'delete',
          result: {
            status: 'failed',
            error_code: 'SYSTEM_ERROR',
            error_message: error instanceof Error ? error.message : String(error),
          },
        });
      }

      console.log('');
    }

    // 結果サマリー
    const successCount = results.filter(r => r.result.status === 'success').length;
    const conflictCount = results.filter(r => r.result.status === 'conflict').length;
    const failedCount = results.filter(r => r.result.status === 'failed').length;

    console.log('='.repeat(50));
    console.log('📊 結果サマリー');
    console.log(`  成功: ${successCount}件`);
    console.log(`  重複: ${conflictCount}件`);
    console.log(`  失敗: ${failedCount}件`);
    console.log(`  合計: ${results.length}件`);
    console.log('='.repeat(50));

    // 結果をJSONファイルに保存
    const outputDir = './output';
    mkdirSync(outputDir, { recursive: true });
    const outputPath = `${outputDir}/import_results_${timestamp}.json`;
    writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n📁 結果ファイル: ${outputPath}`);

    await screenshot.captureStep(page, '99-completed');

  } catch (error) {
    console.error('\n❌ エラーが発生しました:', error);
    await screenshot.captureError(page, 'fatal-error');
    process.exit(1);
  } finally {
    await browser.close();
    console.log('\n🏁 完了');
  }
}

main();

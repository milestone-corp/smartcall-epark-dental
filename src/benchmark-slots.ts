/**
 * 空き枠取得の処理時間を計測するスクリプト
 *
 * 使用方法:
 *   npm run benchmark
 *
 * test_reservations.json の最初の予約日時でEPARKの空き枠チェックを行い、
 * 処理時間を表示します。
 */

import { readFileSync } from 'fs';
import { chromium } from 'playwright';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { ScreenshotManager } from '@smartcall/rpa-sdk';
import { LoginPage } from './pages/LoginPage.js';
import { AppointPage, type ReservationRequest } from './pages/AppointPage.js';

// dayjsのタイムゾーンプラグインを有効化
dayjs.extend(utc);
dayjs.extend(timezone);

async function main() {
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

  // test_reservations.json を読み込み
  const jsonPath = './input/test_reservations.json';
  console.log(`\n📂 JSONファイル読み込み: ${jsonPath}`);
  let reservations: ReservationRequest[];
  try {
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    reservations = JSON.parse(jsonContent) as ReservationRequest[];
  } catch (error) {
    console.error(`ファイル読み込みエラー: ${error}`);
    process.exit(1);
  }

  if (reservations.length === 0) {
    console.error('予約データがありません');
    process.exit(1);
  }

  // 最初の予約から日時を取得
  const firstReservation = reservations[0];
  const targetDate = firstReservation.slot?.date;
  const targetTime = firstReservation.slot?.start_at;

  if (!targetDate) {
    console.error('予約日付が設定されていません');
    process.exit(1);
  }

  console.log(`\n📅 対象日時: ${targetDate} ${targetTime || ''}`);
  console.log(`👤 顧客: ${firstReservation.customer?.name}`);
  console.log(`📋 メニュー: ${firstReservation.menu?.menu_name}`);

  // スクリーンショットマネージャーを準備
  const timestamp = dayjs().format('YYYYMMDD_HHmmss');
  const jobId = `benchmark_${timestamp}`;
  const screenshot = new ScreenshotManager(jobId, {
    directory: './screenshots',
    enabled: true,
  });

  // ブラウザを起動
  console.log('\n🌐 ブラウザ起動中...');
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });

  const context = await browser.newContext({
    viewport: { width: 1485, height: 1440 },
  });

  const page = await context.newPage();

  const BASE_URL = `https://control.haisha-yoyaku.jp/${shopId}`;

  try {
    // ログインページに遷移
    console.log('🔑 ログイン中...');
    const loginStart = performance.now();
    await page.goto(`${BASE_URL}/`);
    await screenshot.captureStep(page, '01-login-page');

    // ログインを実行
    const loginPage = new LoginPage(page);
    await loginPage.login(loginKey, loginPassword);
    await screenshot.captureStep(page, '02-after-login');
    const loginEnd = performance.now();
    console.log(`  ログイン成功 (${(loginEnd - loginStart).toFixed(0)}ms)`);

    // アポイント管理台帳ページに遷移
    console.log('\n📊 アポイント管理台帳へ遷移中...');
    const navigateStart = performance.now();
    const appointPage = new AppointPage(page, screenshot);
    await appointPage.navigate(BASE_URL);
    await screenshot.captureStep(page, '03-appoint-page');
    const navigateEnd = performance.now();
    console.log(`  遷移完了 (${(navigateEnd - navigateStart).toFixed(0)}ms)`);

    // 空き枠取得（1日分）
    console.log('\n🔍 空き枠取得中...');
    console.log(`  期間: ${targetDate} ～ ${targetDate}`);

    const slotStart = performance.now();
    const slots = await appointPage.getAvailableSlots(targetDate, targetDate);
    const slotEnd = performance.now();

    const slotTime = slotEnd - slotStart;
    console.log(`\n⏱️  空き枠取得時間: ${slotTime.toFixed(0)}ms`);
    console.log(`📦 取得した空き枠数: ${slots.length}件`);

    // 指定時刻の空き枠を検索
    if (targetTime) {
      const matchingSlots = slots.filter(s => s.time === targetTime);
      console.log(`\n🎯 ${targetTime} の空き枠: ${matchingSlots.length}件`);
      if (matchingSlots.length > 0) {
        matchingSlots.forEach(s => {
          console.log(`   - ${s.resource_name || '担当者なし'} (${s.duration_min}分)`);
        });
      }
    }

    // 時間帯別の空き枠サマリー
    console.log('\n📈 時間帯別サマリー:');
    const timeMap = new Map<string, number>();
    slots.forEach(s => {
      timeMap.set(s.time, (timeMap.get(s.time) || 0) + 1);
    });
    const sortedTimes = Array.from(timeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedTimes.slice(0, 10).forEach(([time, count]) => {
      console.log(`   ${time}: ${count}枠`);
    });
    if (sortedTimes.length > 10) {
      console.log(`   ... 他 ${sortedTimes.length - 10} 時間帯`);
    }

    await screenshot.captureStep(page, '99-completed');

    // 結果サマリー
    console.log('\n' + '='.repeat(50));
    console.log('📊 計測結果サマリー');
    console.log('='.repeat(50));
    console.log(`  ログイン時間:     ${(loginEnd - loginStart).toFixed(0)}ms`);
    console.log(`  ページ遷移時間:   ${(navigateEnd - navigateStart).toFixed(0)}ms`);
    console.log(`  空き枠取得時間:   ${slotTime.toFixed(0)}ms`);
    console.log(`  合計時間:         ${(slotEnd - loginStart).toFixed(0)}ms`);
    console.log('='.repeat(50));

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

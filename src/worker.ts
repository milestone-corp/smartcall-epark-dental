/**
 * SmartCall RPA API ワーカー
 *
 * キューからジョブを取得し、Playwrightでブラウザ操作を行います。
 */

import {
  createRpaJob,
  getCredentials,
  type RpaJobContext,
  type RpaJobData,
} from '@smartcall/rpa-sdk';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { LoginPage } from './pages/LoginPage.js';
import { AppointPage } from './pages/AppointPage.js';

// dayjsのタイムゾーンプラグインを有効化
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * RPAジョブを作成
 */
createRpaJob<RpaJobData>(
  'sync',
  async (ctx: RpaJobContext<RpaJobData>) => {
    const { page, data, screenshot, logger, sendCallback, buildResult } = ctx;

    logger.info({ jobId: data.job_id, shopId: data.external_shop_id }, 'Starting job');

    const BASE_URL = `https://control.haisha-yoyaku.jp/${data.external_shop_id}`;

    // 1. 認証情報を取得（環境変数から）
    const credentials = getCredentials();

    // 2. ログインページに遷移
    await page.goto(`${BASE_URL}/`);
    await screenshot.captureStep(page, '01-login-page');

    // 3. ログインを実行
    const loginPage = new LoginPage(page);
    await loginPage.login(credentials.loginKey, credentials.loginPassword);
    await screenshot.captureStep(page, '02-after-login');

    // 4. アポイント管理台帳ページに遷移
    const appointPage = new AppointPage(page);
    await appointPage.navigate(BASE_URL);
    await screenshot.captureStep(page, '03-appoint-page');

    // 5. 空き枠を取得
    const today = dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
    const dateFrom = data.date_from || today;
    const dateTo = data.date_to || dateFrom; // date_toが未指定の場合はdateFromと同じ

    logger.info({ dateFrom, dateTo }, 'Fetching available slots');

    const slots = await appointPage.getAvailableSlots(dateFrom, dateTo);
    await screenshot.captureStep(page, '04-after-fetch-slots');

    logger.info({ slotCount: slots.length }, 'Fetched available slots');

    // 6. コールバックで結果を送信
    await sendCallback(
      buildResult('success', {
        type: 'available_slots',
        slots,
      })
    );

    logger.info('Job completed successfully');
  },
  {
    browser: {
      headless: true,
    },
    screenshot: {
      directory: process.env.SCREENSHOT_DIR || './screenshots',
    },
    concurrency: 1,
  }
);

console.log('[Worker] Started, waiting for jobs...');

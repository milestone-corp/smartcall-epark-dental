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
  type ReservationRequest,
} from '@smartcall/rpa-sdk';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { errors as playwrightErrors } from 'playwright';
import { AuthError, LoginPage } from './pages/LoginPage.js';
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

    try {
      // 1. 認証情報を取得（環境変数から）
      const credentials = getCredentials();

      // 2. ログインページに遷移
      const response = await page.goto(`${BASE_URL}/`);

      // 404エラーの場合は店舗が見つからない
      if (response?.status() === 404) {
        logger.error({ shopId: data.external_shop_id }, 'Shop not found (404)');
        await screenshot.captureError(page, 'shop-not-found');

        await sendCallback(
          buildResult('failed', {
            error: {
              code: 'SHOP_NOT_FOUND',
              message: '指定された店舗が見つかりません',
            },
          })
        );
        return;
      }

      await screenshot.captureStep(page, '01-login-page');

      // 3. ログインを実行
      const loginPage = new LoginPage(page);
      await loginPage.login(credentials.loginKey, credentials.loginPassword);
      await screenshot.captureStep(page, '02-after-login');

      // 4. アポイント管理台帳ページに遷移
      const appointPage = new AppointPage(page, screenshot);
      await appointPage.navigate(BASE_URL);
      await screenshot.captureStep(page, '03-appoint-page');

      // 5. 空き枠を取得
      const today = dayjs().tz('Asia/Tokyo');
      const dateFrom = data.date_from || today.format('YYYY-MM-DD');
      const dateTo = data.date_to || today.add(7, 'day').format('YYYY-MM-DD'); // デフォルト: 7日後

      logger.info({ dateFrom, dateTo }, 'Fetching available slots');

      const slots = await appointPage.getAvailableSlots(dateFrom, dateTo);

      logger.info({ slotCount: slots.length }, 'Fetched available slots');

      // 6. 予約操作を処理
      const reservations = (data.reservations || []) as ReservationRequest[];
      let reservationResults: { reservation_id: string; operation: string; status: string }[] = [];

      if (reservations.length > 0) {
        logger.info({ reservationCount: reservations.length }, 'Processing reservations');
        reservationResults = await appointPage.processReservations(reservations);
        logger.info({ results: reservationResults }, 'Reservation processing completed');
      }

      // 7. コールバックで結果を送信
      // 予約結果からステータスを判定
      const successCount = reservationResults.filter((r) => r.status === 'success').length;
      const totalCount = reservationResults.length;

      let jobStatus: 'success' | 'partial_success' | 'failed';
      let errorInfo: { code: string; message: string } | undefined;

      if (totalCount === 0 || successCount === totalCount) {
        // 予約操作なし、または全て成功
        jobStatus = 'success';
      } else if (successCount > 0) {
        // 一部成功
        jobStatus = 'partial_success';
        errorInfo = {
          code: 'PARTIAL_FAILURE',
          message: '一部の予約処理に失敗しました',
        };
      } else {
        // 全て失敗
        jobStatus = 'failed';
        errorInfo = {
          code: 'ALL_FAILED',
          message: '全ての予約処理に失敗しました',
        };
      }

      await sendCallback(
        buildResult(jobStatus, {
          available_slots: slots,
          reservation_results: reservationResults,
          ...(errorInfo && { error: errorInfo }),
        })
      );

      logger.info({ jobStatus }, 'Job completed');

      // エラーがある場合はスクリーンショット保持のためにthrow
      if (errorInfo) {
        throw new Error(errorInfo.message);
      }
    } catch (error) {
      // 認証エラーの場合
      if (error instanceof AuthError) {
        logger.error({ error: error.message }, 'Authentication failed');
        await screenshot.captureError(page, 'auth-error');

        await sendCallback(
          buildResult('failed', {
            error: {
              code: error.code,
              message: error.message,
            },
          })
        );
        throw error;
      }

      // Playwrightタイムアウトエラーの場合
      if (error instanceof playwrightErrors.TimeoutError) {
        logger.error({ error: error.message }, 'Timeout error');
        await screenshot.captureError(page, 'timeout-error');

        await sendCallback(
          buildResult('failed', {
            error: {
              code: 'TIMEOUT',
              message: error.message,
            },
          })
        );
        throw error;
      }

      // エラーは再スロー
      throw error;
    }
  },
  {
    browser: {
      headless: true,
      viewport: {
        width: 1485,
        height: 1440,
      }
    },
    screenshot: {
      directory: process.env.SCREENSHOT_DIR || './screenshots',
    },
    concurrency: 1,
  }
);

console.log('[Worker] Started, waiting for jobs...');

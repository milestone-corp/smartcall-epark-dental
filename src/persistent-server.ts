/**
 * 常駐ブラウザサーバー
 *
 * ログイン済みブラウザを常駐させ、リクエストを高速に処理する
 * 認証情報はリクエストヘッダーから動的に取得
 *
 * エンドポイント:
 *   GET  /health - ヘルスチェック
 *   GET  /status - 詳細ステータス
 *   GET  /slots - 空き枠取得
 *   GET  /reservations/search - 予約検索
 *   POST /reservations - 予約作成
 *   DELETE /reservations - 予約キャンセル
 *   POST /session/restart - セッション再起動
 *
 * 使用方法:
 *   npm run start:persistent
 */

import express, { type Request, type Response } from 'express';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { ScreenshotManager } from '@smartcall/rpa-sdk';
import {
  BrowserSessionManager,
  type Credentials,
} from './lib/BrowserSessionManager.js';
import { AppointPage } from './pages/AppointPage.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// 設定
const PORT = process.env.PORT || 3000;
const KEEP_ALIVE_INTERVAL_MS = parseInt(
  process.env.KEEP_ALIVE_INTERVAL_MS || '300000',
  10
); // 5分
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || '600000',
  10
); // 10分

// セッションマネージャー（後から認証情報を設定するため、nullableに）
let sessionManager: BrowserSessionManager | null = null;
let currentCredentials: Credentials | null = null;
let currentShopId: string | null = null;

// Express アプリ
const app = express();
app.use(express.json());

// CORS対応（管理画面からのリクエストを許可）
app.use((req: Request, res: Response, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, X-RPA-Login-Id, X-RPA-Login-Password, X-RPA-Shop-Id, X-RPA-Test-Mode'
  );
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  // Preflightリクエストへの対応
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

/**
 * リクエストヘッダーから認証情報を取得
 */
function getCredentialsFromRequest(
  req: Request,
  requireShopId: boolean = true
): {
  credentials: Credentials;
  shopId: string;
} | null {
  const loginKey = req.headers['x-rpa-login-id'] as string;
  const loginPassword = req.headers['x-rpa-login-password'] as string;
  const shopId = (req.headers['x-rpa-shop-id'] as string) || '';

  if (!loginKey || !loginPassword) {
    return null;
  }

  if (requireShopId && !shopId) {
    return null;
  }

  return {
    credentials: { loginKey, loginPassword },
    shopId,
  };
}

/**
 * 認証情報が変更されたかチェック
 */
function hasCredentialsChanged(
  credentials: Credentials,
  shopId: string
): boolean {
  if (!currentCredentials || !currentShopId) {
    return true;
  }

  return (
    currentCredentials.loginKey !== credentials.loginKey ||
    currentCredentials.loginPassword !== credentials.loginPassword ||
    currentShopId !== shopId
  );
}

/**
 * セッションマネージャーを初期化または再初期化
 */
async function ensureSessionManager(
  credentials: Credentials,
  shopId: string
): Promise<void> {
  // shopIdが空の場合はログインページのみ（店舗固有のURLなし）
  const baseUrl = shopId
    ? `https://control.haisha-yoyaku.jp/${shopId}`
    : 'https://control.haisha-yoyaku.jp';

  // 認証情報が変更された場合は再初期化
  if (hasCredentialsChanged(credentials, shopId)) {
    console.log(
      `[PersistentServer] Credentials changed, reinitializing session...`
    );

    // 既存セッションをクローズ
    if (sessionManager) {
      try {
        await sessionManager.close();
      } catch (error) {
        console.error('[PersistentServer] Error closing old session:', error);
      }
    }

    // 新しいセッションマネージャーを作成
    sessionManager = new BrowserSessionManager({
      credentials,
      baseUrl,
      headless: process.env.HEADLESS !== 'false',
      viewport: { width: 1485, height: 1440 },
      keepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
    });

    // イベントハンドラー設定
    setupSessionEvents(sessionManager);

    // セッション開始
    await sessionManager.start();

    // 現在の認証情報を保存
    currentCredentials = credentials;
    currentShopId = shopId;

    console.log(`[PersistentServer] Session initialized for shop ${shopId}`);
  }
}

/**
 * セッションイベントハンドラーを設定
 */
function setupSessionEvents(manager: BrowserSessionManager): void {
  manager.on(
    'stateChange',
    (state: SessionState, previousState: SessionState) => {
      console.log(
        `[PersistentServer] Session state: ${previousState} -> ${state}`
      );
    }
  );

  manager.on('error', (error: Error) => {
    console.error('[PersistentServer] Session error:', error);
  });

  manager.on('sessionExpired', () => {
    console.warn('[PersistentServer] Session expired, recovering...');
  });

  manager.on('recovered', () => {
    console.log('[PersistentServer] Session recovered');
  });
}

/**
 * ヘルスチェックエンドポイント
 */
app.get('/health', (_req: Request, res: Response) => {
  const state = sessionManager?.getState() || 'not_initialized';

  res.json({
    status: state === 'ready' || state === 'busy' ? 'ok' : 'degraded',
    session_state: state,
    has_credentials: currentCredentials !== null,
    shop_id: currentShopId,
  });
});

/**
 * 詳細ステータスエンドポイント
 */
app.get('/status', (_req: Request, res: Response) => {
  res.json({
    session: {
      state: sessionManager?.getState() || 'not_initialized',
      last_activity: sessionManager?.getLastActivityTime()?.toISOString() || null,
      shop_id: currentShopId,
    },
    config: {
      keep_alive_interval_ms: KEEP_ALIVE_INTERVAL_MS,
      request_timeout_ms: REQUEST_TIMEOUT_MS,
    },
  });
});

/**
 * 空き枠取得エンドポイント
 * GET /slots?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 */
app.get('/slots', async (req: Request, res: Response) => {
  const authInfo = getCredentialsFromRequest(req);
  if (!authInfo) {
    res.status(401).json({
      success: false,
      error: 'Missing authentication headers. Required: X-RPA-Login-Id, X-RPA-Login-Password, X-RPA-Shop-Id',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const dateFrom = (req.query.date_from as string) || dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
  const dateTo = (req.query.date_to as string) || dateFrom;
  const isTestMode = req.headers['x-rpa-test-mode'] === 'true';

  try {
    await ensureSessionManager(authInfo.credentials, authInfo.shopId);

    if (!sessionManager || sessionManager.getState() !== 'ready') {
      res.status(503).json({
        success: false,
        error: 'Session not ready',
        code: 'SESSION_NOT_READY',
      });
      return;
    }

    const startTime = Date.now();
    const page = await sessionManager.acquirePage();

    try {
      const screenshot = new ScreenshotManager('./screenshots');
      const appointPage = new AppointPage(page, screenshot);
      const baseUrl = `https://control.haisha-yoyaku.jp/${authInfo.shopId}`;
      await appointPage.navigate(baseUrl);

      // 空き枠を取得
      const slots = await appointPage.getAvailableSlots(dateFrom, dateTo);

      // テストモードの場合はスクリーンショットを取得
      let screenshotBase64: string | undefined;
      if (isTestMode) {
        try {
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          screenshotBase64 = screenshotBuffer.toString('base64');
        } catch (screenshotError) {
          console.error('[PersistentServer] Screenshot failed:', screenshotError);
        }
      }

      sessionManager.releasePage();

      const response: Record<string, unknown> = {
        success: true,
        available_slots: slots,
        count: slots.length,
        timing: { total_ms: Date.now() - startTime },
      };

      if (screenshotBase64) {
        response.screenshot = screenshotBase64;
      }

      res.json(response);
    } catch (error) {
      sessionManager.releasePage();
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/**
 * 予約検索エンドポイント
 * 電話番号で予約を検索する
 */
app.get('/reservations/search', async (req: Request, res: Response) => {
  // 認証情報をヘッダーから取得
  const authInfo = getCredentialsFromRequest(req);
  if (!authInfo) {
    res.status(401).json({
      success: false,
      error:
        'Missing authentication headers. Required: X-RPA-Login-Id, X-RPA-Login-Password, X-RPA-Shop-Id',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const customerPhone = req.query.customer_phone as string;
  if (!customerPhone) {
    res.status(400).json({
      success: false,
      error: 'Missing required parameter: customer_phone',
      code: 'INVALID_REQUEST',
    });
    return;
  }

  const dateFrom =
    (req.query.date_from as string) ||
    dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
  const dateTo = (req.query.date_to as string) || dateFrom;
  const isTestMode = req.headers['x-rpa-test-mode'] === 'true';

  try {
    // セッションを確保
    await ensureSessionManager(authInfo.credentials, authInfo.shopId);

    if (!sessionManager || sessionManager.getState() !== 'ready') {
      res.status(503).json({
        success: false,
        error: 'Session not ready',
        code: 'SESSION_NOT_READY',
      });
      return;
    }

    const startTime = Date.now();
    const page = await sessionManager.acquirePage();

    try {
      const screenshot = new ScreenshotManager('./screenshots');
      const appointPage = new AppointPage(page, screenshot);

      // アポイント管理画面に遷移
      const baseUrl = `https://control.haisha-yoyaku.jp/${authInfo.shopId}`;
      await appointPage.navigate(baseUrl);

      // 電話番号で予約を検索
      const reservations = await appointPage.searchReservationsByPhone(
        dateFrom,
        dateTo,
        customerPhone
      );

      // テストモードの場合はスクリーンショットを取得
      let screenshotBase64: string | undefined;
      if (isTestMode) {
        try {
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          screenshotBase64 = screenshotBuffer.toString('base64');
          console.log(
            `[PersistentServer] Test screenshot captured: ${(screenshotBuffer.length / 1024).toFixed(1)}KB`
          );
        } catch (screenshotError) {
          console.error(
            '[PersistentServer] Failed to capture test screenshot:',
            screenshotError
          );
        }
      }

      sessionManager.releasePage();

      const response: Record<string, unknown> = {
        success: true,
        reservations,
        count: reservations.length,
        timing: {
          total_ms: Date.now() - startTime,
        },
      };

      if (screenshotBase64) {
        response.screenshot = screenshotBase64;
      }

      res.json(response);
    } catch (error) {
      sessionManager.releasePage();
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/**
 * 予約作成エンドポイント
 * POST /reservations
 */
app.post('/reservations', async (req: Request, res: Response) => {
  const authInfo = getCredentialsFromRequest(req);
  if (!authInfo) {
    res.status(401).json({
      success: false,
      error: 'Missing authentication headers. Required: X-RPA-Login-Id, X-RPA-Login-Password, X-RPA-Shop-Id',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const { date, time, duration_min, customer_name, customer_phone, menu_name } = req.body;
  const isTestMode = req.headers['x-rpa-test-mode'] === 'true';

  if (!date || !time || !customer_name || !customer_phone) {
    res.status(400).json({
      success: false,
      error: 'Missing required parameters: date, time, customer_name, customer_phone',
      code: 'INVALID_REQUEST',
    });
    return;
  }

  try {
    await ensureSessionManager(authInfo.credentials, authInfo.shopId);

    if (!sessionManager || sessionManager.getState() !== 'ready') {
      res.status(503).json({
        success: false,
        error: 'Session not ready',
        code: 'SESSION_NOT_READY',
      });
      return;
    }

    const startTime = Date.now();
    const page = await sessionManager.acquirePage();

    try {
      const screenshot = new ScreenshotManager('./screenshots');
      const appointPage = new AppointPage(page, screenshot);
      const baseUrl = `https://control.haisha-yoyaku.jp/${authInfo.shopId}`;
      await appointPage.navigate(baseUrl);

      // 予約を作成
      const reservations = [{
        reservation_id: `create_${Date.now()}`,
        operation: 'create' as const,
        slot: { date, start_at: time, duration_min: duration_min || 30 },
        customer: { name: customer_name, phone: customer_phone },
        menu: { menu_name: menu_name || '' },
      }];

      const results = await appointPage.processReservations(reservations);
      const result = results[0];

      // テストモードの場合はスクリーンショットを取得
      let screenshotBase64: string | undefined;
      if (isTestMode) {
        try {
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          screenshotBase64 = screenshotBuffer.toString('base64');
        } catch (screenshotError) {
          console.error('[PersistentServer] Screenshot failed:', screenshotError);
        }
      }

      sessionManager.releasePage();

      const response: Record<string, unknown> = {
        success: result.result.status === 'success',
        reservation_id: result.reservation_id,
        external_reservation_id: result.result.external_reservation_id,
        error: result.result.status !== 'success' ? result.result.error_message : undefined,
        error_code: result.result.error_code,
        timing: { total_ms: Date.now() - startTime },
      };

      if (screenshotBase64) {
        response.screenshot = screenshotBase64;
      }

      res.json(response);
    } catch (error) {
      sessionManager.releasePage();
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/**
 * 予約キャンセルエンドポイント
 * DELETE /reservations
 */
app.delete('/reservations', async (req: Request, res: Response) => {
  const authInfo = getCredentialsFromRequest(req);
  if (!authInfo) {
    res.status(401).json({
      success: false,
      error: 'Missing authentication headers. Required: X-RPA-Login-Id, X-RPA-Login-Password, X-RPA-Shop-Id',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  const { date, time, customer_name, customer_phone } = req.body;
  const isTestMode = req.headers['x-rpa-test-mode'] === 'true';

  if (!date || !time || !customer_name || !customer_phone) {
    res.status(400).json({
      success: false,
      error: 'Missing required parameters: date, time, customer_name, customer_phone',
      code: 'INVALID_REQUEST',
    });
    return;
  }

  try {
    await ensureSessionManager(authInfo.credentials, authInfo.shopId);

    if (!sessionManager || sessionManager.getState() !== 'ready') {
      res.status(503).json({
        success: false,
        error: 'Session not ready',
        code: 'SESSION_NOT_READY',
      });
      return;
    }

    const startTime = Date.now();
    const page = await sessionManager.acquirePage();

    try {
      const screenshot = new ScreenshotManager('./screenshots');
      const appointPage = new AppointPage(page, screenshot);
      const baseUrl = `https://control.haisha-yoyaku.jp/${authInfo.shopId}`;
      await appointPage.navigate(baseUrl);

      // 予約をキャンセル
      const reservations = [{
        reservation_id: `cancel_${Date.now()}`,
        operation: 'cancel' as const,
        slot: { date, start_at: time },
        customer: { name: customer_name, phone: customer_phone },
      }];

      const results = await appointPage.processReservations(reservations);
      const result = results[0];

      // テストモードの場合はスクリーンショットを取得
      let screenshotBase64: string | undefined;
      if (isTestMode) {
        try {
          const screenshotBuffer = await page.screenshot({ fullPage: false });
          screenshotBase64 = screenshotBuffer.toString('base64');
        } catch (screenshotError) {
          console.error('[PersistentServer] Screenshot failed:', screenshotError);
        }
      }

      sessionManager.releasePage();

      const response: Record<string, unknown> = {
        success: result.result.status === 'success',
        reservation_id: result.reservation_id,
        error: result.result.status !== 'success' ? result.result.error_message : undefined,
        error_code: result.result.error_code,
        timing: { total_ms: Date.now() - startTime },
      };

      if (screenshotBase64) {
        response.screenshot = screenshotBase64;
      }

      res.json(response);
    } catch (error) {
      sessionManager.releasePage();
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/**
 * セッション再起動エンドポイント
 */
app.post('/session/restart', async (req: Request, res: Response) => {
  // 認証情報をヘッダーから取得（shopIdは任意）
  const authInfo = getCredentialsFromRequest(req, false);
  if (!authInfo) {
    res.status(401).json({
      success: false,
      error:
        'Missing authentication headers. Required: X-RPA-Login-Id, X-RPA-Login-Password',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  try {
    console.log(
      `[PersistentServer] Session restart requested for shop ${authInfo.shopId}`
    );

    // 強制的に再初期化するために現在の認証情報をクリア
    currentCredentials = null;
    currentShopId = null;

    await ensureSessionManager(authInfo.credentials, authInfo.shopId);

    // ログイン後のスクリーンショットを撮影
    let screenshotBase64: string | null = null;
    if (sessionManager && sessionManager.getState() === 'ready') {
      try {
        const page = await sessionManager.acquirePage();
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        screenshotBase64 = screenshotBuffer.toString('base64');
        sessionManager.releasePage();
      } catch (screenshotError) {
        console.error('[PersistentServer] Screenshot failed:', screenshotError);
      }
    }

    res.json({
      success: true,
      message: 'Session restarted',
      screenshot: screenshotBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * サーバー起動
 */
async function main() {
  console.log('[PersistentServer] Starting...');
  console.log(`[PersistentServer] Keep-alive interval: ${KEEP_ALIVE_INTERVAL_MS}ms`);
  console.log('[PersistentServer] Mode: Dynamic credentials (auth from request headers)');

  // HTTPサーバー起動（セッションは最初のリクエスト時に初期化）
  app.listen(PORT, () => {
    console.log(`[PersistentServer] Running on port ${PORT}`);
    console.log('[PersistentServer] Endpoints:');
    console.log('  - GET  /health');
    console.log('  - GET  /status');
    console.log('  - GET  /slots?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD');
    console.log('  - GET  /reservations/search?customer_phone=XXX&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD');
    console.log('  - POST /reservations (create)');
    console.log('  - DELETE /reservations (cancel)');
    console.log('  - POST /session/restart');
    console.log('[PersistentServer] Required headers:');
    console.log('  - X-RPA-Login-Id: EPARK login ID');
    console.log('  - X-RPA-Login-Password: EPARK password');
    console.log('  - X-RPA-Shop-Id: EPARK shop ID');
  });

  // グレースフルシャットダウン
  const shutdown = async () => {
    console.log('[PersistentServer] Shutting down...');
    if (sessionManager) {
      await sessionManager.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[PersistentServer] Fatal error:', error);
  process.exit(1);
});

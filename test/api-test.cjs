/**
 * EPARK Dental API エンドポイントテスト
 *
 * 全エンドポイントをテストする
 *
 * 使用方法:
 *   node test/api-test.cjs
 *
 * 環境変数（.envから自動読み込み）:
 *   RPA_LOGIN_KEY - EPARKログインID
 *   RPA_LOGIN_PASSWORD - EPARKパスワード
 *   EPARK_SHOP_ID - EPARKショップID
 *   API_BASE_URL - APIベースURL（デフォルト: http://localhost:3000）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// .envファイルを読み込み
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

// 設定
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const LOGIN_ID = process.env.RPA_LOGIN_KEY;
const LOGIN_PASSWORD = process.env.RPA_LOGIN_PASSWORD;
const SHOP_ID = process.env.EPARK_SHOP_ID;

// テストデータ
const TEST_DATE = getTestDate(); // 90日後
const TEST_TIME = '10:00';
const TEST_CUSTOMER_NAME = 'テスト テスト';
const TEST_CUSTOMER_PHONE = '09020787562';
const TEST_MENU_NAME = '歯の清掃';
const TEST_DURATION_MIN = 30;

// スクリーンショット保存先
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

/**
 * スクリーンショット保存用ディレクトリを作成
 */
function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

/**
 * スクリーンショットを保存
 */
function saveScreenshot(base64Data, filename) {
  if (!base64Data) return null;
  ensureScreenshotDir();
  const filepath = path.join(SCREENSHOT_DIR, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filepath, buffer);
  console.log(`   📸 Screenshot saved: ${filepath}`);
  return filepath;
}

/**
 * タイムスタンプ付きファイル名を生成
 */
function getTimestampedFilename(prefix) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${timestamp}.png`;
}

/**
 * 90日後の日付を取得
 */
function getTestDate() {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * HTTPリクエストを実行
 */
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE_URL);
    const bodyString = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-RPA-Login-Id': LOGIN_ID,
        'X-RPA-Login-Password': LOGIN_PASSWORD,
        'X-RPA-Shop-Id': SHOP_ID,
        'X-RPA-Test-Mode': 'true',
      },
    };

    // ボディがある場合はContent-Lengthヘッダーを追加
    if (bodyString) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(600000); // 10分タイムアウト

    if (bodyString) {
      req.write(bodyString);
    }
    req.end();
  });
}

/**
 * テスト結果を表示
 */
function printResult(testName, success, details = '') {
  const icon = success ? '✅' : '❌';
  console.log(`${icon} ${testName}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

/**
 * テスト実行
 */
async function runTests() {
  console.log('========================================');
  console.log('EPARK Dental API テスト');
  console.log('========================================');
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`Shop ID: ${SHOP_ID}`);
  console.log(`Test Date: ${TEST_DATE}`);
  console.log(`Test Time: ${TEST_TIME}`);
  console.log(`Customer: ${TEST_CUSTOMER_NAME}`);
  console.log(`Phone: ${TEST_CUSTOMER_PHONE}`);
  console.log(`Menu: ${TEST_MENU_NAME}`);
  console.log('========================================\n');

  // 認証情報チェック
  if (!LOGIN_ID || !LOGIN_PASSWORD || !SHOP_ID) {
    console.error('❌ 環境変数が設定されていません:');
    console.error('   EPARK_LOGIN_ID, EPARK_LOGIN_PASSWORD, EPARK_SHOP_ID');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  let createdReservation = null;

  // 1. ヘルスチェック
  console.log('\n--- 1. ヘルスチェック ---');
  try {
    const res = await request('GET', '/health');
    const success = res.status === 200;
    printResult('GET /health', success, `status=${res.data.status}, session=${res.data.session_state}`);
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('01_health'));
    }
    success ? passed++ : failed++;
  } catch (error) {
    printResult('GET /health', false, error.message);
    failed++;
  }

  // 2. ステータス確認
  console.log('\n--- 2. ステータス確認 ---');
  try {
    const res = await request('GET', '/status');
    const success = res.status === 200;
    printResult('GET /status', success, `session_state=${res.data.session?.state}`);
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('02_status'));
    }
    success ? passed++ : failed++;
  } catch (error) {
    printResult('GET /status', false, error.message);
    failed++;
  }

  // 3. 空き枠取得
  console.log('\n--- 3. 空き枠取得 ---');
  try {
    const res = await request('GET', `/slots?date_from=${TEST_DATE}&date_to=${TEST_DATE}`);
    const success = res.status === 200 && res.data.success;
    printResult('GET /slots', success, `count=${res.data.count}, timing=${res.data.timing?.total_ms}ms`);
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('03_slots'));
    }
    success ? passed++ : failed++;
  } catch (error) {
    printResult('GET /slots', false, error.message);
    failed++;
  }

  // 4. 予約作成
  console.log('\n--- 4. 予約作成 ---');
  try {
    // 予約前のスクリーンショットを取得（/slotsで現在の画面を取得）
    const beforeRes = await request('GET', `/slots?date_from=${TEST_DATE}&date_to=${TEST_DATE}`);
    if (beforeRes.data.screenshot) {
      saveScreenshot(beforeRes.data.screenshot, getTimestampedFilename('04_reservation_before'));
    }

    const body = {
      date: TEST_DATE,
      time: TEST_TIME,
      duration_min: TEST_DURATION_MIN,
      customer_name: TEST_CUSTOMER_NAME,
      customer_phone: TEST_CUSTOMER_PHONE,
      menu_name: TEST_MENU_NAME,
    };
    const res = await request('POST', '/reservations', body);
    const success = res.status === 200 && res.data.success;
    printResult(
      'POST /reservations',
      success,
      success
        ? `reservation_id=${res.data.reservation_id}, external_id=${res.data.external_reservation_id}`
        : `error=${res.data.error}`
    );
    // 予約後のスクリーンショット
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('04_reservation_after'));
    }
    if (success) {
      createdReservation = {
        date: TEST_DATE,
        time: TEST_TIME,
        external_reservation_id: res.data.external_reservation_id,
      };
      passed++;
    } else {
      failed++;
    }
  } catch (error) {
    printResult('POST /reservations', false, error.message);
    failed++;
  }

  // 5. 予約更新（メニュー変更）
  console.log('\n--- 5. 予約更新（メニュー変更） ---');
  if (createdReservation) {
    try {
      const newMenuName = '虫歯治療';
      const body = {
        date: createdReservation.date,
        time: createdReservation.time,
        customer_phone: TEST_CUSTOMER_PHONE,
        menu_name: newMenuName,
      };
      const res = await request('PUT', '/reservations', body);
      const success = res.status === 200 && res.data.success;
      printResult(
        'PUT /reservations',
        success,
        success
          ? `external_id=${res.data.external_reservation_id}, new_menu=${newMenuName}`
          : `error=${res.data.error}`
      );
      if (res.data.screenshot) {
        saveScreenshot(res.data.screenshot, getTimestampedFilename('05_update'));
      }
      success ? passed++ : failed++;
    } catch (error) {
      printResult('PUT /reservations', false, error.message);
      failed++;
    }
  } else {
    console.log('   ⚠️ 予約が作成されていないためスキップ');
  }

  // 6. 予約検索
  console.log('\n--- 6. 予約検索 ---');
  try {
    const res = await request(
      'GET',
      `/reservations/search?customer_phone=${TEST_CUSTOMER_PHONE}&date_from=${TEST_DATE}&date_to=${TEST_DATE}`
    );
    const success = res.status === 200 && res.data.success;
    printResult(
      'GET /reservations/search',
      success,
      `count=${res.data.count}, timing=${res.data.timing?.total_ms}ms`
    );
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('06_search'));
    }
    if (success && res.data.reservations?.length > 0) {
      console.log('   Found reservations:');
      res.data.reservations.forEach((r, i) => {
        console.log(`     [${i + 1}] ${r.date} ${r.time} - ${r.customerName} (${r.appointId})`);
      });
    }
    success ? passed++ : failed++;
  } catch (error) {
    printResult('GET /reservations/search', false, error.message);
    failed++;
  }

  // 7. 予約キャンセル（作成した予約をキャンセル）
  console.log('\n--- 7. 予約キャンセル ---');
  if (createdReservation) {
    try {
      // キャンセル前のスクリーンショットを取得（/slotsで現在の画面を取得）
      const beforeRes = await request('GET', `/slots?date_from=${TEST_DATE}&date_to=${TEST_DATE}`);
      if (beforeRes.data.screenshot) {
        saveScreenshot(beforeRes.data.screenshot, getTimestampedFilename('07_cancel_before'));
      }

      const body = {
        date: createdReservation.date,
        time: createdReservation.time,
        customer_phone: TEST_CUSTOMER_PHONE,
      };
      const res = await request('DELETE', '/reservations', body);
      const success = res.status === 200 && res.data.success;
      printResult(
        'DELETE /reservations',
        success,
        success
          ? `reservation_id=${res.data.reservation_id}`
          : `error=${res.data.error}`
      );
      // キャンセル後のスクリーンショット
      if (res.data.screenshot) {
        saveScreenshot(res.data.screenshot, getTimestampedFilename('07_cancel_after'));
      }
      success ? passed++ : failed++;
    } catch (error) {
      printResult('DELETE /reservations', false, error.message);
      failed++;
    }
  } else {
    console.log('   ⚠️ 予約が作成されていないためスキップ');
  }

  // 8. セッション再起動
  console.log('\n--- 8. セッション再起動 ---');
  try {
    const res = await request('POST', '/session/restart');
    const success = res.status === 200 && res.data.success;
    printResult('POST /session/restart', success, res.data.message || res.data.error);
    if (res.data.screenshot) {
      saveScreenshot(res.data.screenshot, getTimestampedFilename('08_restart'));
    }
    success ? passed++ : failed++;
  } catch (error) {
    printResult('POST /session/restart', false, error.message);
    failed++;
  }

  // 結果サマリー
  console.log('\n========================================');
  console.log('テスト結果サマリー');
  console.log('========================================');
  console.log(`✅ 成功: ${passed}`);
  console.log(`❌ 失敗: ${failed}`);
  console.log(`合計: ${passed + failed}`);
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

// 実行
runTests().catch((error) => {
  console.error('テスト実行エラー:', error);
  process.exit(1);
});

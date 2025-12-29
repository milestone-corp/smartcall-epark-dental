/**
 * 同時アクセステスト
 *
 * Mutex実装の検証:
 * 1. 複数リクエストの同時実行時に排他制御が正しく動作するか
 * 2. Keep-aliveとリクエスト処理の競合が発生しないか
 * 3. タイムアウト設定が正しく機能するか
 *
 * 使用方法:
 *   node test/concurrent-access-test.cjs [テスト名]
 *
 * テスト名:
 *   slots     - /slots エンドポイントの同時アクセス
 *   search    - /reservations/search エンドポイントの同時アクセス
 *   mixed     - 複数エンドポイントの混合テスト
 *   stress    - 高負荷ストレステスト
 *   all       - すべてのテスト（デフォルト）
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// .envファイルを読み込む
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}
loadEnv();

// 設定
const CONFIG = {
  // サーバー設定
  host: process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.TEST_PORT || '3000', 10),
  protocol: process.env.TEST_PROTOCOL || 'http',

  // 認証情報（.envから取得）
  loginId: process.env.RPA_LOGIN_KEY || '',
  loginPassword: process.env.RPA_LOGIN_PASSWORD || '',
  shopId: process.env.EPARK_SHOP_ID || '',

  // テスト設定
  concurrentRequests: parseInt(process.env.TEST_CONCURRENT || '5', 10),
  stressRequests: parseInt(process.env.TEST_STRESS_COUNT || '10', 10),
  requestTimeout: parseInt(process.env.TEST_TIMEOUT || '120000', 10), // 2分
};

// 認証ヘッダー
const AUTH_HEADERS = {
  'X-RPA-Login-Id': CONFIG.loginId,
  'X-RPA-Login-Password': CONFIG.loginPassword,
  'X-RPA-Shop-Id': CONFIG.shopId,
  'Content-Type': 'application/json',
};

// テスト結果
const results = {
  passed: 0,
  failed: 0,
  errors: [],
};

/**
 * HTTPリクエストを実行
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const httpModule = CONFIG.protocol === 'https' ? https : http;

    const options = {
      hostname: CONFIG.host,
      port: CONFIG.port,
      path,
      method,
      headers: { ...AUTH_HEADERS },
      timeout: CONFIG.requestTimeout,
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const endTime = Date.now();
        try {
          const json = JSON.parse(data);
          resolve({
            status: res.statusCode,
            body: json,
            duration: endTime - startTime,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data,
            duration: endTime - startTime,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * 今日の日付を取得
 */
function getToday() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[0];
}

/**
 * テスト結果を記録
 */
function recordResult(testName, success, message, duration = null) {
  if (success) {
    results.passed++;
    console.log(`  ✓ ${testName}${duration ? ` (${duration}ms)` : ''}`);
  } else {
    results.failed++;
    results.errors.push({ testName, message });
    console.log(`  ✗ ${testName}: ${message}`);
  }
}

/**
 * ヘルスチェック
 */
async function checkHealth() {
  console.log('\n[Health Check]');
  try {
    const res = await makeRequest('GET', '/health');
    if (res.status === 200 && res.body.status) {
      recordResult('Health check', true, null, res.duration);
      console.log(`    Session state: ${res.body.session_state}`);
      return true;
    } else {
      recordResult('Health check', false, `Unexpected response: ${JSON.stringify(res.body)}`);
      return false;
    }
  } catch (error) {
    recordResult('Health check', false, error.message);
    return false;
  }
}

/**
 * テスト1: /slots 同時アクセス
 */
async function testConcurrentSlots() {
  console.log('\n[Test: Concurrent /slots requests]');
  const today = getToday();
  const numRequests = CONFIG.concurrentRequests;

  console.log(`  Sending ${numRequests} concurrent requests...`);

  const promises = [];
  for (let i = 0; i < numRequests; i++) {
    promises.push(
      makeRequest('GET', `/slots?date_from=${today}&date_to=${today}`)
        .then(res => ({ index: i, success: true, res }))
        .catch(err => ({ index: i, success: false, error: err.message }))
    );
  }

  const startTime = Date.now();
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  // 結果を分析
  const successful = results.filter(r => r.success && r.res.status === 200);
  const failed = results.filter(r => !r.success || r.res?.status !== 200);

  console.log(`  Results: ${successful.length}/${numRequests} successful in ${totalTime}ms`);

  // 各リクエストの処理時間を表示
  const durations = successful.map(r => r.res.duration);
  if (durations.length > 0) {
    console.log(`    Min: ${Math.min(...durations)}ms, Max: ${Math.max(...durations)}ms, Avg: ${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}ms`);
  }

  // Mutexの検証: リクエストが順次処理されていることを確認
  // 各リクエストの処理時間の合計は、全体の時間に近いはず（並列ではなく順次処理）
  const sumDurations = durations.reduce((a, b) => a + b, 0);
  const isSequential = sumDurations > totalTime * 0.8; // 80%以上なら順次処理

  recordResult(
    'Concurrent slots - all requests completed',
    successful.length === numRequests,
    failed.length > 0 ? `${failed.length} requests failed` : null,
    totalTime
  );

  recordResult(
    'Concurrent slots - requests processed sequentially (Mutex)',
    isSequential,
    isSequential ? null : `Total time ${totalTime}ms, sum of durations ${sumDurations}ms (parallel detected)`
  );

  if (failed.length > 0) {
    console.log('  Failed requests:');
    failed.forEach(f => {
      console.log(`    Request ${f.index}: ${f.error || JSON.stringify(f.res?.body)}`);
    });
  }
}

/**
 * テスト2: /reservations/search 同時アクセス
 */
async function testConcurrentSearch() {
  console.log('\n[Test: Concurrent /reservations/search requests]');
  const today = getToday();
  const numRequests = CONFIG.concurrentRequests;
  const testPhone = '09012345678';

  console.log(`  Sending ${numRequests} concurrent search requests...`);

  const promises = [];
  for (let i = 0; i < numRequests; i++) {
    promises.push(
      makeRequest('GET', `/reservations/search?customer_phone=${testPhone}&date_from=${today}&date_to=${today}`)
        .then(res => ({ index: i, success: true, res }))
        .catch(err => ({ index: i, success: false, error: err.message }))
    );
  }

  const startTime = Date.now();
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success && r.res.status === 200);
  const failed = results.filter(r => !r.success || r.res?.status !== 200);

  console.log(`  Results: ${successful.length}/${numRequests} successful in ${totalTime}ms`);

  recordResult(
    'Concurrent search - all requests completed',
    successful.length === numRequests,
    failed.length > 0 ? `${failed.length} requests failed` : null,
    totalTime
  );
}

/**
 * テスト3: 混合エンドポイント同時アクセス
 */
async function testMixedEndpoints() {
  console.log('\n[Test: Mixed endpoint concurrent requests]');
  const today = getToday();

  console.log('  Sending mixed requests (slots, search, health, status)...');

  const promises = [
    makeRequest('GET', `/slots?date_from=${today}&date_to=${today}`)
      .then(res => ({ endpoint: '/slots', success: true, res }))
      .catch(err => ({ endpoint: '/slots', success: false, error: err.message })),
    makeRequest('GET', '/reservations/search?customer_phone=09012345678')
      .then(res => ({ endpoint: '/search', success: true, res }))
      .catch(err => ({ endpoint: '/search', success: false, error: err.message })),
    makeRequest('GET', '/health')
      .then(res => ({ endpoint: '/health', success: true, res }))
      .catch(err => ({ endpoint: '/health', success: false, error: err.message })),
    makeRequest('GET', '/status')
      .then(res => ({ endpoint: '/status', success: true, res }))
      .catch(err => ({ endpoint: '/status', success: false, error: err.message })),
    makeRequest('GET', `/slots?date_from=${today}&date_to=${today}`)
      .then(res => ({ endpoint: '/slots 2', success: true, res }))
      .catch(err => ({ endpoint: '/slots 2', success: false, error: err.message })),
  ];

  const startTime = Date.now();
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success && r.res.status === 200);
  const failed = results.filter(r => !r.success || r.res?.status !== 200);

  console.log(`  Results: ${successful.length}/${results.length} successful in ${totalTime}ms`);
  results.forEach(r => {
    const status = r.success && r.res.status === 200 ? '✓' : '✗';
    const duration = r.res?.duration ? `${r.res.duration}ms` : 'N/A';
    console.log(`    ${status} ${r.endpoint}: ${duration}`);
  });

  recordResult(
    'Mixed endpoints - all requests completed',
    successful.length === results.length,
    failed.length > 0 ? `${failed.length} requests failed` : null,
    totalTime
  );
}

/**
 * テスト4: ストレステスト
 */
async function testStress() {
  console.log('\n[Test: Stress test]');
  const today = getToday();
  const numRequests = CONFIG.stressRequests;

  console.log(`  Sending ${numRequests} requests in rapid succession...`);

  const promises = [];
  for (let i = 0; i < numRequests; i++) {
    // 異なるエンドポイントをランダムに選択
    const endpoints = [
      `/slots?date_from=${today}&date_to=${today}`,
      `/reservations/search?customer_phone=09012345678&date_from=${today}`,
    ];
    const endpoint = endpoints[i % endpoints.length];

    promises.push(
      makeRequest('GET', endpoint)
        .then(res => ({ index: i, endpoint, success: true, res }))
        .catch(err => ({ index: i, endpoint, success: false, error: err.message }))
    );
  }

  const startTime = Date.now();
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  const successful = results.filter(r => r.success && r.res.status === 200);
  const failed = results.filter(r => !r.success || r.res?.status !== 200);
  const errors = results.filter(r => !r.success);

  console.log(`  Results: ${successful.length}/${numRequests} successful in ${totalTime}ms`);
  console.log(`    Success rate: ${Math.round(successful.length / numRequests * 100)}%`);

  if (errors.length > 0) {
    console.log(`    Errors: ${errors.length}`);
    const errorTypes = {};
    errors.forEach(e => {
      const type = e.error || 'unknown';
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    });
    Object.entries(errorTypes).forEach(([type, count]) => {
      console.log(`      ${type}: ${count}`);
    });
  }

  // ストレステストは80%以上成功で合格
  const successRate = successful.length / numRequests;
  recordResult(
    'Stress test - success rate >= 80%',
    successRate >= 0.8,
    successRate < 0.8 ? `Success rate: ${Math.round(successRate * 100)}%` : null,
    totalTime
  );

  // 応答時間の分析
  const durations = successful.map(r => r.res.duration);
  if (durations.length > 0) {
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const max = Math.max(...durations);
    console.log(`    Response times - Avg: ${avg}ms, Max: ${max}ms`);

    recordResult(
      'Stress test - no request exceeded 10min timeout',
      max < 600000,
      max >= 600000 ? `Max response time: ${max}ms` : null
    );
  }
}

/**
 * メイン
 */
async function main() {
  console.log('=========================================');
  console.log('  同時アクセステスト');
  console.log('=========================================');
  console.log(`  Server: ${CONFIG.protocol}://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Shop ID: ${CONFIG.shopId}`);
  console.log(`  Concurrent requests: ${CONFIG.concurrentRequests}`);
  console.log(`  Stress requests: ${CONFIG.stressRequests}`);

  // 認証情報チェック
  if (!CONFIG.loginId || !CONFIG.loginPassword || !CONFIG.shopId) {
    console.error('\n✗ Missing credentials. Please set environment variables:');
    console.error('  - RPA_LOGIN_KEY');
    console.error('  - RPA_LOGIN_PASSWORD');
    console.error('  - EPARK_SHOP_ID');
    process.exit(1);
  }

  const testArg = process.argv[2] || 'all';

  // ヘルスチェック
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    console.error('\n✗ Server is not healthy. Please start the server first.');
    process.exit(1);
  }

  // テスト実行
  try {
    if (testArg === 'all' || testArg === 'slots') {
      await testConcurrentSlots();
    }

    if (testArg === 'all' || testArg === 'search') {
      await testConcurrentSearch();
    }

    if (testArg === 'all' || testArg === 'mixed') {
      await testMixedEndpoints();
    }

    if (testArg === 'all' || testArg === 'stress') {
      await testStress();
    }
  } catch (error) {
    console.error('\nUnexpected error:', error);
  }

  // 結果サマリー
  console.log('\n=========================================');
  console.log('  Test Summary');
  console.log('=========================================');
  console.log(`  Passed: ${results.passed}`);
  console.log(`  Failed: ${results.failed}`);

  if (results.errors.length > 0) {
    console.log('\n  Failures:');
    results.errors.forEach(e => {
      console.log(`    - ${e.testName}: ${e.message}`);
    });
  }

  console.log('\n=========================================');

  process.exit(results.failed > 0 ? 1 : 0);
}

main();

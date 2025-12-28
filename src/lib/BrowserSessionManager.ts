/**
 * ブラウザセッション管理
 *
 * ログイン済みブラウザを常駐させ、セッションを維持する
 */

import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { LoginPage } from '../pages/LoginPage.js';

/** 認証情報型 */
export interface Credentials {
  loginKey: string;
  loginPassword: string;
}

export interface SessionConfig {
  /** ログイン認証情報 */
  credentials: Credentials;
  /** ベースURL */
  baseUrl: string;
  /** ヘッドレスモード */
  headless?: boolean;
  /** ビューポートサイズ */
  viewport?: { width: number; height: number };
  /** セッション維持間隔（ms、デフォルト: 5分） */
  keepAliveIntervalMs?: number;
  /** セッション確認時のリロード先パス */
  keepAlivePath?: string;
}

export type SessionState =
  | 'uninitialized' // 未初期化
  | 'starting' // 起動中
  | 'logging_in' // ログイン中
  | 'ready' // 処理可能
  | 'busy' // 処理中
  | 'recovering' // リカバリー中
  | 'error' // エラー状態
  | 'closed'; // 終了済み

export class BrowserSessionManager extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private state: SessionState = 'uninitialized';
  private config: Required<SessionConfig>;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime: Date = new Date();

  constructor(config: SessionConfig) {
    super();
    this.config = {
      headless: true,
      viewport: { width: 1485, height: 1440 },
      keepAliveIntervalMs: 5 * 60 * 1000, // デフォルト5分
      keepAlivePath: '/timeAppoint4M/appointmanager/',
      ...config,
    };
  }

  /**
   * セッションを開始（ブラウザ起動 + ログイン）
   */
  async start(): Promise<void> {
    if (
      this.state !== 'uninitialized' &&
      this.state !== 'closed' &&
      this.state !== 'error'
    ) {
      throw new Error(`Cannot start session in state: ${this.state}`);
    }

    try {
      this.setState('starting');

      // ブラウザ起動
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
      });

      this.page = await this.context.newPage();

      // ログイン
      this.setState('logging_in');
      await this.performLogin();

      // セッション維持タイマー開始
      this.startKeepAlive();

      this.setState('ready');
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /**
   * ログイン処理を実行
   */
  private async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No browser page');

    const { credentials, baseUrl } = this.config;

    await this.page.goto(`${baseUrl}/`);
    const loginPage = new LoginPage(this.page);
    await loginPage.login(credentials.loginKey, credentials.loginPassword);
  }

  /**
   * セッション維持（定期リロード）を開始
   */
  private startKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }

    this.keepAliveTimer = setInterval(async () => {
      await this.refreshSession();
    }, this.config.keepAliveIntervalMs);
  }

  /**
   * セッションをリフレッシュ（ページリロード）
   */
  private async refreshSession(): Promise<void> {
    if (this.state !== 'ready' || !this.page) return;

    try {
      const { baseUrl, keepAlivePath } = this.config;

      console.log('[BrowserSessionManager] Keep-alive: refreshing session...');

      // ページをリロードしてセッション維持
      await this.page.goto(`${baseUrl}${keepAlivePath}`, { waitUntil: 'networkidle' });

      // ログイン状態を確認
      const loginPage = new LoginPage(this.page);
      const isLoggedIn = await loginPage.isLoggedIn();

      if (!isLoggedIn) {
        console.warn('[BrowserSessionManager] Session expired, recovering...');
        this.emit('sessionExpired');
        await this.recover();
      } else {
        console.log('[BrowserSessionManager] Keep-alive: session is valid');
      }

      this.lastActivityTime = new Date();
    } catch (error) {
      console.error('[BrowserSessionManager] Keep-alive failed:', error);
      await this.recover();
    }
  }

  /**
   * セッションをリカバリー（再ログイン）
   */
  async recover(): Promise<void> {
    if (this.state === 'recovering') return;

    this.setState('recovering');

    try {
      // ブラウザを閉じる
      await this.closeBrowser();

      // 再起動
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
      });

      this.page = await this.context.newPage();

      // 再ログイン
      await this.performLogin();

      this.emit('recovered');
      this.setState('ready');
    } catch (error) {
      this.setState('error');
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * ブラウザを閉じる（内部用）
   */
  private async closeBrowser(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.page = null;
    } catch {
      // エラーを無視
    }
  }

  /**
   * ページを取得（処理用）
   *
   * busyステートに移行し、処理完了後にreleasePageを呼び出す必要がある
   */
  async acquirePage(): Promise<Page> {
    if (this.state !== 'ready') {
      throw new Error(`Cannot acquire page in state: ${this.state}`);
    }

    if (!this.page) {
      throw new Error('No browser page available');
    }

    this.setState('busy');
    return this.page;
  }

  /**
   * ページを解放（処理完了後）
   */
  releasePage(): void {
    if (this.state === 'busy') {
      this.lastActivityTime = new Date();
      this.setState('ready');
    }
  }

  /**
   * 現在の状態を取得
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * 最終アクティビティ時刻を取得
   */
  getLastActivityTime(): Date {
    return this.lastActivityTime;
  }

  /**
   * セッションを終了
   */
  async close(): Promise<void> {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    await this.closeBrowser();
    this.setState('closed');
  }

  /**
   * 状態を更新
   */
  private setState(newState: SessionState): void {
    const previousState = this.state;
    this.state = newState;
    this.emit('stateChange', newState, previousState);
  }
}

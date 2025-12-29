/**
 * ブラウザセッション管理
 *
 * SDKのBaseBrowserSessionManagerを継承し、EPARK固有のログイン処理を実装
 */

import { BaseBrowserSessionManager, type BaseSessionConfig } from '@smartcall/rpa-sdk';
import type { Page } from 'playwright';
import { LoginPage } from '../pages/LoginPage.js';

/** 認証情報型 */
export interface Credentials {
  loginKey: string;
  loginPassword: string;
}

/** EPARK固有のセッション設定 */
export interface EparkSessionConfig extends BaseSessionConfig {
  /** ログイン認証情報 */
  credentials: Credentials;
  /** ベースURL */
  baseUrl: string;
  /** セッション確認時のリロード先パス */
  keepAlivePath?: string;
}

// SessionState型をSDKから再エクスポート
export type { SessionState } from '@smartcall/rpa-sdk';

/**
 * EPARK歯科用ブラウザセッションマネージャー
 *
 * SDKのBaseBrowserSessionManagerを継承し、EPARK固有の処理を実装
 */
export class BrowserSessionManager extends BaseBrowserSessionManager {
  private eparkConfig: Required<EparkSessionConfig>;

  constructor(config: EparkSessionConfig) {
    // SDKの基底クラスに渡す設定
    super({
      headless: config.headless ?? true,
      viewport: config.viewport ?? { width: 1485, height: 1440 },
      keepAliveIntervalMs: config.keepAliveIntervalMs ?? 5 * 60 * 1000,
      browserArgs: config.browserArgs,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });

    // EPARK固有の設定を保持
    this.eparkConfig = {
      headless: config.headless ?? true,
      viewport: config.viewport ?? { width: 1485, height: 1440 },
      keepAliveIntervalMs: config.keepAliveIntervalMs ?? 5 * 60 * 1000,
      browserArgs: config.browserArgs ?? ['--no-sandbox', '--disable-setuid-sandbox'],
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      credentials: config.credentials,
      baseUrl: config.baseUrl,
      keepAlivePath: config.keepAlivePath ?? '/timeAppoint4M/appointmanager/',
    };
  }

  /**
   * ログイン処理を実行（SDKの抽象メソッドを実装）
   */
  protected async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No browser page');

    const { credentials, baseUrl } = this.eparkConfig;

    await this.page.goto(`${baseUrl}/`);
    const loginPage = new LoginPage(this.page);
    await loginPage.login(credentials.loginKey, credentials.loginPassword);
  }

  /**
   * ログイン状態を確認（SDKの抽象メソッドを実装）
   */
  protected async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;

    const loginPage = new LoginPage(this.page);
    return loginPage.isLoggedIn();
  }

  /**
   * キープアライブ時のリフレッシュ処理（SDKの抽象メソッドを実装）
   */
  protected async refreshForKeepAlive(): Promise<void> {
    if (!this.page) return;

    const { baseUrl, keepAlivePath } = this.eparkConfig;
    await this.page.goto(`${baseUrl}${keepAlivePath}`, { waitUntil: 'networkidle' });
  }

  /**
   * 現在のページを取得（読み取り専用）
   */
  getPage(): Page | null {
    return this.page;
  }
}

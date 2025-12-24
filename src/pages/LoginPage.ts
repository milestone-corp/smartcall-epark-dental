/**
 * ログインページ Page Object
 *
 * サイト固有のセレクターとログイン処理を実装します。
 */

import { BasePage } from '@smartcall/rpa-sdk';

/**
 * 認証エラー
 */
export class AuthError extends Error {
  readonly code = 'AUTH_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class LoginPage extends BasePage {
  // セレクター定義（対象サイトに合わせて変更してください）
  private readonly loginIdInput = '#loginId';
  private readonly passwordInput = '#pwd';
  private readonly loginButton = '.Bloginbtn';
  private readonly errorList = '#errorList ul li';

  /**
   * ログインを実行
   *
   * @throws {AuthError} 認証エラーの場合
   */
  async login(loginId: string, password: string): Promise<void> {
    // 認証情報が未入力の場合はエラー
    if (!loginId || !password) {
      throw new AuthError('認証情報が設定されていません');
    }

    await this.fill(this.loginIdInput, loginId);
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);

    // ログインボタンが消えるか、エラーが表示されるまで待機
    await Promise.race([
      this.page.locator(this.loginButton).waitFor({ state: 'detached' }),
      this.page.locator(this.errorList).waitFor({ state: 'visible' }),
    ]);

    // 認証エラーをチェック
    await this.checkAuthError();
  }

  /**
   * 認証エラーをチェック
   *
   * @throws {AuthError} 認証エラーの場合
   */
  private async checkAuthError(): Promise<void> {
    const errorItems = await this.page.$$(this.errorList);

    for (const item of errorItems) {
      const text = await item.textContent();
      if (text?.includes('入力された情報に誤り')) {
        throw new AuthError('認証情報が正しくありません');
      }
    }
  }

  /**
   * ログイン成功を確認
   */
  async isLoggedIn(): Promise<boolean> {
    const logoutButton = await this.page.$('.BTopOperatorLogout')
    return logoutButton !== null
  }
}

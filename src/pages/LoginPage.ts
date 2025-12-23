/**
 * ログインページ Page Object
 *
 * サイト固有のセレクターとログイン処理を実装します。
 */

import { BasePage } from '@smartcall/rpa-sdk';

export class LoginPage extends BasePage {
  // セレクター定義（対象サイトに合わせて変更してください）
  private readonly loginIdInput = '#loginId';
  private readonly passwordInput = '#pwd';
  private readonly loginButton = '.Bloginbtn';

  /**
   * ログインを実行
   */
  async login(loginId: string, password: string): Promise<void> {
    await this.fill(this.loginIdInput, loginId);
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);

    await this.page.locator(this.loginButton).waitFor({ state: 'detached' })
  }

  /**
   * ログイン成功を確認
   */
  async isLoggedIn(): Promise<boolean> {
    const logoutButton = await this.page.$('.BTopOperatorLogout')
    return logoutButton !== null
  }
}

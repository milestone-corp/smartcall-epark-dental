/**
 * アポイント管理台帳ページ Page Object
 *
 * 空き枠の取得、予約の作成・キャンセルを行う
 */

import { BasePage } from '@smartcall/rpa-sdk';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/**
 * 空き枠情報
 */
export interface SlotInfo {
  /** 日付（YYYY-MM-DD形式） */
  date: string;
  /** 時刻（HH:MM形式） */
  time: string;
  /** 所要時間（分） */
  duration_min: number;
  /** 空き枠数 */
  stock: number;
  /** リソース名（担当者名など） */
  resource_name?: string;
}

/** 取得日数の選択肢 */
type FetchDays = 1 | 3 | 8;

export class AppointPage extends BasePage {
  private baseUrl: string = '';

  // セレクター定義
  private readonly selectors = {
    /** 取得日数選択メニュー */
    daysSelectMenu: '.parts_menu_select',
    /** 日付ヘッダー */
    dateHeader: '.parts_schedule_head_date_day',
    /** スタッフ一覧（hidden input） */
    staffList: '.all_staff_list',
    /** 時間枠セル（各時間枠のカラム） */
    timeColumn: '.parts_schedule_body_column',
  };

  /**
   * アポイント管理台帳ページに遷移
   */
  async navigate(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl;
    await this.page.goto(`${baseUrl}/timeAppoint4M/appointmanager/`);
    // スケジュール表示領域が読み込まれるまで待機
    await this.page.waitForSelector(this.selectors.dateHeader);
  }

  /**
   * スケジュールを描画（Schedule.draw相当）
   * @param date 開始日（YYYYMMDD形式）
   */
  async drawSchedule(date: string): Promise<void> {
    // APIレスポンスを待機しながらSchedule.drawを実行
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/timeAppoint4M/appointmanager/drawschedule') &&
        response.request().method() === 'POST'
    );

    await this.page.evaluate((d) => {
      // グローバル関数 Schedule.draw を呼び出し
      (window as unknown as { Schedule: { draw: (date: string) => void } }).Schedule.draw(d);
    }, date);

    // drawschedule APIのレスポンスを待機
    await responsePromise;

    // #targetDateの値が指定した日付になるまで待機
    await this.page.waitForFunction(
      (expectedDate) => {
        const targetDateInput = document.querySelector('#targetDate') as HTMLInputElement | null;
        return targetDateInput?.value === expectedDate;
      },
      date,
      { timeout: 10000 }
    );
  }

  /**
   * 取得日数を設定
   * @param days 取得日数
   */
  async setFetchDays(days: FetchDays): Promise<void> {
    await this.page.evaluate((d) => {
      document.querySelector('.parts_menu_select')?.setAttribute('data-select', String(d));
    }, days);
  }

  /**
   * 現在の取得日数を取得
   */
  async getFetchDays(): Promise<number> {
    const days = await this.page.$eval(
      this.selectors.daysSelectMenu,
      (el) => el.getAttribute('data-select')
    );
    return parseInt(days || '1', 10);
  }

  /**
   * YYYY-MM-DD形式をYYYYMMDD形式に変換
   */
  private toYyyymmdd(date: string): string {
    return dayjs(date).format('YYYYMMDD');
  }

  /**
   * YYYYMMDD形式をYYYY-MM-DD形式に変換
   */
  private toIsoDate(yyyymmdd: string): string {
    return dayjs(yyyymmdd, 'YYYYMMDD').format('YYYY-MM-DD');
  }

  /**
   * HHMM形式をHH:MM形式に変換
   */
  private toTimeFormat(hhmm: string): string {
    return dayjs(hhmm, 'HHmm').format('HH:mm');
  }

  /**
   * 指定日付の空き枠を取得
   * @param dateFrom 開始日 (YYYY-MM-DD)
   * @param dateTo 終了日 (YYYY-MM-DD)
   */
  async getAvailableSlots(dateFrom: string, dateTo: string): Promise<SlotInfo[]> {
    const slots: SlotInfo[] = [];

    // 8日分ずつ取得する設定に変更
    await this.setFetchDays(8);

    // 開始日からスケジュールを描画
    await this.drawSchedule(this.toYyyymmdd(dateFrom));

    // スタッフ情報を取得
    const staffMap = await this.page.$$eval(
      this.selectors.staffList,
      (elements) => elements.map((el) => ({
        id: el.getAttribute('data-staffid') || '',
        name: el.getAttribute('data-staffname') || '',
      }))
    );

    // 既存の予約情報を取得（予約済み枠を除外するため）
    const reservations = await this.page.$$eval(
      '.parts_schedule_body_reserve',
      (elements) => elements.map((el) => ({
        date: el.getAttribute('data-date') || '',
        start: el.getAttribute('data-start') || '',
        end: el.getAttribute('data-end') || '',
        staff: el.getAttribute('data-staff') || '',
      }))
    );

    /**
     * 指定された時間枠が予約と重複しているかチェック
     * @param date 日付（YYYYMMDD）
     * @param slotStart 枠の開始時刻（HHMM）
     * @param slotEnd 枠の終了時刻（HHMM）
     * @param staffId スタッフID
     */
    const isSlotReserved = (date: string, slotStart: string, slotEnd: string, staffId: string): boolean => {
      return reservations.some((r) => {
        if (r.date !== date || r.staff !== staffId) return false;
        // 枠の時間帯が予約の時間帯と重複するかチェック
        // 重複条件: 枠の開始 < 予約の終了 AND 枠の終了 > 予約の開始
        const slotStartNum = parseInt(slotStart, 10);
        const slotEndNum = parseInt(slotEnd, 10);
        const reserveStartNum = parseInt(r.start, 10);
        const reserveEndNum = parseInt(r.end, 10);
        return slotStartNum < reserveEndNum && slotEndNum > reserveStartNum;
      });
    };

    // 空き枠（activeクラスを持つカラム）を取得
    const activeColumns = await this.page.$$(`${this.selectors.timeColumn}.active`);

    for (const column of activeColumns) {
      const dateAttr = await column.getAttribute('data-date');
      const startAttr = await column.getAttribute('data-start');
      const endAttr = await column.getAttribute('data-end');
      const staffId = await column.getAttribute('data-staff');

      if (!dateAttr || !startAttr || !endAttr || !staffId) continue;

      // 予約済みの枠はスキップ
      if (isSlotReserved(dateAttr, startAttr, endAttr, staffId)) continue;

      const isoDate = this.toIsoDate(dateAttr);

      // 終了日を超えたらスキップ
      if (isoDate > dateTo) continue;
      // 開始日より前ならスキップ
      if (isoDate < dateFrom) continue;

      // スタッフ名を取得
      const staff = staffMap.find((s) => s.id === staffId);
      const resourceName = staff?.name || `スタッフ${staffId}`;

      // 時刻を変換（HHMM → HH:MM）
      const startTime = this.toTimeFormat(startAttr);
      const endTime = this.toTimeFormat(endAttr);

      // 所要時間を計算（分）
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const durationMin = (endH * 60 + endM) - (startH * 60 + startM);

      slots.push({
        date: isoDate,
        time: startTime,
        duration_min: durationMin,
        stock: 1,
        resource_name: resourceName,
      });
    }

    return slots;
  }
}

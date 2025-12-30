/**
 * アポイント管理台帳ページ Page Object
 *
 * 空き枠の取得、予約の作成・キャンセルを行う
 */

import {
  BasePage,
  type ReservationRequest as ReservationRequestBase,
  type ScreenshotManager,
} from '@smartcall/rpa-sdk';
import type { Page } from 'playwright';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/**
 * 予約リクエスト（SDKの型を拡張してdeleteオペレーションを追加）
 */
export type ReservationRequest = Omit<ReservationRequestBase, 'operation'> & {
  operation: ReservationRequestBase['operation'] | 'delete' | 'update';
};

/**
 * 予約結果詳細
 */
export interface ReservationResultDetail {
  status: 'success' | 'failed' | 'conflict';
  external_reservation_id?: string;
  error_code?: string;
  error_message?: string;
}

/**
 * 予約結果（API仕様準拠 - resultオブジェクト形式）
 */
export interface ReservationResult {
  reservation_id: string;
  operation: 'create' | 'update' | 'cancel' | 'delete';
  result: ReservationResultDetail;
}

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

/**
 * 予約検索結果
 */
export interface ReservationSearchResult {
  /** 予約ID */
  appointId: string;
  /** 日付（YYYY-MM-DD形式） */
  date: string;
  /** 時刻（HH:MM形式） */
  time: string;
  /** 顧客名 */
  customerName: string;
  /** 電話番号 */
  customerPhone: string;
  /** スタッフID */
  staffId: string;
}

export class AppointPage extends BasePage {
  /** 1回のスケジュール描画で取得できる日数 */
  private readonly FETCH_DAYS: FetchDays = 8;
  private readonly screenshot: ScreenshotManager;

  /**
   * アポイント管理台帳ページ
   * 
   * 空き枠の取得、予約の作成・キャンセルを行う
   *
   * @param page Playwrightのページオブジェクト
   * @param screenshot スクリーンショットマネージャー
   */
  constructor(page: Page, screenshot: ScreenshotManager) {
    super(page);
    this.screenshot = screenshot;
  }

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
    /** WEBメニュー選択 */
    menuSelect: '#selAppointMenu',
  };

  /**
   * アポイント管理台帳ページに遷移
   */
  async navigate(baseUrl: string): Promise<void> {
    await this.goto(`${baseUrl}/timeAppoint4M/appointmanager/`);
    // スケジュール表示領域が読み込まれるまで待機
    await this.waitForSelector(this.selectors.dateHeader);
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
   *
   * １回の取得可能日数以上の期間を指定した場合は、分割して逐次取得します。
   *
   * @param dateFrom 開始日 (YYYY-MM-DD)
   * @param dateTo 終了日 (YYYY-MM-DD)
   */
  async getAvailableSlots(dateFrom: string, dateTo: string): Promise<SlotInfo[]> {
    const slots: SlotInfo[] = [];

    // １回に取得する日数を設定
    await this.setFetchDays(this.FETCH_DAYS);

    // 開始日と終了日をdayjsオブジェクトに変換
    let currentDate = dayjs(dateFrom);
    const endDate = dayjs(dateTo);

    // 逐次取得
    let chunkIndex = 0;
    while (this.FETCH_DAYS && (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day'))) {
      // 現在の開始日からスケジュールを描画
      await this.drawSchedule(currentDate.format('YYYYMMDD'));

      // 今回の取得範囲の終了日を計算（１回の取得日数上限後または全体の終了日のいずれか早い方）
      const chunkEndDate = currentDate.add(this.FETCH_DAYS - 1, 'day');
      const effectiveEndDate = chunkEndDate.isAfter(endDate) ? endDate : chunkEndDate;

      // 現在のスケジュール表示から空き枠を抽出
      const chunkSlots = await this.extractSlotsFromCurrentView(
        currentDate.format('YYYY-MM-DD'),
        effectiveEndDate.format('YYYY-MM-DD')
      );

      slots.push(...chunkSlots);

      // スクリーンショットを撮影
      await this.screenshot.captureStep(this.page, `04-fetch-slots-${++chunkIndex}`);

      // 次の取得開始日に移動
      currentDate = currentDate.add(this.FETCH_DAYS, 'day');
    }

    return slots;
  }

  /**
   * 現在表示中のスケジュールから空き枠を抽出
   *
   * @param dateFrom 取得開始日 (YYYY-MM-DD)
   * @param dateTo 取得終了日 (YYYY-MM-DD)
   */
  private async extractSlotsFromCurrentView(dateFrom: string, dateTo: string): Promise<SlotInfo[]> {
    const slots: SlotInfo[] = [];

    // スタッフ情報を取得
    const staffMap = await this.page.$$eval(
      this.selectors.staffList,
      (elements) => elements.map((el) => ({
        id: el.getAttribute('data-staffid') || '',
        name: el.getAttribute('data-staffname') || '',
      }))
    );

    // シフト情報を取得
    const shiftRanges = await this.getShiftRanges();

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

    /**
     * 指定された時間枠をシフト時間で調整する
     * @param slotStart 枠の開始時刻（HHMM）
     * @param slotEnd 枠の終了時刻（HHMM）
     * @returns 調整後の時間枠（シフト外の場合はnull）
     */
    const adjustToShift = (slotStart: string, slotEnd: string): { start: number; end: number } | null => {
      if (shiftRanges.length === 0) {
        // シフト情報がない場合は制限なし
        return { start: parseInt(slotStart, 10), end: parseInt(slotEnd, 10) };
      }

      const slotStartNum = parseInt(slotStart, 10);
      const slotEndNum = parseInt(slotEnd, 10);

      // 枠とシフトが重なる時間帯を探す
      for (const shift of shiftRanges) {
        // 枠とシフトが重なっているかチェック
        // 重なり条件: 枠の開始 < シフトの終了 AND 枠の終了 > シフトの開始
        if (slotStartNum < shift.end && slotEndNum > shift.start) {
          // 開始時刻をシフト開始時刻で調整（枠がシフト前から始まる場合）
          const adjustedStart = Math.max(slotStartNum, shift.start);
          // 終了時刻をシフト終了時刻で調整（枠がシフト後まで続く場合）
          const adjustedEnd = Math.min(slotEndNum, shift.end);
          return { start: adjustedStart, end: adjustedEnd };
        }
      }

      // どのシフトとも重ならない場合はスキップ
      return null;
    };

    // 空き枠（activeクラスを持つカラム）を取得
    const activeColumns = await this.page.$$(`${this.selectors.timeColumn}.active`);

    for (const column of activeColumns) {
      const dateAttr = await column.getAttribute('data-date');
      const startAttr = await column.getAttribute('data-start');
      const endAttr = await column.getAttribute('data-end');
      const staffId = await column.getAttribute('data-staff');

      if (!dateAttr || !startAttr || !endAttr || !staffId) continue;

      // グレーアウトされたセル（シフト外）をスキップ
      // EPARK Dentalでは、グレーセルはbackground-colorがグレー系の色になっている
      // または 'disable' / 'disabled' / 'inactive' などのクラスを持つ
      const classList = await column.getAttribute('class') || '';
      const isDisabledByClass = classList.includes('disable') ||
                                 classList.includes('inactive') ||
                                 classList.includes('closed') ||
                                 classList.includes('off');
      if (isDisabledByClass) continue;

      // 背景色でグレーアウト判定（rgbのグレー系の色をチェック）
      const bgColor = await column.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.backgroundColor;
      });
      // グレー系の色（rgb値がすべて近い値で、明るすぎない色）
      // 例: rgb(200, 200, 200), rgb(220, 220, 220), rgb(128, 128, 128) など
      const grayMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (grayMatch) {
        const [, r, g, b] = grayMatch.map(Number);
        // R, G, Bの値がほぼ同じ（±10）で、128〜230の範囲内ならグレーと判定
        const isGray = Math.abs(r - g) <= 10 && Math.abs(g - b) <= 10 && Math.abs(r - b) <= 10;
        const isGrayRange = r >= 128 && r <= 230 && g >= 128 && g <= 230 && b >= 128 && b <= 230;
        if (isGray && isGrayRange) continue;
      }

      // 予約済みの枠はスキップ
      if (isSlotReserved(dateAttr, startAttr, endAttr, staffId)) continue;

      // シフト時間で調整
      const adjustedSlot = adjustToShift(startAttr, endAttr);
      if (!adjustedSlot) continue;

      const isoDate = this.toIsoDate(dateAttr);

      // 終了日を超えたらスキップ
      if (isoDate > dateTo) continue;
      // 開始日より前ならスキップ
      if (isoDate < dateFrom) continue;

      // スタッフ名を取得
      const staff = staffMap.find((s) => s.id === staffId);
      const resourceName = staff?.name || `スタッフ${staffId}`;

      // 調整後の時刻を変換（数値 → HH:MM）
      const startTime = this.toTimeFormat(String(adjustedSlot.start).padStart(4, '0'));
      const endTime = this.toTimeFormat(String(adjustedSlot.end).padStart(4, '0'));

      // 所要時間を計算（分）
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const durationMin = (endH * 60 + endM) - (startH * 60 + startM);

      // 所要時間が0以下の場合はスキップ
      if (durationMin <= 0) continue;

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

  /**
   * シフト情報をDOMから取得
   *
   * @returns シフト時間帯の配列（HHmm形式の数値）
   */
  private async getShiftRanges(): Promise<{ start: number; end: number }[]> {
    const shiftTexts = await this.page.$$eval(
      '.parts_shift_body .parts_shift_date p',
      (elements) => elements.map((el) => el.textContent?.trim() || '')
    );

    const ranges: { start: number; end: number }[] = [];

    for (const text of shiftTexts) {
      // "09:00～12:20" のような形式をパース
      const match = text.match(/(\d{2}):(\d{2})～(\d{2}):(\d{2})/);
      if (match) {
        const [, startHour, startMin, endHour, endMin] = match;

        ranges.push({
          start: parseInt(`${startHour}${startMin}`, 10),
          end: parseInt(`${endHour}${endMin}`, 10),
        });
      }
    }

    return ranges;
  }

  /**
   * 予約登録フォームを呼び出す
   *
   * popup_registFromTable3UI関数を呼び出し、新規アポイント登録ダイアログを表示する
   *
   * @param reservation 予約リクエスト
   * @param staffId スタッフID（デフォルト: '1'）
   * @param lineNo ライン番号（デフォルト: '1'）
   * @param lineType ライン種別（デフォルト: '1'）
   */
  async openReservationForm(
    reservation: ReservationRequest,
    staffId: string = '1',
    lineNo: string = '1',
    lineType: string = '1'
  ): Promise<void> {
    // 予約枠情報から日付・時刻を取得
    const slotDate = reservation.slot?.date || '';
    const slotStartAt = reservation.slot?.start_at || '';
    const durationMin = reservation.slot?.duration_min || 30;

    // 予約日のスケジュールを表示
    await this.drawSchedule(this.toYyyymmdd(slotDate));

    // 時刻をパース（HH:MM形式）
    const [hourFrom, minuteFrom] = slotStartAt.split(':');

    // 所要時間から終了時刻を計算
    const startTime = dayjs(`${slotDate} ${slotStartAt}`, 'YYYY-MM-DD HH:mm');
    const endTime = startTime.add(durationMin, 'minute');
    const hourTo = endTime.format('HH');
    const minuteTo = endTime.format('mm');

    // dateTime形式: YYYYMMDDHHMM
    const dateTime = `${this.toYyyymmdd(slotDate)}${hourFrom}${minuteFrom}`;

    // popup_registFromTable3UI を呼び出し
    await this.page.evaluate(
      ({ dateTime, staffId, lineNo, lineType, hourFrom, minuteFrom, hourTo, minuteTo }) => {
        const win = window as unknown as {
          /** スケジュール表から新規予約登録ポップアップを表示する */
          popup_registFromTable3UI: (
            /** 予約日時（YYYYMMDDHHMM形式） */
            dateTime: string,
            /** スタッフID（チェアID） */
            staffId: string,
            /** ライン番号 */
            lineNo: string,
            /** ライン種別 */
            lineType: string,
            /** メニューID（null の場合はメニュー未指定） */
            menuId: null,
            /** 開始時刻の時（HH形式） */
            hourFrom: string,
            /** 開始時刻の分（mm形式） */
            minuteFrom: string,
            /** 終了時刻の時（HH形式） */
            hourTo: string,
            /** 終了時刻の分（mm形式） */
            minuteTo: string
          ) => void;
        };
        win.popup_registFromTable3UI(
          dateTime,
          staffId,
          lineNo,
          lineType,
          null, // menuId
          hourFrom,
          minuteFrom,
          hourTo,
          minuteTo
        );
      },
      { dateTime, staffId, lineNo, lineType, hourFrom, minuteFrom, hourTo, minuteTo }
    );

    // ポップアップが表示されるまで待機
    await this.waitForSelector('.register_appointment_simple_view');
  }

  /**
   * 予約操作を一括処理する
   *
   * @param reservations 予約リクエストの配列
   * @param staffId スタッフID
   * @returns 予約操作結果の配列
   */
  async processReservations(
    reservations: ReservationRequest[],
    staffId?: string,
  ): Promise<ReservationResult[]> {
    const results: ReservationResult[] = [];

    for (let i = 0; i < reservations.length; i++) {
      const reservation = reservations[i];

      if (reservation.operation === 'create') {
        const result = await this.createReservation(reservation, i + 1, staffId);
        results.push(result);
      } else if (reservation.operation === 'cancel') {
        const result = await this.cancelReservation(reservation, i + 1);
        results.push(result);
      } else if (reservation.operation === 'delete') {
        const result = await this.deleteReservation(reservation, i + 1);
        results.push(result);
      } else if (reservation.operation === 'update') {
        const result = await this.updateReservation(reservation, i + 1);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 予約を作成する
   *
   * @param reservation 予約リクエスト
   * @param index 予約のインデックス（スクリーンショット用）
   * @param staffId スタッフID
   * @returns 予約操作結果
   */
  private async createReservation(
    reservation: ReservationRequest,
    index: number,
    staffId?: string
  ): Promise<ReservationResult> {
    const idx = String(index).padStart(2, '0');

    try {
      // 予約登録フォームを開く
      await this.openReservationForm(reservation, staffId);
      await this.screenshot.captureStep(this.page, `05-${idx}-reservation-form`);

      // フォームに入力
      await this.fillReservationForm(reservation);
      await this.screenshot.captureStep(this.page, `06-${idx}-reservation-filled`);

      // 登録ボタンをクリック
      const submitResult = await this.submitReservationForm();
      await this.screenshot.captureStep(this.page, `07-${idx}-reservation-submitted`);

      // API結果を確認
      if (!submitResult.success) {
        await this.screenshot.captureError(this.page, `${idx}-reservation`);

        // 失敗時はブラウザをリロードして状態をリセット
        await this.page.reload();
        await this.waitForSelector(this.selectors.dateHeader);

        // 重複予約の場合は status: 'conflict'
        const status = submitResult.errorCode === 'DUPLICATE_RESERVATION' ? 'conflict' : 'failed';

        return {
          reservation_id: reservation.reservation_id,
          operation: 'create',
          result: {
            status,
            error_code: submitResult.errorCode,
            error_message: submitResult.errorMessage,
          },
        };
      }

      // 予約IDを取得
      const externalReservationId = await this.findReservationId(reservation, staffId);

      return {
        reservation_id: reservation.reservation_id,
        operation: 'create',
        result: {
          status: 'success',
          external_reservation_id: externalReservationId,
        },
      };
    } catch (error) {
      await this.screenshot.captureError(this.page, `${idx}-reservation-error`);

      // 失敗時はブラウザをリロードして状態をリセット
      await this.page.reload();
      await this.waitForSelector(this.selectors.dateHeader);

      return {
        reservation_id: reservation.reservation_id,
        operation: 'create',
        result: {
          status: 'failed',
          error_code: 'SYSTEM_ERROR',
          error_message: error instanceof Error ? error.message : '予約作成に失敗しました',
        },
      };
    }
  }

  /**
   * 詳細情報フォームを開く
   */
  private async openDetailForm(): Promise<void> {
    // 詳細情報ボタンをクリック
    await this.click('#btnOpenAppointHover');

    // 詳細フォームが表示されるまで待機
    await this.waitForSelector('.appointment_detail_info');
  }

  /**
   * 予約登録フォームに入力する
   *
   * @param reservation 予約リクエスト
   */
  private async fillReservationForm(reservation: ReservationRequest): Promise<void> {
    // 詳細情報フォームを開く（備考フィールドがあるため）
    await this.openDetailForm();

    // メニューを選択（menu.menu_nameが指定されている場合）
    const menuName = reservation.menu?.menu_name;
    if (menuName) {
      await this.selectMenu(menuName);
    }

    // 顧客名を姓と名に分割（スペースで分割、なければ全て姓として扱う）
    const customerName = reservation.customer?.name;
    if (customerName) {
      const nameParts = customerName.split(/\s+/);
      const lastName = nameParts[0] || '';
      const firstName = nameParts.slice(1).join(' ') || '';

      // 姓を入力
      if (lastName) {
        await this.fill('#txtAppointLastName', lastName);
      }

      // 名を入力
      if (firstName) {
        await this.fill('#txtAppointFirstName', firstName);
      }
    }

    // 電話番号を入力
    const customerPhone = reservation.customer?.phone;
    if (customerPhone) {
      await this.fill('#txtAppointTelNo', customerPhone);
    }

    // 患者メモを入力（詳細フォームにのみ存在）
    // menu_nameとcustomer.notesを組み合わせて入力
    const notes = reservation.customer?.notes;
    const memoLines: string[] = [];
    if (menuName) {
      memoLines.push(menuName);
    }
    if (notes) {
      memoLines.push(notes);
    }
    if (memoLines.length > 0) {
      await this.fill('#txtAppointMemo', memoLines.join('\n'));
    }
  }

  /**
   * メニューを選択する
   *
   * @param menuName メニュー名
   */
  private async selectMenu(menuName: string): Promise<void> {
    // WEBメニューを有効化する
    await this.page.$eval(this.selectors.menuSelect, (el) => {
      el.removeAttribute('disabled');
    });

    // メニュー名またはメニュー番号に一致するオプションを検索して選択
    const optionValue = await this.page.$eval(
      this.selectors.menuSelect,
      (select, name) => {
        const options = Array.from(select.querySelectorAll('option'));
        // メニュー番号（value）で検索
        const byValue = options.find((opt) => opt.value === name);
        if (byValue) return byValue.value;
        // メニュー名（title または textContent）で検索
        const byName = options.find((opt) => opt.title === name || opt.textContent?.trim().startsWith(name));
        return byName?.value || null;
      },
      menuName
    );

    if (optionValue) {
      await this.page.selectOption(this.selectors.menuSelect, optionValue);
    }
  }

  /**
   * 予約登録フォームを送信する
   *
   * @returns 送信結果
   */
  private async submitReservationForm(): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // APIレスポンスを待機しながら登録ボタンをクリック
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/timeAppoint4M/scheduleregister/registappoint') &&
        response.request().method() === 'POST'
    );

    // 登録ボタンをクリック
    await this.click('.guest_foot_entry');

    // APIレスポンスを取得して結果を確認
    const response = await responsePromise;
    const json = await response.json() as {
      result: boolean;
      err_messages?: string[];
      alert_message?: string;
    };

    if (!json.result) {
      let errorMessage = json.err_messages?.join(', ') || json.alert_message || '予約登録に失敗しました';

      // エラーコードを判定
      let errorCode = 'SYSTEM_ERROR';

      if (json.err_messages?.some((msg) => msg.includes('他の予約が存在'))) {
        // 重複予約
        errorCode = 'DUPLICATE_RESERVATION';
      } else if (json.alert_message?.includes('勤務時間外')) {
        // 空き枠なし（勤務時間外）
        errorCode = 'SLOT_NOT_AVAILABLE';
        errorMessage = '指定された時間帯に空きがありません'
      }

      return {
        success: false,
        errorCode,
        errorMessage,
      };
    }

    // 詳細フォームが閉じるまで待機
    await this.waitForSelector('.appointment_detail_info', { state: 'hidden' });

    return { success: true };
  }

  /**
   * 登録した予約のIDをDOMから取得する
   *
   * @param reservation 予約リクエスト
   * @param staffId スタッフID
   * @returns 予約システム側の予約ID
   */
  private async findReservationId(reservation: ReservationRequest, staffId?: string): Promise<string> {
    // 予約枠情報からdata属性の値を計算
    const slotDate = reservation.slot?.date || '';
    const slotStartAt = reservation.slot?.start_at || '';
    const durationMin = reservation.slot?.duration_min ?? 30;

    const date = this.toYyyymmdd(slotDate);
    const start = slotStartAt.replace(':', '');
    const endTime = dayjs(`${slotDate} ${slotStartAt}`, 'YYYY-MM-DD HH:mm')
      .add(durationMin, 'minute');
    const end = endTime.format('HHmm');

    // 属性セレクタで該当する予約要素を検索
    let selector = `.parts_schedule_body_reserve[data-date="${date}"][data-start="${start}"]`;
    if (reservation.slot?.duration_min && !reservation.menu?.menu_name) selector += `[data-end="${end}"]`
    if (staffId) selector += `[data-staff="${staffId}"]`;
    const reservationId = await this.getAttribute(selector, 'data-id');

    return reservationId || '';
  }

  /**
   * 電話番号で予約を検索する（公開メソッド）
   *
   * 指定された日付範囲内で、電話番号に一致する予約を検索する
   *
   * @param dateFrom 開始日 (YYYY-MM-DD)
   * @param dateTo 終了日 (YYYY-MM-DD)
   * @param customerPhone 電話番号
   * @returns 予約リスト
   */
  async searchReservationsByPhone(
    dateFrom: string,
    dateTo: string,
    customerPhone: string
  ): Promise<ReservationSearchResult[]> {
    const results: ReservationSearchResult[] = [];

    // 電話番号からハイフン・スペースを除去して正規化
    const normalizedPhone = customerPhone.replace(/[-\s+]/g, '');

    // 開始日と終了日をdayjsオブジェクトに変換
    let currentDate = dayjs(dateFrom);
    const endDate = dayjs(dateTo);

    // 日付ごとにスケジュールを描画して検索
    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const dateStr = currentDate.format('YYYYMMDD');
      const isoDate = currentDate.format('YYYY-MM-DD');

      // スケジュールを描画
      await this.drawSchedule(dateStr);

      // 全ての予約要素を取得
      const reservations = await this.page.$$(
        `.parts_schedule_body_reserve[data-date="${dateStr}"]`
      );

      for (const element of reservations) {
        // ラベルテキストを取得（例: "院内予約 / テスト太郎 / 09012345678"）
        const labelElement = await element.$('.parts_schedule_body_reserve_label');
        const labelText = await labelElement?.textContent() || '';

        // スペース・スラッシュ・ハイフンを除去して比較用テキストを作成
        const normalizedLabel = labelText.replace(/[\s/\-]/g, '');

        // 電話番号が含まれているか確認
        if (normalizedLabel.includes(normalizedPhone)) {
          // data属性を取得
          const appointId = await element.getAttribute('data-id') || '';
          const staffId = await element.getAttribute('data-staff') || '';
          const start = await element.getAttribute('data-start') || '';

          // 時刻をHH:MM形式に変換
          const time = start.length === 4
            ? `${start.slice(0, 2)}:${start.slice(2, 4)}`
            : start;

          // ラベルから顧客名を抽出（"予約種別 / 顧客名 / 電話番号" の形式を想定）
          const labelParts = labelText.split('/').map(p => p.trim());
          const customerName = labelParts.length >= 2 ? labelParts[1] : '';

          results.push({
            appointId,
            date: isoDate,
            time,
            customerName,
            customerPhone: normalizedPhone,
            staffId,
          });
        }
      }

      // 次の日へ
      currentDate = currentDate.add(1, 'day');
    }

    return results;
  }

  /**
   * 既存の予約を検索する
   *
   * 予約日、予約時刻、顧客名、電話番号をもとにDOM上の予約要素を検索し、
   * appointId, staffId, lineNo, lineType を取得する
   *
   * @param reservation 予約リクエスト
   * @returns 予約情報（見つからない場合はnull）
   */
  private async findExistingReservation(reservation: ReservationRequest): Promise<{
    appointId: string;
    staffId: string;
    lineNo: string;
    lineType: string;
    date: string;
    start: string;
  } | null> {
    // 予約枠情報から日付・時刻を取得
    const slotDate = reservation.slot?.date || '';
    const slotStartAt = reservation.slot?.start_at || '';

    // 予約日のスケジュールを表示
    const date = this.toYyyymmdd(slotDate);
    await this.drawSchedule(date);

    const start = slotStartAt.replace(':', '');

    // 顧客名からラベルに含まれるテキストを作成（姓名の間のスペースを除去して部分一致）
    const customerName = (reservation.customer?.name || '').replace(/\s+/g, '');

    // 電話番号からハイフンを除去（例: 090-1234-5678 → 09012345678）
    const customerPhone = (reservation.customer?.phone || '').replace(/[-\s]/g, '');

    // 該当日時の予約要素を取得
    const reservations = await this.page.$$(
      `.parts_schedule_body_reserve[data-date="${date}"][data-start="${start}"]`
    );

    for (const element of reservations) {
      // ラベルテキストを取得（例: "院内予約 / テスト太郎 / 09012345678"）
      const labelElement = await element.$('.parts_schedule_body_reserve_label');
      const labelText = await labelElement?.textContent() || '';

      // スペースとスラッシュを除去して比較用テキストを作成
      const normalizedLabel = labelText.replace(/[\s/]/g, '');

      // 顧客名と電話番号の両方が含まれているか確認
      const hasCustomerName = normalizedLabel.includes(customerName);
      const hasCustomerPhone = normalizedLabel.includes(customerPhone);

      if (hasCustomerName && hasCustomerPhone) {
        // data属性を取得
        const appointId = await element.getAttribute('data-id') || '';
        const staffId = await element.getAttribute('data-staff') || '';
        const lineNo = await element.getAttribute('data-line') || '';
        const lineType = await element.getAttribute('data-type') || '';

        return { appointId, staffId, lineNo, lineType, date, start };
      }
    }

    return null;
  }

  /**
   * 予約編集フォームを開く
   *
   * @param info 予約情報
   */
  private async openEditForm(info: {
    appointId: string;
    staffId: string;
    lineNo: string;
    lineType: string;
    date: string;
    start: string;
  }): Promise<void> {
    const { appointId, staffId, lineNo, lineType, date, start } = info;

    // dateTime形式: YYYYMMDDHHMM
    const dateTime = `${date}${start}`;

    // popup_editFromTable3UI を呼び出し
    await this.page.evaluate(
      ({ dateTime, staffId, lineNo, lineType, appointId }) => {
        const win = window as unknown as {
          popup_editFromTable3UI: (
            dateTime: number,
            staffId: number,
            lineNo: number,
            lineType: number,
            appointId: string,
            mode: number
          ) => void;
        };
        win.popup_editFromTable3UI(
          Number(dateTime),
          Number(staffId),
          Number(lineNo),
          Number(lineType),
          appointId,
          1 // 編集モード
        );
      },
      { dateTime, staffId, lineNo, lineType, appointId }
    );

    // ポップアップが表示されるまで待機
    await this.waitForSelector('.appointment_detail_info.open');
  }

  /**
   * 予約を更新する
   *
   * 既存の予約を検索し、編集フォームを開いてメモ（メニュー名）を更新する
   *
   * @param reservation 予約リクエスト
   * @param index 予約のインデックス（スクリーンショット用）
   * @returns 予約操作結果
   */
  private async updateReservation(
    reservation: ReservationRequest,
    index: number
  ): Promise<ReservationResult> {
    const idx = String(index).padStart(2, '0');

    try {
      // 既存の予約を検索
      const existingReservation = await this.findExistingReservation(reservation);

      if (!existingReservation) {
        return {
          reservation_id: reservation.reservation_id,
          operation: 'update',
          result: {
            status: 'failed',
            error_code: 'RESERVATION_NOT_FOUND',
            error_message: '指定された予約が見つかりません',
          },
        };
      }

      // 予約編集フォームを開く
      await this.openEditForm(existingReservation);
      await this.screenshot.captureStep(this.page, `05-${idx}-update-form`);

      // フォームに入力（メニュー名をメモに反映）
      await this.fillUpdateForm(reservation);
      await this.screenshot.captureStep(this.page, `06-${idx}-update-filled`);

      // 更新ボタンをクリック
      const submitResult = await this.submitUpdateForm();
      await this.screenshot.captureStep(this.page, `07-${idx}-update-submitted`);

      if (!submitResult.success) {
        await this.screenshot.captureError(this.page, `${idx}-update-result`);

        // 失敗時はブラウザをリロードして状態をリセット
        await this.page.reload();
        await this.waitForSelector(this.selectors.dateHeader);

        return {
          reservation_id: reservation.reservation_id,
          operation: 'update',
          result: {
            status: 'failed',
            error_code: submitResult.errorCode || 'SYSTEM_ERROR',
            error_message: submitResult.errorMessage,
          },
        };
      }

      return {
        reservation_id: reservation.reservation_id,
        operation: 'update',
        result: {
          status: 'success',
          external_reservation_id: existingReservation.appointId,
        },
      };
    } catch (error) {
      await this.screenshot.captureError(this.page, `${idx}-update-error`);

      // 失敗時はブラウザをリロードして状態をリセット
      await this.page.reload();
      await this.waitForSelector(this.selectors.dateHeader);

      return {
        reservation_id: reservation.reservation_id,
        operation: 'update',
        result: {
          status: 'failed',
          error_code: 'SYSTEM_ERROR',
          error_message: error instanceof Error ? error.message : '予約更新に失敗しました',
        },
      };
    }
  }

  /**
   * 予約更新フォームに入力する
   *
   * メニュー名を患者メモに反映する
   *
   * @param reservation 予約リクエスト
   */
  private async fillUpdateForm(reservation: ReservationRequest): Promise<void> {
    // メニュー名を患者メモに入力
    const menuName = reservation.menu?.menu_name;
    const notes = reservation.customer?.notes;

    const memoLines: string[] = [];
    if (menuName) {
      memoLines.push(menuName);
    }
    if (notes) {
      memoLines.push(notes);
    }

    if (memoLines.length > 0) {
      // 既存のメモをクリアして新しい内容を入力
      await this.fill('#txtAppointMemo', memoLines.join('\n'));
    }
  }

  /**
   * 予約更新フォームを送信する
   *
   * @returns 送信結果
   */
  private async submitUpdateForm(): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // APIレスポンスを待機しながら更新ボタンをクリック
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/timeAppoint4M/scheduleregister/editappoint') &&
        response.request().method() === 'POST'
    );

    // 更新ボタンをクリック（詳細フォームの登録ボタン）
    await this.click('.guest_foot_entry');

    // APIレスポンスを取得して結果を確認
    const response = await responsePromise;
    const json = await response.json() as {
      result: boolean;
      err_messages?: string[];
      alert_message?: string;
    };

    if (!json.result) {
      const errorMessage = json.err_messages?.join(', ') || json.alert_message || '予約更新に失敗しました';

      return {
        success: false,
        errorCode: 'SYSTEM_ERROR',
        errorMessage,
      };
    }

    // 詳細フォームが閉じるまで待機
    await this.waitForSelector('.appointment_detail_info.open', { state: 'hidden' });

    return { success: true };
  }

  /**
   * 予約をキャンセルする
   *
   * @param reservation 予約リクエスト
   * @param index 予約のインデックス（スクリーンショット用）
   * @returns 予約操作結果
   */
  private async cancelReservation(
    reservation: ReservationRequest,
    index: number
  ): Promise<ReservationResult> {
    const idx = String(index).padStart(2, '0');

    try {
      // 既存の予約を検索
      const existingReservation = await this.findExistingReservation(reservation);

      if (!existingReservation) {
        return {
          reservation_id: reservation.reservation_id,
          operation: 'cancel',
          result: {
            status: 'failed',
            error_code: 'RESERVATION_NOT_FOUND',
            error_message: '指定された予約が見つかりません',
          },
        };
      }

      // 予約編集フォームを開く
      await this.openEditForm(existingReservation);
      await this.screenshot.captureStep(this.page, `05-${idx}-cancel-form`);

      // キャンセル処理を実行
      const cancelResult = await this.submitCancelForm(existingReservation.date, `06-${idx}`);
      await this.screenshot.captureStep(this.page, `07-${idx}-cancel-submitted`);

      if (!cancelResult.success) {
        await this.screenshot.captureError(this.page, `${idx}-cancel-result`);

        // 失敗時はブラウザをリロードして状態をリセット
        await this.page.reload();
        await this.waitForSelector(this.selectors.dateHeader);

        return {
          reservation_id: reservation.reservation_id,
          operation: 'cancel',
          result: {
            status: 'failed',
            error_code: cancelResult.errorCode || 'SYSTEM_ERROR',
            error_message: cancelResult.errorMessage,
          },
        };
      }

      return {
        reservation_id: reservation.reservation_id,
        operation: 'cancel',
        result: {
          status: 'success',
          external_reservation_id: existingReservation.appointId,
        },
      };
    } catch (error) {
      await this.screenshot.captureError(this.page, `${idx}-cancel`);

      // 失敗時はブラウザをリロードして状態をリセット
      await this.page.reload();
      await this.waitForSelector(this.selectors.dateHeader);

      return {
        reservation_id: reservation.reservation_id,
        operation: 'cancel',
        result: {
          status: 'failed',
          error_code: 'SYSTEM_ERROR',
          error_message: error instanceof Error ? error.message : '予約キャンセルに失敗しました',
        },
      };
    }
  }

  /**
   * キャンセルフォームを送信する
   *
   * @param reservationDate 予約日（YYYYMMDD形式）
   * @param prefix スクリーンショット用prefix
   * @returns 送信結果
   */
  private async submitCancelForm(reservationDate: string, prefix: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // 受付キャンセルボタンをクリック
    await this.click('.guest_foot_cancel');

    // 確認ダイアログが表示されるまで待機
    await this.waitForSelector('.confirm_cancel_appointment.open');

    // 当日かどうかでキャンセル理由を選択
    // ※ ラジオボタンはカスタムスタイルで<span>がオーバーレイされているためforce: trueが必要
    const today = dayjs().tz('Asia/Tokyo').format('YYYYMMDD');
    if (reservationDate === today) {
      // 当日の場合: 「当日、連絡なし」を選択
      await this.click('#rdoReasonNoContact', { force: true });
    } else {
      // 当日以外の場合: 「連絡あり」を選択
      await this.click('#rdoReasonContact', { force: true });
    }

    // キャンセル確認ダイアログのスクリーンショット
    await this.screenshot.captureStep(this.page, `${prefix}-cancel-confirm-dialog`);

    // APIレスポンスを待機しながら決定ボタンをクリック
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/timeAppoint4M/scheduleregister/cancelappoint') &&
        response.request().method() === 'POST'
    );

    await this.click('.guest_foot_confirm_cancel_appointment');

    // APIレスポンスを取得して結果を確認
    const response = await responsePromise;
    const json = await response.json() as {
      result: boolean;
      messages?: string[];
    };

    if (!json.result) {
      const errorMessage = json.messages?.join(', ') || '予約キャンセルに失敗しました';

      return {
        success: false,
        errorCode: 'SYSTEM_ERROR',
        errorMessage,
      };
    }

    // フォームが閉じるまで待機
    await this.waitForSelector('.appointment_detail_info.open', { state: 'hidden' });

    return { success: true };
  }

  /**
   * 予約を削除する
   *
   * @param reservation 予約リクエスト
   * @param index 予約のインデックス（スクリーンショット用）
   * @returns 予約操作結果
   */
  private async deleteReservation(
    reservation: ReservationRequest,
    index: number
  ): Promise<ReservationResult> {
    const idx = String(index).padStart(2, '0');

    try {
      // 既存の予約を検索
      const existingReservation = await this.findExistingReservation(reservation);

      if (!existingReservation) {
        return {
          reservation_id: reservation.reservation_id,
          operation: 'delete',
          result: {
            status: 'failed',
            error_code: 'RESERVATION_NOT_FOUND',
            error_message: '指定された予約が見つかりません',
          },
        };
      }

      // 予約編集フォームを開く
      await this.openEditForm(existingReservation);
      await this.screenshot.captureStep(this.page, `05-${idx}-delete-form`);

      // 削除処理を実行
      const deleteResult = await this.submitDeleteForm(`06-${idx}`);
      await this.screenshot.captureStep(this.page, `07-${idx}-delete-submitted`);

      if (!deleteResult.success) {
        await this.screenshot.captureError(this.page, `${idx}-delete-result`);

        // 失敗時はブラウザをリロードして状態をリセット
        await this.page.reload();
        await this.waitForSelector(this.selectors.dateHeader);

        return {
          reservation_id: reservation.reservation_id,
          operation: 'delete',
          result: {
            status: 'failed',
            error_code: deleteResult.errorCode || 'SYSTEM_ERROR',
            error_message: deleteResult.errorMessage,
          },
        };
      }

      return {
        reservation_id: reservation.reservation_id,
        operation: 'delete',
        result: {
          status: 'success',
          external_reservation_id: existingReservation.appointId,
        },
      };
    } catch (error) {
      await this.screenshot.captureError(this.page, `${idx}-delete`);

      // 失敗時はブラウザをリロードして状態をリセット
      await this.page.reload();
      await this.waitForSelector(this.selectors.dateHeader);

      return {
        reservation_id: reservation.reservation_id,
        operation: 'delete',
        result: {
          status: 'failed',
          error_code: 'SYSTEM_ERROR',
          error_message: error instanceof Error ? error.message : '予約削除に失敗しました',
        },
      };
    }
  }

  /**
   * 削除フォームを送信する
   *
   * @param prefix スクリーンショット用prefix
   * @returns 送信結果
   */
  private async submitDeleteForm(prefix: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }> {
    // 受付削除ボタンをクリック
    await this.click('.guest_foot_remove');

    // 確認ダイアログが表示されるまで待機
    await this.waitForSelector('.parts_dialog_home');

    // 削除確認ダイアログのスクリーンショット
    await this.screenshot.captureStep(this.page, `${prefix}-delete-confirm-dialog`);

    // APIレスポンスを待機しながらOKボタンをクリック
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/timeAppoint4M/scheduleregister/deleteappoint') &&
        response.request().method() === 'POST'
    );

    await this.click('.parts_dialog_ok');

    // APIレスポンスを取得して結果を確認
    const response = await responsePromise;
    const json = await response.json() as {
      result: boolean;
      messages?: string[];
    };

    if (!json.result) {
      const errorMessage = json.messages?.join(', ') || '予約削除に失敗しました';

      return {
        success: false,
        errorCode: 'SYSTEM_ERROR',
        errorMessage,
      };
    }

    // ダイアログが閉じるまで待機
    await this.waitForSelector('.parts_dialog_home', { state: 'hidden' });

    return { success: true };
  }
}

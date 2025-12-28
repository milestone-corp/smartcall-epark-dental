/**
 * リクエストキュー管理
 *
 * 複数リクエストを順次処理するためのキュー
 */

import { EventEmitter } from 'events';

export interface QueuedRequest<T> {
  id: string;
  data: T;
  addedAt: Date;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface RequestQueueOptions {
  /** 最大キューサイズ */
  maxSize?: number;
  /** リクエストタイムアウト（ms） */
  requestTimeoutMs?: number;
}

export type QueueState = 'idle' | 'processing' | 'paused';

export class RequestQueue<T = unknown> extends EventEmitter {
  private queue: QueuedRequest<T>[] = [];
  private state: QueueState = 'idle';
  private isProcessing = false;
  private options: Required<RequestQueueOptions>;
  private processor: ((request: T) => Promise<unknown>) | null = null;

  constructor(options: RequestQueueOptions = {}) {
    super();
    this.options = {
      maxSize: 100,
      requestTimeoutMs: 10 * 60 * 1000, // 10分
      ...options,
    };
  }

  /**
   * リクエスト処理関数を設定
   */
  setProcessor(processor: (request: T) => Promise<unknown>): void {
    this.processor = processor;
  }

  /**
   * リクエストをキューに追加
   *
   * @returns Promise<unknown> 処理結果
   */
  async enqueue(id: string, data: T): Promise<unknown> {
    if (this.queue.length >= this.options.maxSize) {
      throw new Error('Queue is full');
    }

    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id,
        data,
        addedAt: new Date(),
        resolve,
        reject,
      };

      this.queue.push(request);
      this.emit('enqueued', request);

      // タイムアウト設定
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex((r) => r.id === id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Request timeout'));
        }
      }, this.options.requestTimeoutMs);

      // リクエスト完了時にタイムアウトをクリア
      const originalResolve = request.resolve;
      const originalReject = request.reject;
      request.resolve = (result) => {
        clearTimeout(timeoutId);
        originalResolve(result);
      };
      request.reject = (error) => {
        clearTimeout(timeoutId);
        originalReject(error);
      };

      // 処理を開始
      this.processNext();
    });
  }

  /**
   * 次のリクエストを処理
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.state === 'paused' || this.queue.length === 0) {
      return;
    }

    if (!this.processor) {
      console.error('[RequestQueue] Processor not set');
      return;
    }

    this.isProcessing = true;
    this.state = 'processing';

    const request = this.queue.shift()!;
    this.emit('processing', request);

    try {
      const result = await this.processor(request.data);
      request.resolve(result);
      this.emit('completed', request, result);
    } catch (error) {
      request.reject(error as Error);
      this.emit('failed', request, error);
    } finally {
      this.isProcessing = false;

      if (this.queue.length > 0) {
        this.state = 'processing';
        // 次のリクエストを非同期で処理
        setImmediate(() => this.processNext());
      } else {
        this.state = 'idle';
      }
    }
  }

  /**
   * キューを一時停止
   */
  pause(): void {
    this.state = 'paused';
    this.emit('paused');
  }

  /**
   * キューを再開
   */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'idle';
      this.emit('resumed');
      this.processNext();
    }
  }

  /**
   * 現在のキュー状態を取得
   */
  getState(): QueueState {
    return this.state;
  }

  /**
   * キューサイズを取得
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * キューをクリア
   */
  clear(): void {
    for (const request of this.queue) {
      request.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    this.emit('cleared');
  }
}

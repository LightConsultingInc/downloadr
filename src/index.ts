import { EventEmitter } from 'events';
import fs from 'fs';
import https from 'https';
import http from 'http';

/** Represents a byte range chunk of a file */
type Chunk = {
  start: number;
  end: number;
};

// Add a type for the protocol client
type ProtocolClient = typeof http | typeof https;

/** Configuration options for the Downloadr instance */
export type DownloadrOptions = {
  /** URL of the file to download */
  url: string;
  /** Local path where the file should be saved, make sure that this writable and includes the file name */
  outputPath: string;
  /** Number of concurrent chunks to download (default: 3) */
  chunkCount?: number;
  /** Size of the read buffer in bytes (default: 64KB) */
  highWaterMark?: number;
};

export enum DownloadrEvents {
  /** Emitted when the download starts */
  DOWNLOAD_START = 'downloadStart',
  /** Emitted when the download completes */
  DOWNLOAD_COMPLETE = 'downloadComplete',
  /** Emitted when we write a chunk to the file */
  CHUNK_DOWNLOAD_PROGRESS = 'chunkDownloadProgress',
  /** Emitted when a chunk is downloaded */
  CHUNK_DOWNLOADED = 'chunkDownloaded',
  /** Emitted when a chunk is downloaded */
  CHUNK_DOWNLOAD_FAILED = 'chunkDownloadFailed',
  /** Emitted when the download fails */
  DOWNLOAD_FAILED = 'downloadFailed',
  /** Emitted when the download is cancelled */
  DOWNLOAD_CANCELLED = 'downloadCancelled',
}

const CHUNK_COUNT = 3;
const HIGH_WATER_MARK = 64 * 1024;

const PENDO_TRACK_URL = 'https://data.pendo-dev.pendo-dev.com/data/track';
const PENDO_INTEGRATION_KEY = 'dee5acc2-e92d-4e23-898f-3f2810aab34c';

/**
 * A class that handles downloading files in parallel chunks
 * @example
 * const downloader = new Downloadr({
 *   url: 'https://example.com/large-file.zip',
 *   outputPath: './downloads/file.zip'
 * });
 * await downloader.download();
 */
export class Downloadr extends EventEmitter {
  private url: string;
  private outputPath: string;
  private chunkCount: number;
  private highWaterMark: number;
  private protocolClient: ProtocolClient;
  private activeRequests: http.ClientRequest[] = [];
  private isCancelled: boolean = false;
  private fileSize: number = -1;
  private downloadStartTime: number = 0;

  /**
   * Creates a new Downloadr instance
   * @param options - Configuration options for the download
   */
  constructor(options: DownloadrOptions) {
    super();
    this.url = options.url;
    this.outputPath = options.outputPath;
    this.chunkCount = options.chunkCount ?? CHUNK_COUNT;
    this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
    this.protocolClient = this.getProtocolClient(this.url);

    this.pendoTrack('download_configured', {
      url: this.url,
      outputPath: this.outputPath,
      chunkCount: this.chunkCount,
      highWaterMark: this.highWaterMark,
      protocol: this.getProtocolName(),
      isCustomChunkCount: options.chunkCount !== undefined,
      isCustomHighWaterMark: options.highWaterMark !== undefined,
    });
  }

  /**
   * Determines which protocol client to use based on the URL
   * @param url - The URL to analyze
   * @returns The appropriate protocol client (http or https)
   */
  private getProtocolClient(url: string): ProtocolClient {
    return url.toLowerCase().startsWith('https:') ? https : http;
  }

  private getProtocolName(): string {
    return this.url.toLowerCase().startsWith('https:') ? 'https' : 'http';
  }

  private pendoTrack(
    event: string,
    properties: Record<string, string | number | boolean>,
  ): void {
    try {
      const payload = JSON.stringify({
        type: 'track',
        event,
        visitorId: 'system',
        accountId: 'system',
        timestamp: Date.now(),
        properties,
      });

      const req = https.request(
        PENDO_TRACK_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-pendo-integration-key': PENDO_INTEGRATION_KEY,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        () => {
          // Response handled silently
        },
      );

      req.on('error', () => {
        // Silently ignore tracking errors to not break application flow
      });

      req.write(payload);
      req.end();
    } catch {
      // Silently ignore tracking errors to not break application flow
    }
  }

  /**
   * Gets the total size of the remote file in bytes
   * @returns Promise that resolves with the file size
   * @throws Error if Content-Length header is missing
   */
  public async getFileSize(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this.protocolClient.request(
        this.url,
        {
          method: 'GET',
          headers: { range: 'bytes=0-0' },
        },
        (res) => {
          const contentRange = res.headers['content-range'];

          if (contentRange) {
            // Extract the total size from 'bytes 0-0/12345'
            const sizeMatch = contentRange.match(/bytes \d+-\d+\/(\d+)/);
            if (sizeMatch) {
              const size = parseInt(sizeMatch[1], 10);

              // Set chunkCount based on the size
              this.chunkCount =
                size < 100 * 1024 * 1024 ? 1 : Math.ceil(size / (100 * 1024 * 1024));

              this.pendoTrack('file_size_detected', {
                url: this.url,
                fileSize: size,
                calculatedChunkCount: this.chunkCount,
                sizeDetectionMethod: 'content-range',
                supportsRangeRequests: true,
                protocol: this.getProtocolName(),
              });

              resolve(size);
              return;
            }
          }

          // Fallback to content-length if content-range is not available
          const contentLength = res.headers['content-length'];
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            this.chunkCount = size < 100 * 1024 * 1024 ? 1 : Math.ceil(size / (100 * 1024 * 1024));

            this.pendoTrack('file_size_detected', {
              url: this.url,
              fileSize: size,
              calculatedChunkCount: this.chunkCount,
              sizeDetectionMethod: 'content-length',
              supportsRangeRequests: false,
              protocol: this.getProtocolName(),
            });

            resolve(size);
            return;
          }

          // If neither header is present, set default behavior
          this.chunkCount = 1;

          this.pendoTrack('file_size_detected', {
            url: this.url,
            fileSize: -1,
            calculatedChunkCount: 1,
            sizeDetectionMethod: 'unknown',
            supportsRangeRequests: false,
            protocol: this.getProtocolName(),
          });

          resolve(-1);
          return;
        },
      );

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Downloads a specific byte range of the file
   * @param start - Starting byte position
   * @param end - Ending byte position
   * @throws Error if server doesn't support byte range requests
   */
  private async downloadChunk(start: number, end: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already cancelled, reject immediately
      if (this.isCancelled) {
        reject(new Error('Download cancelled'));
        return;
      }

      const options =
        end === Infinity
          ? {}
          : {
              headers: {
                Range: `bytes=${start}-${end}`,
              },
            };

      const chunkStartTime = Date.now();
      const req = this.protocolClient.get(this.url, options, (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          return reject(new Error(`Unexpected status code: ${res.statusCode}`));
        }

        // If cancelled after request was made but before response was received
        if (this.isCancelled) {
          reject(new Error('Download cancelled'));
          return;
        }

        const fileStream = fs.createWriteStream(this.outputPath, {
          start,
          flags: 'r+',
          highWaterMark: this.highWaterMark,
        });
        res.pipe(fileStream);
        res.on('data', (chunk) => {
          if (!this.isCancelled) {
            this.emit(DownloadrEvents.CHUNK_DOWNLOAD_PROGRESS, { start, end, chunk });
          }
        });
        res.on('end', () => {
          if (!this.isCancelled) {
            this.emit(DownloadrEvents.CHUNK_DOWNLOADED, { start, end });

            this.pendoTrack('chunk_download_completed', {
              url: this.url,
              chunkStart: start,
              chunkEnd: end,
              chunkSizeBytes: end === Infinity ? -1 : end - start + 1,
              chunkDurationMs: Date.now() - chunkStartTime,
            });

            resolve();
          } else {
            reject(new Error('Download cancelled'));
          }
        });
        res.on('error', (err) => {
          this.emit(DownloadrEvents.CHUNK_DOWNLOAD_FAILED, err);

          this.pendoTrack('chunk_download_failed', {
            url: this.url,
            chunkStart: start,
            chunkEnd: end,
            chunkSizeBytes: end === Infinity ? -1 : end - start + 1,
            errorMessage: String(err.message).substring(0, 200),
            errorType: err.name || 'Error',
            httpStatusCode: res.statusCode ?? -1,
          });

          reject(err);
        });
      });

      // Store the request in activeRequests
      this.activeRequests.push(req);

      req.on('error', (err) => {
        this.emit(DownloadrEvents.CHUNK_DOWNLOAD_FAILED, err);
        reject(err);
      });
    });
  }

  /**
   * Calculates the byte ranges for each chunk
   * @param fileSize - Total size of the file in bytes
   * @returns Array of chunk ranges
   */
  private getChunks(fileSize: number): Chunk[] {
    const chunks: Chunk[] = [];
    const chunkSize = Math.ceil(fileSize / this.chunkCount);

    for (let i = 0; i < fileSize; i += chunkSize) {
      const end = Math.min(i + chunkSize - 1, fileSize - 1);
      chunks.push({ start: i, end });
    }

    return chunks;
  }

  /**
   * Cancels the download in progress
   * @returns void
   */
  public cancel(): void {
    if (this.isCancelled) {
      return; // Already cancelled
    }

    this.isCancelled = true;

    const activeRequestCount = this.activeRequests.length;

    // Abort all active requests
    for (const req of this.activeRequests) {
      req.destroy();
    }

    // Clear the active requests array
    this.activeRequests = [];

    // Emit the cancel event
    this.emit(DownloadrEvents.DOWNLOAD_CANCELLED);

    this.pendoTrack('download_cancelled', {
      url: this.url,
      outputPath: this.outputPath,
      fileSize: this.fileSize,
      chunkCount: this.chunkCount,
      protocol: this.getProtocolName(),
      activeRequestCount,
      elapsedTimeMs: this.downloadStartTime > 0 ? Date.now() - this.downloadStartTime : -1,
    });
  }

  /**
   * Starts the download process
   * @throws Error if the download fails for any reason
   */
  public async download(): Promise<void> {
    try {
      // Reset cancellation state
      this.isCancelled = false;
      this.activeRequests = [];

      const fileSize = await this.getFileSize();
      this.fileSize = fileSize;

      if (this.isCancelled) {
        this.emit(DownloadrEvents.DOWNLOAD_CANCELLED);
        return;
      }

      if (fileSize === -1 || this.chunkCount === 1) {
        // Unknown size or small file, download as single chunk
        this.emit(DownloadrEvents.DOWNLOAD_START);
        this.downloadStartTime = Date.now();

        this.pendoTrack('download_started', {
          url: this.url,
          outputPath: this.outputPath,
          fileSize,
          chunkCount: 1,
          protocol: this.getProtocolName(),
          highWaterMark: this.highWaterMark,
          isChunkedDownload: false,
        });

        await this.downloadChunk(0, Infinity);

        if (!this.isCancelled) {
          this.emit(DownloadrEvents.DOWNLOAD_COMPLETE);

          this.pendoTrack('download_completed', {
            url: this.url,
            outputPath: this.outputPath,
            fileSize,
            chunkCount: 1,
            protocol: this.getProtocolName(),
            downloadDurationMs: Date.now() - this.downloadStartTime,
            highWaterMark: this.highWaterMark,
          });
        }
        return;
      }

      console.log(`File size: ${fileSize} bytes`);

      // Preallocate a blank file of the needed size
      const fd = fs.openSync(this.outputPath, 'w');
      fs.ftruncateSync(fd, fileSize);
      fs.closeSync(fd);

      const chunks = this.getChunks(fileSize);

      this.emit(DownloadrEvents.DOWNLOAD_START);
      this.downloadStartTime = Date.now();

      this.pendoTrack('download_started', {
        url: this.url,
        outputPath: this.outputPath,
        fileSize,
        chunkCount: chunks.length,
        protocol: this.getProtocolName(),
        highWaterMark: this.highWaterMark,
        isChunkedDownload: chunks.length > 1,
      });

      const tasks: Promise<void>[] = chunks.map((chunk) =>
        this.downloadChunk(chunk.start, chunk.end),
      );

      await Promise.all(tasks);

      if (!this.isCancelled) {
        this.emit(DownloadrEvents.DOWNLOAD_COMPLETE);

        this.pendoTrack('download_completed', {
          url: this.url,
          outputPath: this.outputPath,
          fileSize,
          chunkCount: chunks.length,
          protocol: this.getProtocolName(),
          downloadDurationMs: Date.now() - this.downloadStartTime,
          highWaterMark: this.highWaterMark,
        });
      }
    } catch (err) {
      if (this.isCancelled) {
        // If the error was due to cancellation, don't emit download failed
        return;
      }
      this.emit(DownloadrEvents.DOWNLOAD_FAILED, err);

      const error = err instanceof Error ? err : new Error(String(err));
      this.pendoTrack('download_failed', {
        url: this.url,
        outputPath: this.outputPath,
        fileSize: this.fileSize,
        chunkCount: this.chunkCount,
        protocol: this.getProtocolName(),
        errorMessage: error.message.substring(0, 200),
        errorType: error.name || 'Error',
        downloadDurationMs: this.downloadStartTime > 0 ? Date.now() - this.downloadStartTime : -1,
      });

      throw err; // Re-throw the error to let the caller handle it
    }
  }
}

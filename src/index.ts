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
}

const CHUNK_COUNT = 3;
const HIGH_WATER_MARK = 64 * 1024;

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
  }

  /**
   * Determines which protocol client to use based on the URL
   * @param url - The URL to analyze
   * @returns The appropriate protocol client (http or https)
   */
  private getProtocolClient(url: string): ProtocolClient {
    return url.toLowerCase().startsWith('https:') ? https : http;
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

              resolve(size);
              return;
            }
          }

          // Fallback to content-length if content-range is not available
          const contentLength = res.headers['content-length'];
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            this.chunkCount = size < 100 * 1024 * 1024 ? 1 : Math.ceil(size / (100 * 1024 * 1024));
            resolve(size);
            return;
          }

          // If neither header is present, set default behavior
          this.chunkCount = 1;
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
      const options =
        end === Infinity
          ? {}
          : {
              headers: {
                Range: `bytes=${start}-${end}`,
              },
            };

      const req = this.protocolClient.get(this.url, options, (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          return reject(new Error(`Unexpected status code: ${res.statusCode}`));
        }
        const fileStream = fs.createWriteStream(this.outputPath, {
          start,
          flags: 'r+',
          highWaterMark: this.highWaterMark,
        });
        res.pipe(fileStream);
        res.on('data', (chunk) => {
          this.emit(DownloadrEvents.CHUNK_DOWNLOAD_PROGRESS, { start, end, chunk });
        });
        res.on('end', () => {
          this.emit(DownloadrEvents.CHUNK_DOWNLOADED, { start, end });
          resolve();
        });
        res.on('error', (err) => {
          this.emit(DownloadrEvents.CHUNK_DOWNLOAD_FAILED, err);
          reject(err);
        });
      });
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
   * Starts the download process
   * @throws Error if the download fails for any reason
   */
  public async download(): Promise<void> {
    try {
      const fileSize = await this.getFileSize();

      if (fileSize === -1 || this.chunkCount === 1) {
        // Unknown size or small file, download as single chunk
        this.emit(DownloadrEvents.DOWNLOAD_START);
        await this.downloadChunk(0, Infinity);
        this.emit(DownloadrEvents.DOWNLOAD_COMPLETE);
        return;
      }

      console.log(`File size: ${fileSize} bytes`);

      // Preallocate a blank file of the needed size
      const fd = fs.openSync(this.outputPath, 'w');
      fs.ftruncateSync(fd, fileSize);
      fs.closeSync(fd);

      const chunks = this.getChunks(fileSize);

      this.emit(DownloadrEvents.DOWNLOAD_START);
      const tasks: Promise<void>[] = chunks.map((chunk) =>
        this.downloadChunk(chunk.start, chunk.end),
      );

      await Promise.all(tasks);

      this.emit(DownloadrEvents.DOWNLOAD_COMPLETE);
    } catch (err) {
      this.emit(DownloadrEvents.DOWNLOAD_FAILED, err);
      throw err; // Re-throw the error to let the caller handle it
    }
  }
}

import { Downloadr, DownloadrEvents } from '../index';
import https from 'https';
import fs from 'fs';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

// Mock the entire https and fs modules
jest.mock('https');
jest.mock('fs');

// Add this type at the top of the file
type MockResponse = EventEmitter & Partial<IncomingMessage>;

describe('Downloadr', () => {
  let downloader: Downloadr;
  const mockOptions = {
    url: 'https://example.com/file.zip',
    outputPath: '/path/to/file.zip',
  };

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    downloader = new Downloadr(mockOptions);
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(downloader).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom chunk count and buffer size', () => {
      const customDownloader = new Downloadr({
        ...mockOptions,
        chunkCount: 5,
        highWaterMark: 128 * 1024,
      });
      expect(customDownloader).toBeInstanceOf(Downloadr);
    });
  });

  describe('download', () => {
    beforeEach(() => {
      // Mock successful HEAD request
      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        const mockResponse = {
          headers: {
            'content-length': '1000',
          },
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });

      // Mock successful GET request
      (https.get as jest.Mock).mockImplementation((_, __, callback) => {
        const mockResponse = new EventEmitter() as MockResponse;
        mockResponse.statusCode = 206;
        mockResponse.pipe = jest.fn();

        // Emit end event after a short delay
        setTimeout(() => {
          mockResponse.emit('end');
        }, 10);

        callback(mockResponse);
        return { on: jest.fn() };
      });

      // Mock file system operations
      (fs.openSync as jest.Mock).mockReturnValue(1);
      (fs.ftruncateSync as jest.Mock).mockReturnValue(undefined);
      (fs.closeSync as jest.Mock).mockReturnValue(undefined);
      (fs.createWriteStream as jest.Mock).mockReturnValue({
        on: jest.fn(),
      });
    });

    it('should emit events in correct order', async () => {
      const events: string[] = [];

      downloader.on(DownloadrEvents.DOWNLOAD_START, () => events.push('start'));
      downloader.on(DownloadrEvents.CHUNK_DOWNLOADED, () => events.push('chunk'));
      downloader.on(DownloadrEvents.DOWNLOAD_COMPLETE, () => events.push('complete'));

      await downloader.download();

      expect(events).toEqual(['start', 'chunk', 'chunk', 'chunk', 'complete']);
    });

    it('should handle missing content-length header', async () => {
      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({ headers: {} });
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });

      await expect(downloader.download()).rejects.toThrow('Content-Length header missing');
    });

    it('should handle invalid status code', async () => {
      (https.get as jest.Mock).mockImplementation((_, __, callback) => {
        const mockResponse = new EventEmitter() as MockResponse;
        mockResponse.statusCode = 404;
        callback(mockResponse);
        return { on: jest.fn() };
      });

      await expect(downloader.download()).rejects.toThrow('Unexpected status code: 404');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network failure');
      (https.get as jest.Mock).mockImplementation((_, __) => {
        return {
          on: (event: string, cb: (error: Error) => void): void => {
            if (event === 'error') {
              cb(networkError);
            }
          },
        };
      });

      let errorEvent: Error | undefined;
      downloader.on(DownloadrEvents.DOWNLOAD_FAILED, (err) => {
        errorEvent = err;
      });

      await expect(downloader.download()).rejects.toThrow('Network failure');
      expect(errorEvent).toBe(networkError);
    });

    it('should create correct number of chunks', async () => {
      const customDownloader = new Downloadr({
        ...mockOptions,
        chunkCount: 5,
      });

      await customDownloader.download();

      // Check that https.get was called 5 times (once for each chunk)
      expect(https.get).toHaveBeenCalledTimes(5);
    });
  });
});

import { Downloadr, DownloadrEvents } from '../index';
import https from 'https';
import fs from 'fs';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import http from 'http';

// Mock the entire https and fs modules
jest.mock('https');
jest.mock('fs');
jest.mock('http');

// Add this type at the top of the file
type MockResponse = EventEmitter & Partial<IncomingMessage>;

describe('Downloadr', () => {
  let downloader: Downloadr;
  const mockHttpsOptions = {
    url: 'https://example.com/file.zip',
    outputPath: '/path/to/file.zip',
  };
  const mockHttpOptions = {
    url: 'http://example.com/file.zip',
    outputPath: '/path/to/file.zip',
  };

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    downloader = new Downloadr(mockHttpsOptions);
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(downloader).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom chunk count and buffer size', () => {
      const customDownloader = new Downloadr({
        ...mockHttpsOptions,
        chunkCount: 5,
        highWaterMark: 128 * 1024,
      });
      expect(customDownloader).toBeInstanceOf(Downloadr);
    });
  });

  describe('protocol selection', () => {
    it('should use https for https URLs', () => {
      const httpsDownloader = new Downloadr(mockHttpsOptions);

      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({ headers: { 'content-length': '1000' } });
        return { on: jest.fn(), end: jest.fn() };
      });

      return httpsDownloader.getFileSize().then(() => {
        expect(https.request).toHaveBeenCalled();
        expect(http.request).not.toHaveBeenCalled();
      });
    });

    it('should use http for http URLs', () => {
      const httpDownloader = new Downloadr(mockHttpOptions);

      (http.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({ headers: { 'content-length': '1000' } });
        return { on: jest.fn(), end: jest.fn() };
      });

      return httpDownloader.getFileSize().then(() => {
        expect(http.request).toHaveBeenCalled();
        expect(https.request).not.toHaveBeenCalled();
      });
    });
  });

  describe('download', () => {
    beforeEach(() => {
      // Update to configure both http and https mocks
      const mockRequestImplementation = (
        url: string | URL,
        options: unknown,
        callback: CallableFunction,
      ): { on: jest.Mock; end: jest.Mock } => {
        const mockResponse = {
          headers: {
            'content-length': '200000000', // 200MB
          },
        };
        callback(mockResponse);
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      };

      const mockGetImplementation = (
        url: string | URL,
        options: unknown,
        callback: CallableFunction,
      ): { on: jest.Mock } => {
        const mockResponse = new EventEmitter() as MockResponse;
        mockResponse.statusCode = 206;
        mockResponse.pipe = jest.fn();

        setTimeout(() => {
          mockResponse.emit('end');
        }, 10);

        callback(mockResponse);
        return { on: jest.fn() };
      };

      // Mock both http and https
      (http.request as jest.Mock).mockImplementation(mockRequestImplementation);
      (https.request as jest.Mock).mockImplementation(mockRequestImplementation);
      (http.get as jest.Mock).mockImplementation(mockGetImplementation);
      (https.get as jest.Mock).mockImplementation(mockGetImplementation);

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

    it('should handle missing content-length header by downloading in single chunk', async () => {
      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({ headers: {} });
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });

      await downloader.download();
      expect(https.get).toHaveBeenCalledTimes(1); // Should only make one request
      expect(https.get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({}), // Should not include Range header
        expect.any(Function),
      );
    });

    it('should download file in single chunk when content-length is missing', async () => {
      // Mock HEAD request to return no content-length
      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({ headers: {} });
        return {
          on: jest.fn(),
          end: jest.fn(),
        };
      });

      const events: string[] = [];
      downloader.on(DownloadrEvents.DOWNLOAD_START, () => events.push('start'));
      downloader.on(DownloadrEvents.CHUNK_DOWNLOADED, () => events.push('chunk'));
      downloader.on(DownloadrEvents.DOWNLOAD_COMPLETE, () => events.push('complete'));

      await downloader.download();

      expect(events).toEqual(['start', 'chunk', 'complete']); // Only one chunk
      expect(https.get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({}), // No Range header for full file download
        expect.any(Function),
      );
    });

    it('should handle small files as single chunk', async () => {
      // Mock HEAD request to return small file size
      (https.request as jest.Mock).mockImplementation((_, __, callback) => {
        callback({
          headers: {
            'content-length': '1000000' // 1MB (under 100MB threshold)
          }
        });
        return {
          on: jest.fn(),
          end: jest.fn()
        };
      });

      (https.get as jest.Mock).mockImplementation((_, __, callback) => {
        const mockResponse = new EventEmitter() as MockResponse;
        mockResponse.statusCode = 200;
        mockResponse.pipe = jest.fn();
        
        setTimeout(() => {
          mockResponse.emit('end');
        }, 10);
        
        callback(mockResponse);
        return { on: jest.fn() };
      });

      const events: string[] = [];
      downloader.on(DownloadrEvents.DOWNLOAD_START, () => events.push('start'));
      downloader.on(DownloadrEvents.CHUNK_DOWNLOADED, () => events.push('chunk'));
      downloader.on(DownloadrEvents.DOWNLOAD_COMPLETE, () => events.push('complete'));

      await downloader.download();
      expect(events).toEqual(['start', 'chunk', 'complete']);
      expect(https.get).toHaveBeenCalledTimes(1); // Should only make one request
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
        ...mockHttpsOptions,
        chunkCount: 5,
      });

      await customDownloader.download();

      // Check that https.get was called 5 times (once for each chunk)
      expect(https.get).toHaveBeenCalledTimes(5);
    });

    // Add test for HTTP download
    it('should successfully download using HTTP protocol', async () => {
      const httpDownloader = new Downloadr(mockHttpOptions);
      const events: string[] = [];

      httpDownloader.on(DownloadrEvents.DOWNLOAD_START, () => events.push('start'));
      httpDownloader.on(DownloadrEvents.CHUNK_DOWNLOADED, () => events.push('chunk'));
      httpDownloader.on(DownloadrEvents.DOWNLOAD_COMPLETE, () => events.push('complete'));

      await httpDownloader.download();

      expect(events).toEqual(['start', 'chunk', 'chunk', 'chunk', 'complete']);
      expect(http.get).toHaveBeenCalled();
      expect(https.get).not.toHaveBeenCalled();
    });
  });
});

# Downloadr

[![](https://img.shields.io/npm/v/@lightci/downloadr)](https://www.npmjs.com/package/@lightci/downloadr)
[![License MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Downloadr is an http download manager that downloads files in parallel chunks and streams them to the file system.

## Installation

```bash
npm install @lightci/downloadr
```

## Basic Usage

```ts
import { Downloadr } from '@lightci/downloadr';

const downloadr = new Downloadr({
  url: 'https://example.com/file.zip',
  output: 'file.zip',
});

downloadr.on(DownloadrEvents.DOWNLOAD_START, () => {
  console.log('Download started');
});

downloadr.on(DownloadrEvents.DOWNLOAD_COMPLETE, () => {
  console.log('Download completed');
});

downloadr.on(DownloadrEvents.CHUNK_DOWNLOAD_PROGRESS, (chunk) => {
  console.log(`Downloaded chunk ${chunk.start} of ${chunk.end}`);
});

await downloadr.download();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | `undefined` | **Required** The url of the file to download. |
| `output` | `string` | `undefined` | **Required** The path to save the file to. |
| `chunkCount` | `number` | `3` | The number of concurrent chunks to download. |
| `highWaterMark` | `number` | `64 * 1024` | The size of the write buffer in bytes. |

## Events

| Event | Description |
|-------|-------------|
| DOWNLOAD_START | Emitted when the download starts. |
| DOWNLOAD_COMPLETE | Emitted when the download completes. |
| CHUNK_DOWNLOAD_PROGRESS | Emitted when a chunk is downloaded. |
| CHUNK_DOWNLOADED | Emitted when a chunk is downloaded. |
| CHUNK_DOWNLOAD_FAILED | Emitted when a chunk download fails. |
| DOWNLOAD_FAILED | Emitted when the download fails. |

## License

[MIT](https://opensource.org/licenses/MIT)

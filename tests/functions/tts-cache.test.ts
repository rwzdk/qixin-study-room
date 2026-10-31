// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// worker-mailer 依赖 Workers 专有的 cloudflare:sockets，Node 测试里换成空实现。
vi.mock('worker-mailer', () => ({
  WorkerMailer: {
    connect: async () => ({ send: async () => {}, close: async () => {} }),
  },
}));

const { default: worker } = await import('../../cloudflare/chat-worker/worker.js');

const AUDIO_BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

function ttsRequest(text = '专注完成啦', voice = 'Maia', speed = 1): Request {
  return new Request('https://worker.local/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  });
}

function createCacheStub() {
  const store = new Map<string, Response>();
  return {
    store,
    caches: {
      default: {
        match: async (key: Request) => store.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => {
          store.set(key.url, response.clone());
        },
      },
    },
  };
}

let upstreamCalls = 0;

beforeEach(() => {
  upstreamCalls = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    upstreamCalls += 1;
    const url = String(input);
    if (url.includes('dashscope')) {
      return new Response(
        JSON.stringify({ output: { audio: { url: 'http://oss.local/audio.wav' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(AUDIO_BYTES, {
      status: 200,
      headers: { 'content-type': 'audio/x-wav' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TTS 音频缓存', () => {
  it('同文本同音色只合成一次，第二次直接命中边缘缓存', async () => {
    const { caches } = createCacheStub();
    vi.stubGlobal('caches', caches);
    const env = { QWEN_TTS_API_KEY: 'test-key' };

    const first = await worker.fetch(ttsRequest(), env);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-tts-cache')).toBe('miss');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(AUDIO_BYTES);
    expect(upstreamCalls).toBe(2);

    const second = await worker.fetch(ttsRequest(), env);
    expect(second.status).toBe(200);
    expect(second.headers.get('x-tts-cache')).toBe('hit');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(AUDIO_BYTES);
    // 命中缓存后不再请求百炼，也不再回源下载音频。
    expect(upstreamCalls).toBe(2);
  });

  it('换了音色就当不同缓存项', async () => {
    const { caches, store } = createCacheStub();
    vi.stubGlobal('caches', caches);
    const env = { QWEN_TTS_API_KEY: 'test-key' };

    await worker.fetch(ttsRequest('专注完成啦', 'Maia'), env);
    const other = await worker.fetch(ttsRequest('专注完成啦', 'Momo'), env);
    expect(other.headers.get('x-tts-cache')).toBe('miss');
    expect(store.size).toBe(2);
  });
});

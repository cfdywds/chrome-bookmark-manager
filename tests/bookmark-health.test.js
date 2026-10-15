import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('书签健康体检医生 (Health Doctor) · 高置信防误杀体系', () => {
  let BM;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue({})
        }
      }
    };
    await import('../js/lib.js');
    BM = globalThis.BM;
  });

  it('确诊死链：仅 404 与 410 被判定为 dead', async () => {
    // 模拟 fetch 返回 404
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers()
    });

    const res404 = await BM.checkUrlHealth('https://example.com/not-found');
    expect(res404.status).toBe('dead');
    expect(res404.code).toBe(404);

    // 模拟 fetch 返回 410
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 410,
      headers: new Headers()
    });

    const res410 = await BM.checkUrlHealth('https://example.com/gone');
    expect(res410.status).toBe('dead');
    expect(res410.code).toBe(410);
  });

  it('防误杀隔离：网络连接失败/断网/DNS解析失败绝不判定为 dead，而是 suspicious', async () => {
    // 模拟 fetch 抛出 TypeError: Failed to fetch (典型的无外网或被墙情况，连 no-cors 也失败)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await BM.checkUrlHealth('https://github.com/cfdywds');
    expect(res.status).toBe('suspicious');
    expect(res.isProxyDomain).toBe(true);
    expect(res.status).not.toBe('dead');
  });

  it('防误报探针：因无 CORS 响应头导致普通 fetch 报错，但 mode: no-cors 成功握手时判定为 ok', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (init && init.mode === 'no-cors') {
        return Promise.resolve({ type: 'opaque', status: 0 });
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    const res = await BM.checkUrlHealth('https://juejin.cn/post/123');
    expect(res.status).toBe('ok');
    expect(res.code).toBe(200);
    expect(res.reason).toContain('受同源保护');
  });

  it('防误杀隔离：请求超时绝不判定为 dead，而是 suspicious (timeout)', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    const res = await BM.checkUrlHealth('https://medium.com/some-post');
    expect(res.status).toBe('suspicious');
    expect(res.reason).toContain('超时');
    expect(res.status).not.toBe('dead');
  });

  it('防误杀隔离：403 Forbidden 与 500 服务端错误属于 suspicious，不可误判为死链', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 403,
      headers: new Headers()
    });

    const res403 = await BM.checkUrlHealth('https://example.com/login');
    expect(res403.status).toBe('suspicious');
    expect(res403.status).not.toBe('dead');

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 502,
      headers: new Headers()
    });

    const res502 = await BM.checkUrlHealth('https://example.com/gateway-error');
    expect(res502.status).toBe('suspicious');
    expect(res502.status).not.toBe('dead');
  });

  it('重定向检测：301 / 302 正确提取新地址', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 301,
      headers: new Headers({ location: 'https://new.example.com' })
    });

    const res = await BM.checkUrlHealth('http://old.example.com');
    expect(res.status).toBe('redirect');
    expect(res.redirectUrl).toBe('https://new.example.com');
  });

  it('批量健康检查池：正确执行限流并发与进度回调', async () => {
    globalThis.fetch = vi.fn().mockImplementation(url => {
      if (url.includes('404')) return Promise.resolve({ status: 404, headers: new Headers() });
      if (url.includes('proxy')) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ status: 200, headers: new Headers() });
    });

    const items = [
      { id: '1', title: '正常站点', url: 'https://example.com' },
      { id: '2', title: '404站点', url: 'https://example.com/404' },
      { id: '3', title: '外网站点', url: 'https://github.com/proxy' }
    ];

    const progressUpdates = [];
    const results = await BM.checkBookmarksHealth(items, {
      concurrency: 2,
      onProgress: (current, total, itemRes) => {
        progressUpdates.push({ current, total, id: itemRes.id });
      }
    });

    expect(progressUpdates.length).toBe(3);
    expect(results.dead.length).toBe(1);
    expect(results.dead[0].id).toBe('2');
    expect(results.suspicious.length).toBe(1);
    expect(results.suspicious[0].id).toBe('3');
    expect(results.ok.length).toBe(1);
    expect(results.ok[0].id).toBe('1');
  });
});

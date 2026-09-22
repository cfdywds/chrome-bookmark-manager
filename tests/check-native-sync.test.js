import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  NATIVE_SYNC_ROOT_TITLE,
  syncUrlKey,
  nativeChecksum,
  nativeBucketForUrl,
  decodeNativePayload,
  collectSyncData,
  collectUserBookmarks,
  crossCheckHidden,
  compareNativeGeneration,
  compareNativeRevision
} from '../scripts/check-native-sync.js';

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodePayload(value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  const compressed = zlib.gzipSync(bytes);
  return 'z' + base64Url(compressed);
}

function buildFixture() {
  const key = syncUrlKey('https://example.com/secret');
  const bucket = nativeBucketForUrl(key);
  const deviceId = 'device-aaa';
  const record = { tags: ['工作'], hidden: true, revision: [1750000000000, 1, deviceId] };
  const payload = {
    version: 1,
    type: 'records',
    deviceId,
    records: { [key]: record }
  };
  const encoded = encodePayload(payload);
  const chunks = [];
  for (let index = 0; index < encoded.length; index += 180) {
    chunks.push(encoded.slice(index, index + 180));
  }
  const generation = 'abc-def';
  const checksum = nativeChecksum(encoded);
  const chunkNodes = chunks.map((chunk, index) => ({
    id: 'c' + index,
    name: `BMN1|S|${bucket}|${generation}|${index}|${chunks.length}|${chunk}`,
    type: 'folder'
  }));
  const headNode = {
    id: 'h',
    name: `BMN1|H|${bucket}|${generation}|${chunks.length}|${checksum}`,
    type: 'folder'
  };
  return {
    tree: [{
      id: '0',
      name: '',
      type: 'folder',
      children: [{
        id: '1',
        name: '书签栏',
        type: 'folder',
        children: [
          { id: '10', name: '秘密书签', url: 'https://example.com/secret', type: 'url' },
          { id: '11', name: '普通书签', url: 'https://example.com/plain', type: 'url' },
          { id: '12', name: '未发布书签', url: 'https://example.com/other', type: 'url' }
        ]
      }, {
        id: '2',
        name: '其他书签',
        type: 'folder',
        children: [{
          id: '3',
          name: NATIVE_SYNC_ROOT_TITLE,
          type: 'folder',
          children: [{
            id: '4',
            name: `BMN1|D|${deviceId}`,
            type: 'folder',
            children: [...chunkNodes, headNode]
          }]
        }]
      }]
    }],
    key,
    bucket,
    deviceId,
    payload,
    encoded,
    record
  };
}

describe('scripts/check-native-sync.js', () => {
  it('入口脚本不带 shebang：vitest 的 SSR 转译会把注入语句排在 shebang 之前，导致解析失败', () => {
    const source = readFileSync(
      new URL('../scripts/check-native-sync.js', import.meta.url),
      'utf-8'
    );
    expect(source.startsWith('#!')).toBe(false);
  });

  it('syncUrlKey 规范化与 js/background.js 一致', () => {
    expect(syncUrlKey('https://www.Example.com/Path/')).toBe('example.com/path');
    expect(syncUrlKey('https://example.com/a?x=1#!b')).toBe('example.com/a?x=1');
    expect(syncUrlKey('https://example.com/#!/route')).toBe('example.com#!/route');
    expect(syncUrlKey('https://example.com/A/B?c=2')).toBe('example.com/a/b?c=2');
  });

  it('nativeBucketForUrl 稳定且范围正确', () => {
    const bucket = nativeBucketForUrl('example.com/path');
    expect(bucket).toMatch(/^\d{2}$/);
    expect(Number(bucket)).toBeGreaterThanOrEqual(0);
    expect(Number(bucket)).toBeLessThan(32);
    expect(nativeBucketForUrl('example.com/path')).toBe(nativeBucketForUrl('example.com/path'));
  });

  it('nativeChecksum 复现 background.js 的 FNV-1a 32 算法', () => {
    expect(nativeChecksum('abc')).toBe('7aigaz-3');
    expect(nativeChecksum('')).toBe('ztntfp-0');
  });

  it('decodeNativePayload 可解 gzip(base64url) 分片', () => {
    const fixture = buildFixture();
    const decoded = decodeNativePayload(fixture.encoded);
    expect(decoded).toEqual(fixture.payload);
    expect(decodeNativePayload('x-invalid')).toBeNull();
  });

  it('collectSyncData 解码设备分片并统计隐藏记录', () => {
    const fixture = buildFixture();
    const data = collectSyncData(fixture.tree);
    expect(data.root).toBeTruthy();
    expect(data.errors).toEqual([]);
    expect(data.devices).toHaveLength(1);
    const device = data.devices[0];
    expect(device.deviceId).toBe('device-aaa');
    expect(device.recordCount).toBe(1);
    expect(device.hiddenCount).toBe(1);
    const record = device.records[fixture.key];
    expect(record).toMatchObject({ hidden: true, tags: ['工作'] });
    expect(compareNativeRevision(record.revision, fixture.record.revision)).toBe(0);
  });

  it('collectSyncData 报告校验和不匹配', () => {
    const fixture = buildFixture();
    // 篡改分片内容（保持标题结构合法、长度不变），破坏 checksum
    const chunk = fixture.tree[0].children[1].children[0].children[0].children[0];
    const last = chunk.name[chunk.name.length - 1];
    chunk.name = chunk.name.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    const data = collectSyncData(fixture.tree);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.errors[0]).toContain('分片校验和不匹配');
  });

  it('collectUserBookmarks 忽略内部同步目录', () => {
    const fixture = buildFixture();
    const bookmarks = collectUserBookmarks(fixture.tree);
    expect(bookmarks.map(b => b.id)).toEqual(['10', '11', '12']);
  });

  it('crossCheckHidden 区分 已发布/未发布/缺失/无此书签', () => {
    const fixture = buildFixture();
    const data = collectSyncData(fixture.tree);
    const check = crossCheckHidden(fixture.tree, data, ['10', '11', '12', '99']);
    const byId = Object.fromEntries(check.results.map(r => [r.id, r.status]));
    expect(byId['10']).toBe('OK');           // hidden=true 已发布
    expect(byId['11']).toBe('MISSING');      // 该 URL 无任何记录
    expect(byId['12']).toBe('MISSING');      // 该 URL 无任何记录
    expect(byId['99']).toBe('NO_BOOKMARK');  // 文件里没有这个 id
    expect(check.okCount).toBe(1);
    expect(check.missingCount).toBe(2);
  });

  it('crossCheckHidden 的 NOT_PUBLISHED：有记录但 hidden=false', () => {
    const fixture = buildFixture();
    // 第二台设备发布了一条该 URL 的记录，但 hidden=false
    const plainKey = syncUrlKey('https://example.com/plain');
    const plainPayload = {
      version: 1,
      type: 'records',
      deviceId: 'device-bbb',
      records: {
        [plainKey]: { tags: ['普通'], hidden: false, revision: [1750000000002, 0, 'device-bbb'] }
      }
    };
    const encoded = encodePayload(plainPayload);
    const bucket = nativeBucketForUrl(plainKey);
    const checksum = nativeChecksum(encoded);
    const root = fixture.tree[0].children[1].children[0];
    root.children.push({
      id: '5',
      name: 'BMN1|D|device-bbb',
      type: 'folder',
      children: [
        { id: 'c-extra', name: `BMN1|S|${bucket}|gen-2|0|1|${encoded}`, type: 'folder' },
        { id: 'h-extra', name: `BMN1|H|${bucket}|gen-2|1|${checksum}`, type: 'folder' }
      ]
    });
    const data = collectSyncData(fixture.tree);
    expect(data.errors).toEqual([]);
    const check = crossCheckHidden(fixture.tree, data, ['11']);
    expect(check.results[0].status).toBe('NOT_PUBLISHED');
  });

  it('compareNativeGeneration 与 background.js 语义一致', () => {
    expect(compareNativeGeneration('a', 'b')).toBeLessThan(0);
    expect(compareNativeGeneration('b', 'a')).toBeGreaterThan(0);
    expect(compareNativeGeneration('a-1', 'a-2')).toBeLessThan(0);
    expect(compareNativeGeneration('a-2', 'a-1')).toBeGreaterThan(0);
  });
});
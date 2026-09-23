/**
 * 用 AI 初始化固定标签池的回归
 *
 * 背景：标签池原先只能手动维护。这里锁定新增的「AI 初始化」链路：
 * 1) 设置页入口存在且绑定了流程；
 * 2) 采样只在本地按域名聚合（不发全量书签），跳过内部同步目录、非普通网页与高敏书签；
 * 3) AI 返回值解析容忍多种形态，剔除兜底词 / 重复 / 过长 / HTML 元字符；
 * 4) 结果先预览，由用户选覆盖或并入，再走既有的标签池保存流程。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const libSource = readFileSync(join(root, 'js', 'lib.js'), 'utf-8');
const optionsSource = readFileSync(join(root, 'js', 'options.js'), 'utf-8');
const optionsHtml = readFileSync(join(root, 'options.html'), 'utf-8');

// 按缩进取完整函数体：lib.js 的函数在 IIFE 内（收尾行为两空格缩进的 "  }"），
// options.js 的是顶层函数（收尾行为列 0 的 "}"）
function functionSource(source, name, indent = '  ') {
  const signature = `function ${name}(`;
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`未找到函数 ${name}`);
  const start = source.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at;
  const rest = source.slice(start);
  const end = new RegExp(`\\r?\\n${indent}\\}\\r?\\n`).exec(rest);
  if (!end) throw new Error(`未找到函数收尾 ${name}`);
  return rest.slice(0, end.index + end[0].length);
}

function restoreChrome(previous) {
  if (previous === undefined) delete globalThis.chrome;
  else globalThis.chrome = previous;
}

describe('AI 初始化固定标签池', () => {
  it('设置页提供入口，并把它接到 AI 初始化流程', () => {
    expect(optionsHtml).toContain('id="aiInitFixedTags"');
    expect(optionsSource).toContain(
      "$('#aiInitFixedTags')?.addEventListener('click', aiInitFixedTags)"
    );
    const source = functionSource(optionsSource, 'aiInitFixedTags', '');
    expect(source).toContain('BM.collectAiTagSamples');
    expect(source).toContain('BM.suggestFixedTags');
    // 结果先预览：覆盖 / 并入两种落地方式，都不直接写池
    expect(source).toContain("confirmText: '覆盖标签池'");
    expect(source).toContain("thirdText: '并入现有池'");
    expect(source).toContain('persistFixedTags()');
  });

  it('未配置 AI 时先引导到 AI 分组，不读书签也不发请求', () => {
    const source = functionSource(optionsSource, 'aiInitFixedTags', '');
    const guard = source.indexOf("jumpToSection('opt-ai', true)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf('BM.collectAiTagSamples'));
  });

  it('lib 侧导出采样与归纳接口，提示词约束数量与兜底词', () => {
    expect(libSource).toContain('collectAiTagSamples,');
    expect(libSource).toContain('suggestFixedTags,');
    const source = functionSource(libSource, 'suggestFixedTags');
    expect(source).toContain('15-25 个中文分类标签');
    expect(source).toContain('兜底词');
    expect(source).toContain('chatWithFallback(body, cfg)');
    // 现有池作为参考一起给出，避免丢掉仍然适用的分类
    expect(source).toContain('loadFixedTags()');
  });

  it('采样按域名聚合、跳过同步目录与非网页，并截断到站点上限', async () => {
    const previousChrome = globalThis.chrome;
    const SUGGEST_SITES_MAX = 3;
    const NATIVE_SYNC_ROOT_TITLE = '书签管家同步数据（请勿修改）';
    const isHttpUrl = url => /^https?:\/\//.test(String(url || ''));
    const isAiEligibleItem = item => isHttpUrl(item.url) && !item.url.includes('bank');
    globalThis.chrome = {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([
          {
            children: [
              {
                children: [
                  { title: 'A', url: 'https://a.example.com/1' },
                  { title: 'A2', url: 'https://www.a.example.com/2' },
                  { title: 'A3', url: 'https://a.example.com/3' },
                  { title: 'B', url: 'https://b.example.com/' },
                  { title: 'C', url: 'https://c.example.com/' },
                  { title: 'D', url: 'https://d.example.com/' },
                  { title: '银行', url: 'https://bank.example.com/' },
                  { title: '书签管理器', url: 'chrome://bookmarks/' }
                ]
              },
              {
                title: NATIVE_SYNC_ROOT_TITLE,
                children: [{ title: '同步', url: 'https://sync.example.com/' }]
              }
            ]
          }
        ])
      }
    };
    try {
      const collectAiTagSamples = eval(`(${functionSource(libSource, 'collectAiTagSamples')})`);
      const res = await collectAiTagSamples({ maxSites: SUGGEST_SITES_MAX });
      // 书签数最多的站点在前，其余按域名排序；只取上限内的站点
      expect(res.samples.map(s => s.domain)).toEqual([
        'a.example.com',
        'b.example.com',
        'c.example.com'
      ]);
      expect(res.samples[0]).toEqual({
        domain: 'a.example.com',
        count: 3,
        titles: ['A', 'A2'] // 每个站点最多带 2 条标题样本
      });
      expect(res.sites).toBe(4); // a / b / c / d；同步目录与 chrome:// 不计入
      expect(res.total).toBe(7); // 只统计 http(s) 书签
      expect(res.skippedSensitive).toBe(1); // 银行类高敏书签被排除，连域名都不发
    } finally {
      restoreChrome(previousChrome);
    }
  });

  it('解析 AI 返回值：容忍多种形态，剔除兜底词 / 重复 / 过长 / HTML 元字符', () => {
    const normalizeTag = raw =>
      String(raw == null ? '' : raw)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 20);
    const FALLBACK_TAG = '其他';
    const SUGGEST_TAG_MAX_LEN = 12;
    const SUGGEST_TAGS_MAX = 25;
    const parseSuggestedTags = eval(`(${functionSource(libSource, 'parseSuggestedTags')})`);

    expect(parseSuggestedTags('{"tags":["代码","设计"]}')).toEqual(['代码', '设计']);
    // 模型偶尔会套代码围栏，或换用 results / labels 这类键
    expect(parseSuggestedTags('```json\n{"results":["资讯","论坛"]}\n```')).toEqual([
      '资讯',
      '论坛'
    ]);
    expect(parseSuggestedTags('{"labels":["学习"]}')).toEqual(['学习']);
    expect(parseSuggestedTags('["工具","效率"]')).toEqual(['工具', '效率']);
    // 兜底词、重复、过长与 HTML 元字符都要挡掉
    expect(
      parseSuggestedTags('["学习","学习","其他","这是个特别特别长的分类标签名称","<b>安全</b>"]')
    ).toEqual(['学习', 'b安全/b']);
    expect(parseSuggestedTags('不是 JSON')).toEqual([]);
  });

  it('超过上限的标签会被截断，避免写坏标签池', () => {
    const normalizeTag = raw => String(raw == null ? '' : raw).trim().slice(0, 20);
    const FALLBACK_TAG = '其他';
    const SUGGEST_TAG_MAX_LEN = 12;
    const SUGGEST_TAGS_MAX = 3;
    const parseSuggestedTags = eval(`(${functionSource(libSource, 'parseSuggestedTags')})`);
    expect(parseSuggestedTags('["A","B","C","D","E"]')).toEqual(['A', 'B', 'C']);
  });
});

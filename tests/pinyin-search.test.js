import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('轻量中文拼音极速提取与搜索 (Pinyin Fast Search)', () => {
  let BMPinyin;

  beforeEach(async () => {
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue({})
        }
      }
    };
    await import('../js/lib.js');
    BMPinyin = globalThis.BMPinyin || globalThis.BM;
  });

  it('能准确提取常用汉字首字母简拼', () => {
    expect(BMPinyin.toPinyinInitials('哔哩哔哩')).toBe('blbl');
    expect(BMPinyin.toPinyinInitials('掘金')).toBe('jj');
    expect(BMPinyin.toPinyinInitials('知乎')).toBe('zh');
    expect(BMPinyin.toPinyinInitials('淘宝网')).toBe('tbw');
    expect(BMPinyin.toPinyinInitials('百度搜索')).toBe('bdss');
    expect(BMPinyin.toPinyinInitials('前端开发文档')).toBe('qdkfwd');
  });

  it('中英数字混合文本能平滑处理', () => {
    expect(BMPinyin.toPinyinInitials('React进阶指南')).toBe('reactjjzn');
    expect(BMPinyin.toPinyinInitials('Vue3源码解析')).toBe('vue3ymjx');
    expect(BMPinyin.toPinyinInitials('GitHub中文社区')).toBe('githubzwsq');
  });

  it('能提取常见核心词全拼', () => {
    const keywords = BMPinyin.toPinyinKeywords('哔哩哔哩动画');
    expect(keywords).toContain('bilibili');
    expect(keywords).toContain('blbldh');

    const juejinKw = BMPinyin.toPinyinKeywords('掘金技术社区');
    expect(juejinKw).toContain('juejin');
    expect(juejinKw).toContain('shequ');
  });
});

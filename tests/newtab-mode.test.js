import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const optionsHtml = readFileSync(join(__dirname, '..', 'options.html'), 'utf-8');
const optionsSource = readFileSync(join(__dirname, '..', 'js', 'options.js'), 'utf-8');
const newtabSource = readFileSync(join(__dirname, '..', 'js', 'newtab.js'), 'utf-8');
const newtabCss = readFileSync(join(__dirname, '..', 'css', 'newtab.css'), 'utf-8');

describe('新标签页接管模式控制 (NewTab Mode Control)', () => {
  it('设置页提供新标签页模式选择与跳转网址输入', () => {
    expect(optionsHtml).toContain('id="setNtMode"');
    expect(optionsHtml).toContain('value="full"');
    expect(optionsHtml).toContain('value="minimal"');
    expect(optionsHtml).toContain('value="disabled"');
    expect(optionsHtml).toContain('id="setNtRedirectUrl"');
  });

  it('设置页脚本正确回填与持久化模式与跳转网址', () => {
    expect(optionsSource).toContain("['full', 'minimal', 'disabled'].includes(raw.mode)");
    expect(optionsSource).toContain('redirectUrl');
    expect(optionsSource).toContain('#setNtMode');
    expect(optionsSource).toContain('#setNtRedirectUrl');
  });

  it('新标签页脚本支持秒级重定向关闭接管与极简模式样式注入', () => {
    expect(newtabSource).toContain("mode === 'disabled'");
    expect(newtabSource).toContain('window.location.replace');
    expect(newtabSource).toContain("classList.toggle('nt-minimal-mode', mode === 'minimal')");
  });

  it('新标签页样式支持极简模式居中展示搜索框', () => {
    expect(newtabCss).toContain('body.nt-minimal-mode #ntTags');
    expect(newtabCss).toContain('body.nt-minimal-mode #ntGrid');
    expect(newtabCss).toContain('display: none !important');
  });
});

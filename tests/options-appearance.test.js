/**
 * 设置页布局与「新标签页外观」回归
 *
 * 背景：
 * 1) 左侧分组导航原本跨满网格首行，把自己 200+px 的高度摊到首行上，
 *    使简介卡与首个分组之间出现上百像素的空白（实测 151px，正常应为 24px）。
 * 2) 「背景颜色」行用 hidden 控制显隐，但 .opt-card .form-row{display:flex} 盖掉了
 *    UA 的 [hidden]{display:none}，导致配色不是「自定义」时该行仍然显示；
 *    用户改完颜色后 bg 被 theme 忽略，表现为「设置背景色无效」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const optionsHtml = readFileSync(join(__dirname, '..', 'options.html'), 'utf-8');
const optionsSource = readFileSync(join(__dirname, '..', 'js', 'options.js'), 'utf-8');
const popupCss = readFileSync(join(__dirname, '..', 'css', 'popup.css'), 'utf-8');

describe('设置页分组布局', () => {
  it('右侧内容整列包在 .opt-main 中，导航不再与简介卡同行', () => {
    const wrapAt = optionsHtml.indexOf('<div class="opt-wrap">');
    const navAt = optionsHtml.indexOf('id="optNav"');
    const mainAt = optionsHtml.indexOf('<div class="opt-main">');
    expect(wrapAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(wrapAt);
    expect(mainAt).toBeGreaterThan(navAt);

    // 简介卡与全部设置分组都要落在 .opt-main 内
    const toastsAt = optionsHtml.indexOf('<div id="toasts">');
    expect(toastsAt).toBeGreaterThan(mainAt);
    const inside = optionsHtml.slice(mainAt, toastsAt);
    expect(inside).toContain('class="opt-hero"');
    for (const id of ['opt-ai', 'opt-tags', 'opt-browser', 'opt-appearance', 'opt-danger']) {
      expect(inside).toContain(`id="${id}"`);
    }
    // 导航不能落在 .opt-main 里，否则又会与简介卡同行
    expect(inside).not.toContain('id="optNav"');
  });

  it('宽屏下导航占第一列、内容占第二列', () => {
    expect(popupCss).toContain('.opt-main {');
    expect(popupCss).toContain('grid-column: 2;');
    expect(popupCss).toContain('grid-column: 1;');
    expect(popupCss).toContain('grid-template-columns: 200px minmax(0, 1fr);');
  });

  it('窄屏保持「简介卡在最上、导航下拉紧随其后」的阅读顺序', () => {
    expect(popupCss).toContain('display: contents;');
    expect(popupCss).toContain('order: -1;');
  });

  it('分组标题与问号之间只保留 gap，不再叠加 margin', () => {
    expect(popupCss).toContain('.opt-section-text h2 > .help-dot {');
    expect(popupCss).toContain('margin-left: 0;');
  });
});

describe('hidden 属性与背景色设置', () => {
  it('组件自身的 display 不能盖掉 [hidden]', () => {
    expect(popupCss).toContain('[hidden] {');
    expect(popupCss).toContain('display: none !important;');
  });

  it('取色、输入色值与重置默认色都会切到「自定义背景色」', () => {
    expect(optionsSource).toContain('const useCustomThemeForBg = () => {');
    expect(optionsSource).toContain("themeEl.value = 'custom';");
    const calls = optionsSource.match(/useCustomThemeForBg\(\);/g) || [];
    // 取色器、十六进制输入、重置按钮三处
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('背景色行的显隐仍由 theme === custom 驱动', () => {
    expect(optionsSource).toContain("function ntBgRowVisible(show) {");
    expect(optionsSource).toContain("ntBgRowVisible($('#setNtTheme').value === 'custom')");
  });
});

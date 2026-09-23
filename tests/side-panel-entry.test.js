/**
 * 侧边栏入口的注册与兜底回归
 *
 * 背景：侧边栏页面路径只由 manifest 的 side_panel.default_path 声明。扩展在
 * chrome://extensions 重新加载（或更新）后 Chrome 会丢掉这份注册并销毁面板已加载的
 * web contents，此后 chrome.sidePanel.open() 只露出一个空白面板——面板页面从未被加载，
 * 面板内部的看门狗与错误卡都没有机会运行，用户看到的就是「白屏」（连顶栏都不存在）。
 *
 * 本文件锁定三处防护：
 * 1) SW 启动与 onInstalled 显式写回面板路径；
 * 2) 新标签页入口在 open() 之前、且在手势同步栈内写回路径（不 await）；
 * 3) 打开失败时以标签页打开管理界面，并锁定代码里的路径与 manifest 不漂移。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
const backgroundSource = readFileSync(join(root, 'js', 'background.js'), 'utf-8');
const newtabSource = readFileSync(join(root, 'js', 'newtab.js'), 'utf-8');
const newtabHtml = readFileSync(join(root, 'newtab.html'), 'utf-8');
const newtabCss = readFileSync(join(root, 'css', 'newtab.css'), 'utf-8');

// 按缩进取完整函数体（源码为 CRLF，收尾行形如 "\r\n  }\r\n"），避免把函数外的代码带进来
function bodyOf(source, signature, indent = '  ') {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`未找到源码片段：${signature}`);
  const rest = source.slice(start);
  const end = new RegExp(`\\r?\\n${indent}\\}\\r?\\n`).exec(rest);
  if (!end) throw new Error(`未找到函数收尾：${signature}`);
  return rest.slice(0, end.index + end[0].length);
}

const openPanelBody = bodyOf(newtabSource, 'async function openPanel()');
const ensureBody = bodyOf(newtabSource, 'function ensurePanelRegistration()');
const openTabBody = bodyOf(newtabSource, 'function openManagerTab()');
const registerBody = bodyOf(backgroundSource, 'function registerSidePanel()', '');

describe('侧边栏路径注册（重载/更新后不再空白）', () => {
  it('manifest 仍声明侧边栏默认页面', () => {
    expect(manifest.side_panel && manifest.side_panel.default_path).toBeTruthy();
  });

  it('代码里的面板路径与 manifest 不漂移', () => {
    const manifestPath = manifest.side_panel.default_path;
    const backgroundPath = (backgroundSource.match(/const SIDE_PANEL_PATH = '([^']+)'/) || [])[1];
    const newtabPath = (newtabSource.match(/const PANEL_PATH = '([^']+)'/) || [])[1];
    expect(backgroundPath).toBe(manifestPath);
    expect(newtabPath).toBe(manifestPath);
  });

  it('后台在 SW 启动时写回面板路径，并兼容缺少 setOptions 的环境', () => {
    expect(registerBody).toContain('function registerSidePanel()');
    expect(registerBody).toContain("typeof chrome.sidePanel.setOptions !== 'function'");
    expect(registerBody).toContain('.setOptions({ path: SIDE_PANEL_PATH, enabled: true })');
    expect(registerBody).toContain('.catch(');
    // 顶层调用（SW 每次启动都会跑到）+ onInstalled 里的补写，共两处
    const registerCalls = backgroundSource.match(/registerSidePanel\(\);/g) || [];
    expect(registerCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('onInstalled 里补写路径（重新加载 / 更新扩展的时机）', () => {
    const installed = bodyOf(backgroundSource, 'chrome.runtime.onInstalled.addListener(', '');
    expect(installed).toContain('registerSidePanel();');
  });

  it('入口在 open() 之前写回路径，且不 await（await 会断掉用户手势链）', () => {
    const ensureIdx = openPanelBody.indexOf('ensurePanelRegistration();');
    const openIdx = openPanelBody.indexOf('chrome.sidePanel.open(');
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(-1);
    expect(ensureIdx).toBeLessThan(openIdx);
    // setOptions 的调用不得被 await：open() 否则会以「只能在用户操作中调用」被拒
    expect(ensureBody).not.toMatch(/await\s+[A-Za-z_$]/);
    expect(openPanelBody).not.toContain('await chrome.sidePanel.setOptions');
    // 打开后对可能已存在的空白面板再指认一次路径
    const secondEnsure = openPanelBody.indexOf('ensurePanelRegistration();', ensureIdx + 1);
    expect(secondEnsure).toBeGreaterThan(openIdx);
  });
});

describe('兜底入口（不经过侧边栏）', () => {
  it('打开失败时降级为标签页打开管理界面', () => {
    expect(openPanelBody).toContain('openManagerTab();');
    expect(openTabBody).toContain('chrome.tabs.create({ url })');
    expect(openTabBody).toContain("window.open(url, '_blank', 'noopener')");
    expect(openTabBody).toContain('chrome.runtime.getURL(PANEL_PATH)');
  });

  it('新标签页顶栏提供常驻的「标签页打开」入口并已绑定', () => {
    expect(newtabHtml).toContain('id="ntOpenInTab"');
    expect(newtabHtml).toContain('class="nt-tab-open"');
    expect(newtabSource).toContain("$('#ntOpenInTab')?.addEventListener('click', openManagerTab)");
    expect(newtabCss).toContain('.nt-tab-open {');
  });

  it('窄屏下「打开管理面板」收成纯图标，不再把顶栏撑成两行', () => {
    expect(newtabHtml).toContain('<span class="nt-panel-label">打开管理面板</span>');
    expect(newtabCss).toContain('.nt-panel-btn {');
    // 规则必须落在窄屏媒体查询里，宽屏保持「图标 + 文字」
    const narrow = newtabCss.slice(newtabCss.indexOf('@media (max-width: 560px)'));
    expect(narrow).toContain('.nt-panel-btn .nt-panel-label');
    expect(narrow).toContain('display: none');
  });
});

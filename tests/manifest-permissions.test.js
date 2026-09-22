/**
 * 扩展权限与「新增当前页」回归
 *
 * 背景：popup.js 的「新增书签」会读 chrome.tabs.query 返回的 tab.url 来预填当前页。
 * 没有 tabs / activeTab 时 Chrome 不会返回 url，功能会静默退化成空表单。
 * 这里锁定：只申请不会产生安装警告的 activeTab（点击扩展图标打开侧边栏时临时授权），
 * 绝不用 tabs（会带来"读取您的浏览历史记录"警告，更新时还会禁用扩展直到用户重新同意）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf-8'));
const popupSource = readFileSync(join(__dirname, '..', 'js', 'popup.js'), 'utf-8');

describe('扩展权限', () => {
  it('申请 activeTab 以便读取当前页地址（无安装警告）', () => {
    expect(manifest.permissions).toContain('activeTab');
  });

  it('不申请 tabs：那会带来浏览历史警告，并在扩展更新时被禁用等待用户重新同意', () => {
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('保留核心权限（书签、存储、侧边栏、图标）', () => {
    for (const permission of ['bookmarks', 'storage', 'alarms', 'favicon', 'sidePanel']) {
      expect(manifest.permissions).toContain(permission);
    }
  });
});

describe('新增当前页', () => {
  it('拿不到地址与「当前页不是网页」分开提示', () => {
    expect(popupSource).toContain('未能读取当前页地址，请在表单里粘贴网址');
    expect(popupSource).toContain('当前页不是普通网页（比如浏览器设置页），无法收藏');
    expect(popupSource).toContain('没有找到当前标签页，请在表单里手动填写');
  });

  it('读取不到 url 时回退到可手动填写的空表单', () => {
    const start = popupSource.indexOf('async function openAddDrawerForCurrentTab()');
    const body = popupSource.slice(start, start + 2200);
    expect(body).toContain("typeof tab.url === 'string' ? tab.url : ''");
    expect(body).toContain('openAddDrawer();');
  });
});

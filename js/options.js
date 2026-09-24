// ===== 书签管家 · 选项页设置逻辑 (options.js) =====
// 独立窗口：不因 popup 失焦关闭；修改即实时保存到 chrome.storage.local。
'use strict';

// 服务商预设统一来自 lib.js（DRY，与 popup.js 共享同一份配置）
const PROVIDERS = (typeof BM !== 'undefined' && BM.PROVIDERS) || {};

const $ = sel => document.querySelector(sel);

function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(null, args), wait);
  };
}
// 敏感/文本配置输入防抖保存，避免每敲一键就写 storage / 触发主页面刷新
const queuePersist = debounce(() => {
  persist();
}, 600);
const LLM_PROFILES_KEY = 'bmLlmProfiles';
const ACTIVE_LLM_PROFILE_KEY = 'bmActiveLlmProfileId';
// 新标签页外观（宽度 / 配色 / 自定义背景色）
const NT_APPEARANCE_KEY = 'bmNewtabAppearance';
const NT_WIDTH_OPTIONS = ['1080', '1440', '1720', '2560', 'auto'];
const NT_THEME_OPTIONS = ['auto', 'light', 'dark', 'custom'];
const NT_DEFAULT_BG = '#0f1117';
let llmProfiles = [];
let activeLlmProfileId = '';
let nextProfileId = 0;
let profileWriteQueue = Promise.resolve();
const pendingOwnProfileWrites = [];
let tagSyncPersistIntent = 0;
let tagSyncRequest = null;
let completedTagSyncRequestId = '';
let pendingTagSyncRequestId = '';
let pendingTagSyncTarget = true;
let tagSyncStatus = null;
let tagSyncEnabledVersion = 0;
let tagConfigurationEditVersion = 0;
let pendingTagConfigurationSaveCount = 0;
let modelFetchIntent = 0;
// 模型下拉（自定义 combobox）：按 (provider|baseUrl|apiKey) 会话内缓存已拉取模型列表
const modelListCache = new Map();
let modelComboOpen = false;
let modelComboActiveIndex = -1;
let modelAutoFetchTimer = null;

function setMsg(text, cls, autohide) {
  const el = $('#settingsMsg');
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
  if (autohide !== false) {
    setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 2600);
  }
}

function setFtMsg(text, cls) {
  const el = $('#fixedTagsMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function setTrMsg(text, cls) {
  const el = $('#tagRulesMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function setNtMsg(text, cls) {
  const el = $('#ntAppearMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function setDangerMsg(text, cls) {
  const el = $('#dangerMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function setBackupMsg(text, cls) {
  const el = $('#backupMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function setTrashMsg(text, cls) {
  const el = $('#trashMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
}

function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const wrap = $('#confirmWrap');
    if (!wrap) {
      resolve(false);
      return;
    }
    const restoreFocusTo = document.activeElement;
    const yes = $('#confirmYes');
    const no = $('#confirmNo');
    const third = $('#confirmThird');
    let releaseTrap = null;
    let settled = false;
    $('#confirmTitle').textContent = opts.title || '确认操作？';
    $('#confirmMsg').innerHTML = opts.message || '';
    yes.textContent = opts.confirmText || '确认';
    yes.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
    if (opts.thirdText) {
      third.textContent = opts.thirdText;
      third.classList.remove('hidden');
    } else {
      third.classList.add('hidden');
    }
    const done = value => {
      if (settled) return;
      settled = true;
      wrap.classList.add('hidden');
      yes.onclick = no.onclick = third.onclick = null;
      wrap.removeEventListener('click', onWrapClick);
      wrap.removeEventListener('keydown', onKey);
      if (typeof releaseTrap === 'function') releaseTrap();
      else if (restoreFocusTo && document.contains(restoreFocusTo)) restoreFocusTo.focus();
      resolve(value);
    };
    const onWrapClick = event => {
      if (event.target === wrap) done(false);
    };
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        done(false);
      } else if (
        event.key === 'Enter' &&
        !(event.target.closest && event.target.closest('button'))
      ) {
        done(true);
      }
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    third.onclick = () => done('third');
    wrap.addEventListener('click', onWrapClick);
    wrap.addEventListener('keydown', onKey);
    wrap.classList.remove('hidden');
    if (window.UI && typeof UI.focusTrap === 'function') {
      releaseTrap = UI.focusTrap(wrap, {
        onEscape: () => done(false),
        autofocus: false,
        restoreFocusTo
      });
    }
    yes.focus();
  });
}

// 保存反馈统一（P2-3-4）：成功提示走全局 toast，内联 settings-msg 只保留错误 / 校验文案。
function notifySaved(message, level) {
  if (window.UI && typeof UI.toast === 'function') UI.toast(message, level || 'ok');
  else setMsg(message, level === 'danger' ? 'err' : 'ok');
}

// ---- 新标签页外观：表单 ↔ 存储 ----
function ntBgRowVisible(show) {
  const row = $('#ntBgRow');
  if (row) row.hidden = !show;
}

function fillNtAppearance(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const widthEl = $('#setNtWidth');
  if (widthEl) widthEl.value = NT_WIDTH_OPTIONS.indexOf(raw.width) >= 0 ? raw.width : '1080';
  const themeEl = $('#setNtTheme');
  if (themeEl) themeEl.value = NT_THEME_OPTIONS.indexOf(raw.theme) >= 0 ? raw.theme : 'auto';
  const bg = /^#[0-9a-fA-F]{6}$/.test(String(raw.bg || ''))
    ? String(raw.bg).toLowerCase()
    : NT_DEFAULT_BG;
  const colorEl = $('#setNtBg');
  const hexEl = $('#setNtBgHex');
  if (colorEl) colorEl.value = bg;
  if (hexEl) hexEl.value = bg;
  ntBgRowVisible(themeEl ? themeEl.value === 'custom' : false);
}

function ntAppearanceValue() {
  const hex = $('#setNtBgHex').value.trim();
  return {
    width: $('#setNtWidth').value,
    theme: $('#setNtTheme').value,
    bg: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : NT_DEFAULT_BG
  };
}

async function persistNtAppearance(msg) {
  try {
    await chrome.storage.local.set({ [NT_APPEARANCE_KEY]: ntAppearanceValue() });
    if (msg) notifySaved(msg);
    renderSectionStatuses();
  } catch (e) {
    setNtMsg('保存失败：' + (e.message || e), 'err');
  }
}

function renderTagSyncStatus(status) {
  const msg = $('#tagSyncMsg');
  if (!msg) return;
  const progress = $('#tagSyncProgress');
  const progressTrack = progress && progress.querySelector('.tag-sync-progress-track');
  const progressBar = $('#tagSyncProgressBar');
  const progressText = $('#tagSyncProgressText');
  const setProgress = (step, total, text) => {
    if (!progress) return;
    const maximum = Math.max(1, Number(total) || 5);
    const current = Math.max(0, Math.min(maximum, Number(step) || 0));
    progress.hidden = false;
    if (progressTrack) {
      progressTrack.setAttribute('aria-valuemax', String(maximum));
      progressTrack.setAttribute('aria-valuenow', String(current));
    }
    if (progressBar) progressBar.style.width = (current / maximum) * 100 + '%';
    if (progressText) progressText.textContent = text || '初始化 ' + current + '/' + maximum;
  };
  const clearProgress = () => {
    if (progress) progress.hidden = true;
  };
  const statusProgress = (fallbackStep, fallbackText) => {
    const phaseLabels = {
      queued: '请求已保存，正在启动同步服务',
      'reading-bookmarks': '正在读取本机书签',
      'creating-directory': '正在创建同步目录',
      'checking-remote-data': '同步目录已发现，正在读取已有数据',
      'preparing-local-data': '同步目录已创建，正在整理标签数据',
      'writing-sync-data': '正在写入同步数据',
      'waiting-for-data': '同步目录正在等待设备写入标签数据'
    };
    const step = Number(status && status.step) || fallbackStep;
    const total = Number(status && status.totalSteps) || 5;
    const text = (status && status.detail) || phaseLabels[status && status.phase] || fallbackText;
    setProgress(step, total, text);
    return text;
  };
  const pendingRequestId =
    typeof pendingTagSyncRequestId === 'string' ? pendingTagSyncRequestId : '';
  const pendingTarget = typeof pendingTagSyncTarget === 'boolean' ? pendingTagSyncTarget : true;
  const isCurrentPendingStatus =
    !pendingRequestId || (status && status.requestId === pendingRequestId);
  if (status && status.lastError && isCurrentPendingStatus) {
    clearProgress();
    msg.textContent = '上次同步失败：' + status.lastError;
    msg.className = 'settings-msg err';
    return;
  }
  if (pendingRequestId && !isCurrentPendingStatus) {
    setProgress(
      1,
      5,
      pendingTarget === false ? '正在启动关闭同步任务' : '请求已保存，正在启动同步服务'
    );
    msg.textContent =
      pendingTarget === false
        ? '正在关闭同步：后台将停止读写同步目录'
        : '已开启：正在初始化同步目录';
    msg.className = 'settings-msg';
    return;
  }
  if (status && status.lastError) {
    clearProgress();
    msg.textContent = '上次同步失败：' + status.lastError;
    msg.className = 'settings-msg err';
    return;
  }
  if (status && status.waitingForData) {
    const count = Number(status.waitingDeviceCount) || 0;
    msg.textContent = count
      ? '同步目录正在等待 ' + count + ' 台设备写入标签数据'
      : '同步目录正在等待设备写入标签数据';
    // 空设备目录尚无可读取的数据，不能伪装成同步已完成。
    clearProgress();
    msg.className = 'settings-msg';
    return;
  }
  if (status && status.pending) {
    const text = statusProgress(
      1,
      status.target === false
        ? '正在关闭同步：后台将停止读写同步目录'
        : '已开启：正在初始化同步目录'
    );
    msg.textContent =
      status.target === false ? '正在关闭同步：后台将停止读写同步目录' : '已开启：' + text;
    msg.className = 'settings-msg';
    return;
  }
  if (status && status.disabled) {
    clearProgress();
    msg.textContent = '已关闭：不再读写同步目录；已有数据保留，随时可重新开启';
    msg.className = 'settings-msg';
    return;
  }
  if (status && status.lastSuccessAt) {
    clearProgress();
    msg.textContent = '上次同步成功：' + new Date(status.lastSuccessAt).toLocaleString();
    msg.className = 'settings-msg ok';
    return;
  }
  clearProgress();
  msg.textContent = '';
  msg.className = 'settings-msg';
}

function updateTagSyncRequestState(request, completedId) {
  tagSyncRequest = request && typeof request === 'object' ? request : null;
  completedTagSyncRequestId = String(completedId || '');
  if (!tagSyncRequest || !tagSyncRequest.id || tagSyncRequest.id === completedTagSyncRequestId) {
    pendingTagSyncRequestId = '';
    return;
  }
  pendingTagSyncRequestId = String(tagSyncRequest.id);
  pendingTagSyncTarget = tagSyncRequest.target !== false;
}

function renderTagSyncDiagnostics() {
  const el = $('#tagSyncSummary');
  if (!el) return;
  el.textContent = '使用 Chrome 书签同步；无需相同扩展 ID';
}

// ---- 固定标签池：textarea ↔ 数组转换（每行一个，忽略 # 注释）----
function parseFixedTags(text) {
  return [
    ...new Set(
      String(text || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
    )
  ];
}

// 每行 `关键字=标签1,标签2`；忽略空行和 # 注释。
function parseTagRuleMap(text) {
  const entries = [];
  String(text || '')
    .split('\n')
    .forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq <= 0) return;
      const key = line.slice(0, eq).trim();
      const tags = [
        ...new Set(
          line
            .slice(eq + 1)
            .split(/[,，、;；]/)
            .map(tag => tag.trim())
            .filter(Boolean)
        )
      ];
      if (key && tags.length) entries.push([key, tags]);
    });
  return Object.fromEntries(entries);
}

function parseTagRules(domainText, keywordText) {
  return { domain: parseTagRuleMap(domainText), keyword: parseTagRuleMap(keywordText) };
}

function serializeTagRuleMap(map) {
  return Object.entries(map || {})
    .map(([key, tags]) => {
      const values = Array.isArray(tags) ? tags : [tags];
      return key + '=' + values.join(',');
    })
    .join('\n');
}

function createProfileId() {
  nextProfileId++;
  return 'llm-' + Date.now().toString(36) + '-' + nextProfileId;
}

function normalizeLlmSettings(raw) {
  raw = raw || {};
  const provider = PROVIDERS[raw.provider] ? raw.provider : 'deepseek';
  const preset = PROVIDERS[provider] || {};
  return {
    provider,
    baseUrl: String(raw.baseUrl || preset.base || '').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    model: String(raw.model || '').trim()
  };
}

function defaultProfileName(settings) {
  const provider = settings.provider === 'custom' ? '自定义' : settings.provider.toUpperCase();
  return settings.model ? provider + ' · ' + settings.model : provider;
}

function createProfile(raw, fallbackName) {
  const settings = normalizeLlmSettings(raw);
  return {
    id: String((raw && raw.id) || createProfileId()),
    name: String((raw && raw.name) || '').trim() || fallbackName || defaultProfileName(settings),
    ...settings,
    updatedAt: Number(raw && raw.updatedAt) || Date.now()
  };
}

function normalizeLlmProfiles(rawProfiles, legacySettings) {
  const raw = Array.isArray(rawProfiles)
    ? rawProfiles.filter(item => item && typeof item === 'object')
    : [];
  const source = raw.length ? raw : [legacySettings || {}];
  const usedIds = new Set();
  return source.map((item, index) => {
    const profile = createProfile(item, raw.length ? '' : '默认配置');
    while (usedIds.has(profile.id)) profile.id = profile.id + '-' + index;
    usedIds.add(profile.id);
    return profile;
  });
}

function activeLlmProfile() {
  return llmProfiles.find(profile => profile.id === activeLlmProfileId) || llmProfiles[0] || null;
}

function profileSettings(profile) {
  return normalizeLlmSettings(profile || {});
}

function cloneStoredValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameStoredValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removePendingProfileWrite(marker) {
  const index = pendingOwnProfileWrites.indexOf(marker);
  if (index >= 0) pendingOwnProfileWrites.splice(index, 1);
}

function consumeOwnProfileWrite(changes) {
  const index = pendingOwnProfileWrites.findIndex(
    marker =>
      (!changes[LLM_PROFILES_KEY] ||
        sameStoredValue(marker.profiles, changes[LLM_PROFILES_KEY].newValue)) &&
      (!changes[ACTIVE_LLM_PROFILE_KEY] ||
        marker.activeId === changes[ACTIVE_LLM_PROFILE_KEY].newValue) &&
      (!changes.bmSettings || sameStoredValue(marker.settings, changes.bmSettings.newValue))
  );
  if (index < 0) return false;
  pendingOwnProfileWrites.splice(index, 1);
  return true;
}

function queueProfileWrite(values) {
  const payload = cloneStoredValue(values);
  profileWriteQueue = profileWriteQueue
    .catch(() => {})
    .then(async () => {
      const marker = {
        profiles: payload[LLM_PROFILES_KEY],
        activeId: payload[ACTIVE_LLM_PROFILE_KEY],
        settings: payload.bmSettings
      };
      pendingOwnProfileWrites.push(marker);
      try {
        await chrome.storage.local.set(payload);
        // 少数浏览器版本不会为同值写入触发 onChanged，超时后释放标记。
        setTimeout(() => removePendingProfileWrite(marker), 10000);
      } catch (e) {
        removePendingProfileWrite(marker);
        throw e;
      }
    });
  return profileWriteQueue;
}

function formSettings() {
  return {
    provider: $('#setProvider').value,
    baseUrl: $('#setBase').value.trim(),
    apiKey: $('#setKey').value.trim(),
    model: $('#setModel').value.trim()
  };
}

function renderProfileSelect() {
  const select = $('#setProfile');
  if (!select) return;
  select.replaceChildren();
  llmProfiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  });
  select.value = activeLlmProfileId;
}

async function persistProfileState(settings) {
  await queueProfileWrite({
    [LLM_PROFILES_KEY]: llmProfiles,
    [ACTIVE_LLM_PROFILE_KEY]: activeLlmProfileId,
    // popup 与 AI 调用仍只读取活动配置，保持既有调用链兼容。
    bmSettings: normalizeLlmSettings(settings || profileSettings(activeLlmProfile()))
  });
}

function updateActiveProfileFromForm() {
  const current = activeLlmProfile();
  if (!current) return null;
  const settings = normalizeLlmSettings(formSettings());
  const profile = {
    ...current,
    ...settings,
    name: $('#setProfileName').value.trim() || defaultProfileName(settings),
    updatedAt: Date.now()
  };
  llmProfiles = llmProfiles.map(item => (item.id === profile.id ? profile : item));
  return profile;
}

function mergeActiveLlmSettings(settings) {
  const current = activeLlmProfile();
  if (!current) return null;
  const profile = {
    ...current,
    ...profileSettings(settings),
    updatedAt: Date.now()
  };
  llmProfiles = llmProfiles.map(item => (item.id === profile.id ? profile : item));
  return profile;
}

// 选中服务商时，仅带出预设 Base URL；模型由用户明确选择或手动填写。
function applyProviderPreset() {
  const p = PROVIDERS[$('#setProvider').value];
  if (!p) return;
  if (!$('#setBase').value.trim()) $('#setBase').value = p.base || '';
}

// 实时保存（静默，不弹提示）
async function persistSilent() {
  const profile = updateActiveProfileFromForm();
  if (!profile) return;
  try {
    await queueProfileWrite({
      [LLM_PROFILES_KEY]: llmProfiles,
      [ACTIVE_LLM_PROFILE_KEY]: activeLlmProfileId,
      bmSettings: profileSettings(profile)
    });
    renderSectionStatuses();
  } catch (e) {
    console.warn('[书签管家] 保存设置失败', e);
  }
}

// 实时保存（带提示）
async function persist() {
  let permissionError = null;
  try {
    await ensureBackgroundAiPermission(formSettings());
  } catch (e) {
    permissionError = e;
    const autoAi = $('#setAutoAiTag');
    if (autoAi) autoAi.checked = false;
    await chrome.storage.local.set({ bmAutoAiTag: false });
  }
  await persistSilent();
  if (permissionError) {
    setMsg(
      '配置已保存；但新域名还没有授权访问，已暂时关闭「后台 AI 补充标签」：' +
        (permissionError.message || permissionError),
      'err',
      false
    );
  } else {
    setMsg('', '');
    notifySaved('AI 配置已保存');
  }
}

async function saveWithLlmPermission() {
  const cfg = formSettings();
  try {
    if (cfg.baseUrl) await BM.requestLlmHostPermission(cfg.baseUrl);
    await persist();
  } catch (e) {
    setMsg('保存失败：' + (e.message || e), 'err', false);
  }
}

async function persistFixedTags() {
  const tags = parseFixedTags($('#setFixedTags').value);
  const rules = parseTagRules($('#setDomainTagRules').value, $('#setKeywordTagRules').value);
  const max = (typeof BM !== 'undefined' && BM.MAX_FIXED_TAGS) || 50;
  tagConfigurationEditVersion++;
  pendingTagConfigurationSaveCount++;
  try {
    await BM.saveSyncedTagConfiguration(tags, rules);
    notifySaved(
      '标签池已更新：' +
        tags.length +
        ' 个标签' +
        (tags.length > max ? '（超出上限 ' + max + '，超出部分不会参与 AI 打标）' : ''),
      tags.length > max ? 'warn' : 'ok'
    );
    renderSectionStatuses();
  } catch (e) {
    setFtMsg('保存失败：' + (e.message || e), 'err');
  } finally {
    pendingTagConfigurationSaveCount--;
  }
}

async function persistTagRules() {
  const tags = parseFixedTags($('#setFixedTags').value);
  const rules = parseTagRules($('#setDomainTagRules').value, $('#setKeywordTagRules').value);
  const count = Object.keys(rules.domain).length + Object.keys(rules.keyword).length;
  tagConfigurationEditVersion++;
  pendingTagConfigurationSaveCount++;
  try {
    await BM.saveSyncedTagConfiguration(tags, rules);
    notifySaved('自定义规则已保存：' + count + ' 条');
    renderSectionStatuses();
  } catch (e) {
    setTrMsg('保存失败：' + (e.message || e), 'err');
  } finally {
    pendingTagConfigurationSaveCount--;
  }
}

// 转义后放进 confirmDialog 的 innerHTML（AI 返回的标签内容不可信）
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 用 AI 根据当前所有书签初始化标签池：本地先按站点聚合样本（不发全量书签，高敏书签跳过），
// 再让 AI 归纳分类，结果先预览，由用户决定覆盖标签池还是并入现有池。
async function aiInitFixedTags() {
  const btn = $('#aiInitFixedTags');
  if (!btn || btn.disabled) return;
  const cfg = {
    provider: $('#setProvider') ? $('#setProvider').value : 'deepseek',
    baseUrl: $('#setBase').value.trim(),
    apiKey: $('#setKey').value.trim(),
    model: $('#setModel').value.trim()
  };
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    setFtMsg('先在上面填好 AI 服务的接口地址、API Key 和模型名，再回来初始化标签池', 'err');
    jumpToSection('opt-ai', true);
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  try {
    btn.textContent = '读取书签…';
    setFtMsg('', '');
    const { samples, total, skippedSensitive, sites } = await BM.collectAiTagSamples();
    if (!samples.length) {
      setFtMsg('没有可用于归纳的书签样本', 'err');
      return;
    }
    const ok = await confirmDialog({
      title: '用 AI 初始化标签池',
      message:
        `已读取 <b>${total}</b> 个书签，聚合为 <b>${sites}</b> 个站点，将把书签最多的 <b>${samples.length}</b> 个站点的域名与标题样本发送给 AI` +
        (skippedSensitive
          ? `；另有 <b>${skippedSensitive}</b> 个高敏书签（登录 / 金融等）已排除，不会发送`
          : '') +
        '。',
      confirmText: '开始生成',
      danger: false
    });
    if (!ok) return;
    btn.textContent = 'AI 归纳中…';
    await BM.requestLlmHostPermission(cfg.baseUrl);
    const suggested = await BM.suggestFixedTags(samples, cfg);
    if (!suggested.length) {
      setFtMsg('AI 没有返回可用的标签，请重试或换一个模型', 'err');
      return;
    }
    const existing = parseFixedTags($('#setFixedTags').value);
    const merged = [...new Set([...existing, ...suggested])];
    const cap = (typeof BM !== 'undefined' && BM.MAX_FIXED_TAGS) || 50;
    const choice = await confirmDialog({
      title: 'AI 生成的标签池',
      message:
        `AI 归纳出 <b>${suggested.length}</b> 个标签：<br>${escapeText(suggested.join('、'))}<br><br>` +
        `现有标签池 <b>${existing.length}</b> 个；覆盖后 <b>${suggested.length}</b> 个，并入后 <b>${merged.length}</b> 个（上限 ${cap}）。<br>` +
        '标签池变化不会自动改写历史书签的标签，之后可在面板点「立即收敛」或重新打标。',
      confirmText: '覆盖标签池',
      thirdText: '并入现有池',
      danger: false
    });
    if (!choice) return;
    const next = choice === 'third' ? merged : suggested;
    $('#setFixedTags').value = next.join('\n');
    await persistFixedTags();
    setFtMsg(
      `已写入 ${next.length} 个标签（${choice === 'third' ? '并入现有池' : '覆盖标签池'}）`,
      'ok'
    );
  } catch (e) {
    setFtMsg('AI 初始化失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// 用活动配置填充表单（provider 缺失时回退 DeepSeek 预设）
function fillForm(profile) {
  modelFetchIntent++;
  const modelsBtn = $('#modelsFetch');
  if (modelsBtn) {
    modelsBtn.disabled = false;
    modelsBtn.textContent = '获取模型列表';
  }
  const settings = profileSettings(profile);
  $('#setProfileName').value = (profile && profile.name) || defaultProfileName(settings);
  $('#setProvider').value = settings.provider;
  $('#setBase').value = settings.baseUrl;
  $('#setModel').value = settings.model;
  // 模型列表缓存按 (provider|baseUrl|apiKey) 隔离：确保当前模型出现在候选里，
  // 但不覆盖已拉取的远端列表（切换配置后旧列表不再适用）。
  const key = modelListKey(settings);
  if (!modelListCache.has(key)) modelListCache.set(key, []);
  const cached = modelListCache.get(key);
  if (settings.model && !cached.includes(settings.model)) cached.push(settings.model);
  // 已加载过模型列表的配置切换为「仅选择」模式；未加载的允许手动输入
  setModelReadonly(cached.length > 0);
  closeModelList();
  $('#setKey').value = settings.apiKey;
  const modelsMsg = $('#modelsMsg');
  if (modelsMsg) {
    modelsMsg.textContent = '';
    modelsMsg.className = 'settings-msg';
  }
}

async function ensureBackgroundAiPermission(settings) {
  const stored = await chrome.storage.local.get('bmAutoAiTag');
  if (stored.bmAutoAiTag !== true) return;
  if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model) return;
  if (BM.hasLlmHostPermission && (await BM.hasLlmHostPermission(settings.baseUrl))) return;
  await BM.requestLlmHostPermission(settings.baseUrl);
}

async function commitActiveProfileState(nextProfiles, nextActiveId) {
  const previousProfiles = llmProfiles;
  const previousActiveId = activeLlmProfileId;
  const nextProfile = nextProfiles.find(profile => profile.id === nextActiveId);
  if (!nextProfile) throw new Error('目标 LLM 配置不存在');
  try {
    await ensureBackgroundAiPermission(profileSettings(nextProfile));
    llmProfiles = nextProfiles;
    activeLlmProfileId = nextActiveId;
    renderProfileSelect();
    fillForm(nextProfile);
    await persistProfileState(profileSettings(nextProfile));
    return nextProfile;
  } catch (e) {
    llmProfiles = previousProfiles;
    activeLlmProfileId = previousActiveId;
    renderProfileSelect();
    fillForm(activeLlmProfile());
    throw e;
  }
}

async function switchLlmProfile(profileId) {
  const profile = llmProfiles.find(item => item.id === profileId);
  if (!profile || profile.id === activeLlmProfileId) return;
  try {
    await commitActiveProfileState(llmProfiles, profile.id);
    notifySaved('已切换到「' + profile.name + '」');
    renderSectionStatuses();
  } catch (e) {
    setMsg('切换失败：' + (e.message || e), 'err');
  }
}

async function createLlmProfile() {
  const settings = normalizeLlmSettings({ provider: 'deepseek' });
  const profile = createProfile({ ...settings, name: '新配置 ' + (llmProfiles.length + 1) });
  try {
    await commitActiveProfileState([...llmProfiles, profile], profile.id);
    $('#setProfileName').focus();
    $('#setProfileName').select();
    notifySaved('已新建配置，可填写后自动保存');
    renderSectionStatuses();
  } catch (e) {
    setMsg('新建失败：' + (e.message || e), 'err');
  }
}

async function deleteActiveLlmProfile() {
  const profile = activeLlmProfile();
  if (!profile) return;
  const confirmed = await confirmDialog({
    title: '删除配置「' + profile.name + '」？',
    message: '该配置的接口地址、API Key 与模型名将一并移除，<b>无法恢复</b>。',
    confirmText: '删除配置'
  });
  if (!confirmed) return;
  const currentIndex = llmProfiles.findIndex(item => item.id === profile.id);
  const remaining = llmProfiles.filter(item => item.id !== profile.id);
  if (!remaining.length) {
    remaining.push(createProfile({ provider: 'deepseek', name: '默认配置' }));
  }
  const next = remaining[Math.max(0, Math.min(currentIndex, remaining.length - 1))];
  try {
    await commitActiveProfileState(remaining, next.id);
    setDangerMsg('', '');
    notifySaved('已删除配置', 'warn');
    renderSectionStatuses();
  } catch (e) {
    setDangerMsg('删除失败：' + (e.message || e), 'err');
  }
}

async function exportBackup() {
  try {
    const result = await BM.exportBookmarksJSON();
    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bookmark-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notifySaved('已导出 ' + result.count + ' 个书签备份 ✓');
    setBackupMsg('', '');
  } catch (e) {
    setBackupMsg('导出失败：' + (e.message || e), 'err');
    try {
      BM.logError('backup-export', e);
    } catch (ignored) {
      /* ignore */
    }
  }
}

let backupFileInput = null;
function ensureBackupInput() {
  if (backupFileInput) return backupFileInput;
  backupFileInput = document.createElement('input');
  backupFileInput.type = 'file';
  backupFileInput.accept = 'application/json,.json';
  backupFileInput.hidden = true;
  document.body.appendChild(backupFileInput);
  backupFileInput.addEventListener('change', async () => {
    const file = backupFileInput.files && backupFileInput.files[0];
    backupFileInput.value = '';
    if (!file) return;
    const button = $('#backupImport');
    if (button) button.disabled = true;
    try {
      const json = await file.text();
      const stats = await BM.importBookmarksJSON(json, { dryRun: true });
      const choice = await confirmDialog({
        title: '恢复书签备份？',
        message:
          `备份将新增 <b>${stats.folders}</b> 个文件夹、<b>${stats.bookmarks}</b> 个书签` +
          (stats.merged ? `，合并 <b>${stats.merged}</b> 个相同网址书签及其标签` : '') +
          (stats.skipped ? `（跳过 ${stats.skipped} 个）` : '') +
          '。顶级同名文件夹会自动复用。',
        confirmText: stats.merged ? '合并并恢复' : '开始恢复',
        thirdText: stats.merged ? '保留副本' : '',
        danger: false
      });
      if (!choice) return;
      const result = await BM.importBookmarksJSON(json, {
        dryRun: false,
        keepDuplicates: choice === 'third'
      });
      notifySaved(
        `恢复完成：新增 ${result.bookmarks} 个书签、${result.folders} 个文件夹` +
          (result.merged ? `，合并 ${result.merged} 个相同网址书签` : '') +
          ' ✓'
      );
      setBackupMsg('', '');
    } catch (e) {
      setBackupMsg('恢复失败：' + (e.message || e), 'err');
      try {
        BM.logError('backup-import', e);
      } catch (ignored) {
        /* ignore */
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
  return backupFileInput;
}

async function clearTrash() {
  const records = (await BM.getTrash()) || [];
  if (!records.length) {
    setTrashMsg('回收站已经是空的。', '');
    return;
  }
  const confirmed = await confirmDialog({
    title: '清空回收站？',
    message: `当前有 <b>${records.length}</b> 条记录，清空后待恢复书签将永久丢失，<b>不可撤销</b>。`,
    confirmText: '永久清空'
  });
  if (!confirmed) return;
  const button = $('#trashClear');
  if (button) button.disabled = true;
  try {
    await BM.clearTrash();
    notifySaved('回收站已清空 ✓', 'warn');
    setTrashMsg('', '');
  } catch (e) {
    setTrashMsg('清空失败：' + (e.message || e), 'err');
  } finally {
    if (button) button.disabled = false;
  }
}

// 填充固定标签池 textarea（未配置时显示默认池）
function fillFixedTags(list) {
  if (pendingTagConfigurationSaveCount > 0) return false;
  const el = $('#setFixedTags');
  if (!el) return false;
  let tags = list;
  if (!tags || (!tags.length && typeof BM !== 'undefined' && BM.DEFAULT_FIXED_TAGS)) {
    tags = BM.DEFAULT_FIXED_TAGS;
  }
  el.value = (tags || []).filter(t => t !== '其他').join('\n');
  return true;
}

function fillTagRules(rules) {
  if (pendingTagConfigurationSaveCount > 0) return false;
  rules = rules && typeof rules === 'object' ? rules : {};
  const domain = $('#setDomainTagRules');
  const keyword = $('#setKeywordTagRules');
  if (domain) domain.value = serializeTagRuleMap(rules.domain);
  if (keyword) keyword.value = serializeTagRuleMap(rules.keyword);
  return !!(domain || keyword);
}

function updateTagSyncEnabledFromStorage(value) {
  tagSyncEnabledVersion++;
  const syncEl = $('#setTagSync');
  if (syncEl) syncEl.checked = value === true;
}

function fillTagSyncEnabledFromSnapshot(value, versionAtRead) {
  if (tagSyncEnabledVersion !== versionAtRead) return false;
  const syncEl = $('#setTagSync');
  if (syncEl) syncEl.checked = value === true;
  return true;
}

function tagConfigurationSnapshot(stored) {
  return {
    fixedTags: stored.bmFixedTags,
    tagRules: stored.bmTagRules
  };
}

function hydrateTagConfigurationAfterLoad(configSnapshot) {
  // 原生书签水合可能等待后台队列；不能阻塞已保存的同步开关和设置表单回填。
  BM.initializeSyncedTagConfiguration(configSnapshot).catch(() => {});
}

async function load() {
  let initialTagConfiguration = null;
  try {
    try {
      $('#optVersion').textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (e) {
      /* noop */
    }
    await BM.migrateStorage();
    const tagSyncEnabledVersionAtRead = tagSyncEnabledVersion;
    const r = await chrome.storage.local.get([
      'bmSettings',
      LLM_PROFILES_KEY,
      ACTIVE_LLM_PROFILE_KEY,
      'bmFixedTags',
      'bmTagRules',
      'bmStarHook',
      'bmAutoAiTag',
      BM.NATIVE_SYNC_ENABLED_KEY,
      BM.SYNC_STATUS_KEY,
      BM.NATIVE_SYNC_REQUEST_KEY,
      BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY,
      NT_APPEARANCE_KEY
    ]);
    llmProfiles = normalizeLlmProfiles(r[LLM_PROFILES_KEY], r.bmSettings);
    activeLlmProfileId = llmProfiles.some(profile => profile.id === r[ACTIVE_LLM_PROFILE_KEY])
      ? r[ACTIVE_LLM_PROFILE_KEY]
      : llmProfiles[0].id;
    renderProfileSelect();
    fillForm(activeLlmProfile());
    fillFixedTags(r.bmFixedTags);
    fillTagRules(r.bmTagRules);
    // ⭐ 接管开关：默认开启（兼容老用户未配置）
    const star = $('#setStarHook');
    if (star) star.checked = r.bmStarHook !== false;
    const autoAi = $('#setAutoAiTag');
    if (autoAi) autoAi.checked = r.bmAutoAiTag === true;
    // 标签原生同步开关：默认关闭（隐私权衡，需主动开启）
    fillTagSyncEnabledFromSnapshot(r[BM.NATIVE_SYNC_ENABLED_KEY], tagSyncEnabledVersionAtRead);
    initialTagConfiguration = tagConfigurationSnapshot(r);
    tagSyncStatus = r[BM.SYNC_STATUS_KEY];
    updateTagSyncRequestState(
      r[BM.NATIVE_SYNC_REQUEST_KEY],
      r[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY]
    );
    renderTagSyncStatus(tagSyncStatus);
    renderTagSyncDiagnostics();
    fillNtAppearance(r[NT_APPEARANCE_KEY]);
    renderSectionStatuses();
  } catch (e) {
    console.warn('[书签管家] 读取设置失败', e);
  }
  // 注意：这里【只读不写】——无条件写回会用表单默认值覆盖
  // 另一处（popup 抽屉）刚保存的配置，导致「配置丢失」。
  hydrateTagConfigurationAfterLoad(initialTagConfiguration);
}

async function persistStarHook() {
  try {
    await chrome.storage.local.set({ bmStarHook: $('#setStarHook').checked });
  } catch (e) {
    /* noop */
  }
}

async function persistAutoAiTag() {
  try {
    const enabled = $('#setAutoAiTag').checked;
    if (enabled) {
      const cfg = formSettings();
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model)
        throw new Error('请先填好 AI 服务配置（接口地址、API Key、模型名）并保存');
      await BM.requestLlmHostPermission(cfg.baseUrl);
    }
    await chrome.storage.local.set({ bmAutoAiTag: enabled });
    setMsg('', '');
    notifySaved(enabled ? '已开启浏览器收藏后台 AI 补充' : '已关闭浏览器收藏后台 AI 补充');
  } catch (e) {
    $('#setAutoAiTag').checked = false;
    await chrome.storage.local.set({ bmAutoAiTag: false });
    setMsg('无法开启：' + (e.message || e), 'err', false);
  }
}

// 标签原生同步开关：开启时创建或读取内部书签目录；关闭时停止读写但保留数据。
async function persistTagSync() {
  const intent = ++tagSyncPersistIntent;
  try {
    const on = $('#setTagSync').checked;
    await BM.setTagSyncEnabled(on);
    if (intent !== tagSyncPersistIntent) return;
    // 后台可能已在本次调用期间完成。重新读取持久化状态，不能用“初始化中”覆盖完成或失败状态。
    const stored = await chrome.storage.local.get([
      BM.SYNC_STATUS_KEY,
      BM.NATIVE_SYNC_REQUEST_KEY,
      BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY
    ]);
    if (intent !== tagSyncPersistIntent) return;
    tagSyncStatus = stored[BM.SYNC_STATUS_KEY] || null;
    updateTagSyncRequestState(
      stored[BM.NATIVE_SYNC_REQUEST_KEY],
      stored[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY]
    );
    renderTagSyncStatus(
      tagSyncStatus || {
        lastError: '',
        pending: true,
        target: on,
        phase: 'queued',
        step: 1,
        totalSteps: 5
      }
    );
  } catch (e) {
    if (intent !== tagSyncPersistIntent) return;
    try {
      $('#setTagSync').checked = await BM.getTagSyncEnabled();
    } catch (ignored) {
      /* 保留当前状态 */
    }
    if (intent !== tagSyncPersistIntent) return;
    const msg = $('#tagSyncMsg');
    msg.textContent = '同步设置失败：' + (e.message || e);
    msg.className = 'settings-msg err';
  }
}

async function handleForcePushSync() {
  const btn = $('#btnForcePushSync');
  if (!btn || btn.disabled) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在重新推送...';
  try {
    const success = await BM.forceResyncTags();
    if (success) {
      if (window.UI && typeof window.UI.toast === 'function') {
        window.UI.toast('已成功将本机全量标签和规则重建并推送到 Chrome 原生同步目录', 'ok');
      }
      const msg = $('#tagSyncMsg');
      if (msg) {
        msg.textContent = '全量重新推送成功';
        msg.className = 'settings-msg ok';
      }
      if ($('#setTagSync')) $('#setTagSync').checked = true;
    } else {
      throw new Error('后台未确认同步成功');
    }
  } catch (err) {
    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast('推送失败：' + (err.message || err), 'danger');
    }
    const msg = $('#tagSyncMsg');
    if (msg) {
      msg.textContent = '推送失败：' + (err.message || err);
      msg.className = 'settings-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 外部（popup 抽屉等）修改设置时，实时同步到本页表单。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const hasProfileChanges = changes[LLM_PROFILES_KEY] || changes[ACTIVE_LLM_PROFILE_KEY];
  const ownProfileChange =
    (hasProfileChanges || changes.bmSettings) && consumeOwnProfileWrite(changes);
  if (hasProfileChanges && !ownProfileChange) {
    const legacy = changes.bmSettings
      ? changes.bmSettings.newValue
      : profileSettings(activeLlmProfile());
    llmProfiles = normalizeLlmProfiles(
      changes[LLM_PROFILES_KEY] ? changes[LLM_PROFILES_KEY].newValue : llmProfiles,
      legacy
    );
    const nextActiveId = changes[ACTIVE_LLM_PROFILE_KEY]
      ? changes[ACTIVE_LLM_PROFILE_KEY].newValue
      : activeLlmProfileId;
    activeLlmProfileId = llmProfiles.some(profile => profile.id === nextActiveId)
      ? nextActiveId
      : llmProfiles[0].id;
    renderProfileSelect();
    fillForm(activeLlmProfile());
  } else if (changes.bmSettings && !ownProfileChange) {
    const profile = mergeActiveLlmSettings(changes.bmSettings.newValue);
    if (profile) {
      fillForm(profile);
      persistProfileState(profileSettings(profile)).catch(e =>
        console.warn('[书签管家] 同步外部 LLM 配置失败', e)
      );
    }
  }
  if (changes.bmFixedTags && !ownProfileChange && pendingTagConfigurationSaveCount === 0) {
    fillFixedTags(changes.bmFixedTags.newValue);
  }
  if (changes.bmTagRules && !ownProfileChange && pendingTagConfigurationSaveCount === 0) {
    fillTagRules(changes.bmTagRules.newValue);
  }
  if (changes[BM.NATIVE_SYNC_ENABLED_KEY]) {
    updateTagSyncEnabledFromStorage(changes[BM.NATIVE_SYNC_ENABLED_KEY].newValue);
  }
  if (changes[BM.NATIVE_SYNC_REQUEST_KEY] || changes[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY]) {
    updateTagSyncRequestState(
      changes[BM.NATIVE_SYNC_REQUEST_KEY]
        ? changes[BM.NATIVE_SYNC_REQUEST_KEY].newValue
        : tagSyncRequest,
      changes[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY]
        ? changes[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY].newValue
        : completedTagSyncRequestId
    );
  }
  if (changes[BM.SYNC_STATUS_KEY]) {
    tagSyncStatus = changes[BM.SYNC_STATUS_KEY].newValue;
  }
  if (
    changes[BM.NATIVE_SYNC_REQUEST_KEY] ||
    changes[BM.NATIVE_SYNC_COMPLETED_REQUEST_KEY] ||
    changes[BM.SYNC_STATUS_KEY]
  ) {
    renderTagSyncStatus(tagSyncStatus);
  }
  if (changes[NT_APPEARANCE_KEY] && $('#setNtWidth')) {
    // 另一窗口（新标签页 / 另一设置页）改外观时同步到本页表单
    const next = changes[NT_APPEARANCE_KEY].newValue;
    if (next && !sameStoredValue(next, ntAppearanceValue())) fillNtAppearance(next);
  }
  renderSectionStatuses();
});

try {
  BM.watchTagConfiguration(() => {
    const editVersion = tagConfigurationEditVersion;
    if (BM.invalidateFixedTags) BM.invalidateFixedTags();
    if (BM.invalidateTagRules) BM.invalidateTagRules();
    Promise.all([BM.loadFixedTags(), BM.loadTagRules()])
      .then(([tags, rules]) => {
        if (editVersion !== tagConfigurationEditVersion || pendingTagConfigurationSaveCount > 0)
          return;
        fillFixedTags(tags);
        fillTagRules(rules);
      })
      .catch(() => {});
  });
} catch (e) {
  /* sync 权限不可用时保持本地配置 */
}

async function testConnection() {
  const cfg = {
    baseUrl: $('#setBase').value.trim(),
    apiKey: $('#setKey').value.trim(),
    model: $('#setModel').value.trim()
  };
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    setMsg('请先填好接口地址、API Key 和模型名再测试', 'err');
    return;
  }
  const btn = $('#settingsTest');
  btn.disabled = true;
  btn.textContent = '测试中…';
  setMsg('', '');
  try {
    await BM.requestLlmHostPermission(cfg.baseUrl);
    await BM.testLLM(cfg);
    notifySaved('连接成功');
  } catch (e) {
    setMsg('失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function modelListKey(cfg) {
  return [cfg && cfg.provider, cfg && cfg.baseUrl, cfg && cfg.apiKey].join('|');
}

// 加载模型列表后切换为「仅选择」模式：禁止手动输入，只能从下拉选择
function setModelReadonly(on) {
  const input = $('#setModel');
  if (!input) return;
  input.readOnly = !!on;
  input.setAttribute('aria-readonly', on ? 'true' : 'false');
  input.placeholder = on ? '从列表中选择模型' : '输入或从下拉选择模型';
}

// 已拉取列表 ∪ 当前手动输入：远端模型与自由输入名都能出现在候选中
function mergeModelOptions(models, current) {
  const out = [];
  (models || []).forEach(model => {
    const v = String(model == null ? '' : model).trim();
    if (v && !out.includes(v)) out.push(v);
  });
  const cur = String(current == null ? '' : current).trim();
  if (cur && !out.includes(cur)) out.push(cur);
  return out;
}

// 下拉过滤：大小写不敏感的子串匹配；空查询返回全部
function filterModelOptions(models, query) {
  const q = String(query == null ? '' : query)
    .trim()
    .toLowerCase();
  return (models || []).filter(model => !q || String(model).toLowerCase().includes(q));
}

function openModelList() {
  const combo = $('#modelCombo');
  const input = $('#setModel');
  const list = $('#modelComboList');
  if (!combo || !list) return;
  modelComboOpen = true;
  list.hidden = false;
  combo.dataset.open = 'true';
  input.setAttribute('aria-expanded', 'true');
  renderModelList();
}

function closeModelList() {
  const combo = $('#modelCombo');
  const input = $('#setModel');
  const list = $('#modelComboList');
  modelComboOpen = false;
  modelComboActiveIndex = -1;
  if (list) list.hidden = true;
  if (combo) delete combo.dataset.open;
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-activedescendant', '');
  }
}

function renderModelList() {
  const list = $('#modelComboList');
  const input = $('#setModel');
  if (!list || !input) return;
  const models = modelListCache.get(modelListKey(formSettings())) || [];
  // 「仅选择」（readonly）模式下无法输入关键词：打开下拉展示全部模型，当前项打勾；
  // 自由输入模式仍按输入内容实时过滤。
  const q = input.readOnly ? '' : input.value.trim();
  const matches = filterModelOptions(models, q);
  const current = input.value.trim();
  list.replaceChildren();
  const setActiveDescendant = () => {
    input.setAttribute(
      'aria-activedescendant',
      modelComboActiveIndex >= 0 ? 'modelOpt-' + modelComboActiveIndex : ''
    );
  };
  if (!models.length) {
    const li = document.createElement('li');
    li.className = 'model-combo-empty';
    li.textContent = formSettings().baseUrl
      ? '尚未获取模型列表，可点击右侧「获取模型列表」'
      : '请先填写 Base URL 后再获取模型列表';
    list.appendChild(li);
    modelComboActiveIndex = -1;
    setActiveDescendant();
    return;
  }
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'model-combo-empty';
    li.textContent = '没有匹配「' + q + '」的模型，可继续手动输入';
    list.appendChild(li);
    modelComboActiveIndex = -1;
    setActiveDescendant();
    return;
  }
  if (modelComboActiveIndex >= matches.length) modelComboActiveIndex = matches.length - 1;
  matches.forEach((model, index) => {
    const selected = model === current;
    const li = document.createElement('li');
    li.className =
      'model-combo-item' +
      (index === modelComboActiveIndex ? ' active' : '') +
      (selected ? ' is-selected' : '');
    li.id = 'modelOpt-' + index;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(selected));
    li.dataset.model = model;
    const check = document.createElement('span');
    check.className = 'mc-check';
    check.textContent = selected ? '✓' : '';
    li.appendChild(check);
    const label = document.createElement('span');
    label.className = 'mc-label';
    const qi = q ? model.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (qi >= 0) {
      label.append(document.createTextNode(model.slice(0, qi)));
      const mark = document.createElement('mark');
      mark.textContent = model.slice(qi, qi + q.length);
      label.appendChild(mark);
      label.append(document.createTextNode(model.slice(qi + q.length)));
    } else {
      label.textContent = model;
    }
    li.appendChild(label);
    li.addEventListener('mousedown', event => {
      event.preventDefault(); // 保持输入框焦点，避免 blur 先于点击关闭
      commitModel(model);
    });
    list.appendChild(li);
  });
  const active = list.querySelector('.model-combo-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  setActiveDescendant();
}

// 提交选择/输入值：写入输入框并触发既有 input 监听（自动保存），随后收起下拉
function commitModel(value) {
  const input = $('#setModel');
  if (!input) return;
  input.value = value;
  if (modelComboOpen) renderModelList(); // 更新 ✓ 标记
  input.dispatchEvent(new Event('input', { bubbles: true })); // 触发持久化
  closeModelList();
}

function onModelKeydown(event) {
  const list = $('#modelComboList');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!modelComboOpen) {
      modelComboActiveIndex = event.key === 'ArrowDown' ? 0 : 999999; // render 时收敛到末项
      openModelList();
      return;
    }
    const count = list ? list.querySelectorAll('.model-combo-item').length : 0;
    if (count) {
      modelComboActiveIndex =
        (modelComboActiveIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      renderModelList();
    }
    return;
  }
  if (!modelComboOpen) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    const item = list && list.querySelector('.model-combo-item.active');
    if (item) commitModel(item.dataset.model);
    else closeModelList();
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    closeModelList();
  }
}

// 服务商 / Base URL / API Key 变化后，若已授予主机权限则静默预取模型列表（不弹权限询问）。
function maybeAutoFetchModels() {
  clearTimeout(modelAutoFetchTimer);
  const cfg = formSettings();
  if (!cfg.baseUrl || !cfg.apiKey) {
    setModelReadonly(false);
    return;
  }
  const key = modelListKey(cfg);
  const cached = modelListCache.get(key);
  if (cached && cached.length) {
    setModelReadonly(true);
    return;
  }
  // 新配置还没有模型列表：先恢复手动输入，静默获取成功后再切回「仅选择」。
  setModelReadonly(false);
  Promise.resolve(
    typeof BM.hasLlmHostPermission === 'function' ? BM.hasLlmHostPermission(cfg.baseUrl) : false
  )
    .then(granted => {
      if (!granted) return;
      modelAutoFetchTimer = setTimeout(() => fetchModelList({ silent: true }).catch(() => {}), 700);
    })
    .catch(() => {});
}

async function fetchModelList(opts) {
  opts = opts || {};
  const intent = ++modelFetchIntent;
  const btn = $('#modelsFetch');
  const msg = $('#modelsMsg');
  const cfg = formSettings();
  const profileId = activeLlmProfileId;
  if (!cfg.baseUrl) {
    if (msg && !opts.silent) {
      msg.textContent = '请先填写 Base URL';
      msg.className = 'settings-msg err';
    }
    return;
  }
  if (!opts.silent && btn) {
    btn.disabled = true;
    btn.textContent = '获取中…';
  }
  if (msg && !opts.silent) {
    msg.textContent = '';
    msg.className = 'settings-msg';
  }
  try {
    await BM.requestLlmHostPermission(cfg.baseUrl);
    const models = await BM.listModels(cfg);
    const currentCfg = formSettings();
    if (
      intent !== modelFetchIntent ||
      activeLlmProfileId !== profileId ||
      currentCfg.provider !== cfg.provider ||
      currentCfg.baseUrl !== cfg.baseUrl ||
      currentCfg.apiKey !== cfg.apiKey
    )
      return;
    modelListCache.set(modelListKey(cfg), mergeModelOptions(models, $('#setModel').value.trim()));
    setModelReadonly(true); // 列表已就绪：只能从列表中选择模型
    if (modelComboOpen) renderModelList();
    const current = $('#setModel').value.trim();
    if (msg && !opts.silent) {
      msg.textContent = '';
      msg.className = 'settings-msg';
    }
    if (!opts.silent) {
      notifySaved(
        '已加载 ' +
          models.length +
          ' 个模型' +
          (current && !models.includes(current) ? '；当前模型未出现在列表中，仍可继续使用' : '')
      );
    }
  } catch (e) {
    if (intent !== modelFetchIntent) return;
    if (msg && !opts.silent) {
      msg.textContent = '获取失败：' + (e.message || e);
      msg.className = 'settings-msg err';
    }
  } finally {
    if (intent === modelFetchIntent && btn && !opts.silent) {
      btn.disabled = false;
      btn.textContent = '获取模型列表';
    }
  }
}

// ---------- P2-3：设置分组导航（桌面 sticky 锚点 + 窄屏下拉） ----------
function escapeNavText(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

function optionsSections() {
  return Array.from(document.querySelectorAll('.opt-wrap section.opt-section'));
}

function sectionNavLabel(section) {
  const head = section.querySelector('.opt-section-head h2');
  if (!head) return section.id;
  // 标题里的「?」说明按钮也属于 h2 的子节点，直接读 textContent 会把「?」
  // 一起带进导航标签（如「AI 分类 ?」），这里先剔除说明按钮再取文本。
  const text = Array.from(head.childNodes)
    .filter(node => !(node.nodeType === 1 && node.classList.contains('help-dot')))
    .map(node => node.textContent)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text || section.id;
}

function setActiveNav(targetId) {
  const nav = $('#optNav');
  if (nav) {
    nav.querySelectorAll('.opt-nav-link').forEach(link => {
      const active = link.dataset.target === targetId;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }
  const select = $('#optNavSelect');
  if (select && targetId && select.value !== targetId) select.value = targetId;
}

function jumpToSection(id, smooth) {
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  target.scrollIntoView({ behavior: smooth === false ? 'auto' : 'smooth', block: 'start' });
  setActiveNav(id);
}

function initOptionsNav() {
  const nav = $('#optNav');
  const sections = optionsSections();
  if (!nav || !sections.length) return;
  nav.innerHTML =
    '<div class="opt-nav-title">设置分组</div>' +
    sections
      .map(section => {
        const label = escapeNavText(sectionNavLabel(section));
        return (
          '<a class="opt-nav-link" href="#' +
          section.id +
          '" data-target="' +
          section.id +
          '">' +
          label +
          '</a>'
        );
      })
      .join('') +
    '<select id="optNavSelect" class="opt-nav-select" aria-label="跳转到设置分组">' +
    sections
      .map(
        section =>
          '<option value="' +
          section.id +
          '">' +
          escapeNavText(sectionNavLabel(section)) +
          '</option>'
      )
      .join('') +
    '</select>';

  nav.addEventListener('click', event => {
    const link = event.target.closest('.opt-nav-link');
    if (!link || !nav.contains(link)) return;
    event.preventDefault();
    jumpToSection(link.dataset.target, true);
    // 链接保留 href="#id"，无 JS 时仍可原生跳转
    if (window.history && history.replaceState)
      history.replaceState(null, '', '#' + link.dataset.target);
  });
  nav.addEventListener('change', event => {
    const select = event.target.closest('.opt-nav-select');
    if (select) jumpToSection(select.value, true);
  });

  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActiveNav(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    sections.forEach(section => observer.observe(section));
  }
  // 带 hash 打开（例如从面板点「自定义规则」跳过来）时显式滚到目标分组：分组内容渲染后位置会变，
  // 不能只靠浏览器原生锚点；设置页已打开时面板只改 hash、不重载文档，所以还要跟着 hashchange 滚。
  const initialId = (window.location.hash || '').slice(1);
  if (initialId && document.getElementById(initialId)) {
    setActiveNav(initialId);
    requestAnimationFrame(() => jumpToSection(initialId, false));
  } else {
    setActiveNav(sections[0].id);
  }
  window.addEventListener('hashchange', () => {
    const id = (window.location.hash || '').slice(1);
    if (id && document.getElementById(id)) jumpToSection(id, true);
  });
}

// ---------- P2-3：分组状态摘要（不展开即可看到配置健康度） ----------
function setSectionStatus(key, text, level) {
  const el = document.querySelector('.section-status[data-status-for="' + key + '"]');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'section-status' + (level ? ' ' + level : '');
}

function countRuleLines(el) {
  if (!el) return 0;
  return String(el.value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean).length;
}

function selectedOptionText(select) {
  if (!select) return '';
  const option = select.selectedOptions && select.selectedOptions[0];
  return option ? option.textContent.trim() : '';
}

function renderSectionStatuses() {
  const profile = activeLlmProfile();
  const providerSelect = $('#setProvider');
  const hasKey = !!String(($('#setKey') && $('#setKey').value) || '').trim();
  const model = String(($('#setModel') && $('#setModel').value) || '').trim();
  const providerLabel =
    selectedOptionText(providerSelect) || (providerSelect && providerSelect.value) || '';
  setSectionStatus(
    'ai',
    hasKey
      ? '已配置 ' + providerLabel + (model ? ' · ' + model : '')
      : '未配置服务商（仅本地规则可用）',
    hasKey ? 'ok' : 'warn'
  );

  const fixedTags = String(($('#setFixedTags') && $('#setFixedTags').value) || '')
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean);
  const maxTags = (typeof BM !== 'undefined' && BM.MAX_FIXED_TAGS) || 50;
  const ruleCount =
    countRuleLines($('#setDomainTagRules')) + countRuleLines($('#setKeywordTagRules'));
  setSectionStatus(
    'tags',
    '标签池 ' + fixedTags.length + ' 个 · 规则 ' + ruleCount + ' 条',
    fixedTags.length > maxTags ? 'warn' : 'ok'
  );

  const syncOn = !!($('#setTagSync') && $('#setTagSync').checked);
  const starOn = !!($('#setStarHook') && $('#setStarHook').checked);
  setSectionStatus(
    'browser',
    '标签同步' + (syncOn ? '已开启' : '未开启') + ' · 收藏接管' + (starOn ? '已开启' : '未开启'),
    syncOn ? 'ok' : ''
  );

  setSectionStatus(
    'appearance',
    '宽度：' +
      (selectedOptionText($('#setNtWidth')) || '默认') +
      ' · 配色：' +
      (selectedOptionText($('#setNtTheme')) || '跟随系统')
  );

  setSectionStatus(
    'danger',
    profile
      ? '当前配置：' + (profile.name || '未命名') + ' · 删除后不可恢复'
      : '删除 / 清理类操作集中在此'
  );
}

document.addEventListener('DOMContentLoaded', () => {
  initOptionsNav();
  if (window.UI && typeof UI.initTooltip === 'function') UI.initTooltip();
  // 表单变化时刷新分组状态摘要（仅读值 + 写文本，开销可忽略）
  document.addEventListener('input', event => {
    if (event.target && event.target.closest && event.target.closest('.opt-section')) {
      renderSectionStatuses();
    }
  });
  $('#setProvider').addEventListener('change', () => {
    applyProviderPreset();
    persist();
    maybeAutoFetchModels();
  });
  $('#setBase').addEventListener('input', () => {
    queuePersist();
    maybeAutoFetchModels();
  });
  $('#setModel').addEventListener('input', queuePersist);
  $('#setModel').addEventListener('input', event => {
    if (event.isTrusted) {
      modelComboActiveIndex = 0;
      openModelList();
    } else if (modelComboOpen) renderModelList();
  });
  $('#setModel').addEventListener('focus', () => openModelList());
  $('#setModel').addEventListener('click', () => {
    // 选中后输入框仍保持聚焦且变为只读，focus 不会再次触发，需在 click 时重新打开下拉
    if (!modelComboOpen) openModelList();
  });
  $('#setModel').addEventListener('blur', () => closeModelList());
  $('#setModel').addEventListener('keydown', onModelKeydown);
  $('#setKey').addEventListener('input', () => {
    queuePersist();
    maybeAutoFetchModels();
  });
  $('#setKeyToggle').addEventListener('click', () => {
    const input = $('#setKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#setKeyToggle').textContent = show ? '隐藏' : '显示';
    input.focus();
  });
  $('#setProfileName').addEventListener('input', queuePersist);
  $('#setProfile').addEventListener('change', event => {
    switchLlmProfile(event.target.value);
  });
  $('#profileNew').addEventListener('click', createLlmProfile);
  $('#profileDelete').addEventListener('click', deleteActiveLlmProfile);
  $('#backupExport').addEventListener('click', exportBackup);
  $('#backupImport').addEventListener('click', () => ensureBackupInput().click());
  $('#trashClear').addEventListener('click', clearTrash);
  $('#settingsSave').addEventListener('click', saveWithLlmPermission);
  $('#settingsTest').addEventListener('click', testConnection);
  $('#modelsFetch').addEventListener('click', fetchModelList);
  // 点击下拉外部（含「获取模型列表」按钮）时不关闭；其余区域点击则收起下拉
  document.addEventListener('mousedown', event => {
    if (!modelComboOpen) return;
    const combo = $('#modelCombo');
    const fetchBtn = $('#modelsFetch');
    if (combo && combo.contains(event.target)) return;
    if (fetchBtn && fetchBtn.contains(event.target)) return;
    closeModelList();
  });
  $('#setFixedTags').addEventListener('input', debounce(persistFixedTags, 600));
  $('#aiInitFixedTags')?.addEventListener('click', aiInitFixedTags);
  // 规则编辑完成并失焦后再保存，避免每次敲键都让已打开的侧边栏全量刷新。
  $('#setDomainTagRules').addEventListener('change', persistTagRules);
  $('#setKeywordTagRules').addEventListener('change', persistTagRules);
  $('#setStarHook').addEventListener('change', persistStarHook);
  $('#setAutoAiTag').addEventListener('change', persistAutoAiTag);
  $('#setTagSync').addEventListener('change', persistTagSync);
  $('#btnForcePushSync')?.addEventListener('click', handleForcePushSync);
  // 新标签页外观：改动即存，新标签页通过 onChanged 实时生效
  // 取色或输入色值即代表「要用这个背景色」：若配色还没切到「自定义」，
  // 保存下来的 bg 会被 theme='auto'/'light'/'dark' 忽略，表现为「设置背景色无效」。
  const useCustomThemeForBg = () => {
    const themeEl = $('#setNtTheme');
    if (!themeEl || themeEl.value === 'custom') return;
    themeEl.value = 'custom';
    ntBgRowVisible(true);
  };
  $('#setNtWidth').addEventListener('change', () => persistNtAppearance('新标签页宽度已保存'));
  $('#setNtTheme').addEventListener('change', () => {
    ntBgRowVisible($('#setNtTheme').value === 'custom');
    persistNtAppearance('新标签页配色已保存');
  });
  $('#setNtBg').addEventListener('input', () => {
    useCustomThemeForBg();
    $('#setNtBgHex').value = $('#setNtBg').value;
    persistNtAppearance(null);
  });
  $('#setNtBgHex').addEventListener('input', () => {
    const v = $('#setNtBgHex').value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      useCustomThemeForBg();
      $('#setNtBg').value = v.toLowerCase();
      persistNtAppearance(null);
    }
  });
  $('#setNtBgReset').addEventListener('click', async () => {
    useCustomThemeForBg();
    $('#setNtBg').value = NT_DEFAULT_BG;
    $('#setNtBgHex').value = NT_DEFAULT_BG;
    await persistNtAppearance('已重置为默认背景色');
  });
  load()
    .then(renderSectionStatuses)
    .catch(e => console.warn('[书签管家] 读取设置失败', e));
});

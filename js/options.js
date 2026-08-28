// ===== 书签管家 · 选项页设置逻辑 (options.js) =====
// 独立窗口：不因 popup 失焦关闭；修改即实时保存到 chrome.storage.local。
'use strict';

// 服务商预设统一来自 lib.js（DRY，与 popup.js 共享同一份配置）
const PROVIDERS = (typeof BM !== 'undefined' && BM.PROVIDERS) || {};

const $ = sel => document.querySelector(sel);
const LLM_PROFILES_KEY = 'bmLlmProfiles';
const ACTIVE_LLM_PROFILE_KEY = 'bmActiveLlmProfileId';
let llmProfiles = [];
let activeLlmProfileId = '';
let nextProfileId = 0;
let profileWriteQueue = Promise.resolve();
const pendingOwnProfileWrites = [];

function setMsg(text, cls, autohide) {
  const el = $('#settingsMsg');
  el.textContent = text || '';
  el.className = 'settings-msg' + (cls ? ' ' + cls : '');
  if (autohide !== false) {
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2600);
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

function renderTagSyncStatus(status) {
  const msg = $('#tagSyncMsg');
  if (!msg || !status || !status.lastError) return;
  msg.textContent = '上次同步失败：' + status.lastError;
  msg.className = 'settings-msg err';
}

// ---- 固定标签池：textarea ↔ 数组转换（每行一个，忽略 # 注释）----
function parseFixedTags(text) {
  return [...new Set(String(text || '').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#')))];
}

// 每行 `关键字=标签1,标签2`；忽略空行和 # 注释。
function parseTagRuleMap(text) {
  const entries = [];
  String(text || '').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq <= 0) return;
    const key = line.slice(0, eq).trim();
    const tags = [...new Set(line.slice(eq + 1).split(/[,，、;；]/).map(tag => tag.trim()).filter(Boolean))];
    if (key && tags.length) entries.push([key, tags]);
  });
  return Object.fromEntries(entries);
}

function parseTagRules(domainText, keywordText) {
  return { domain: parseTagRuleMap(domainText), keyword: parseTagRuleMap(keywordText) };
}

function serializeTagRuleMap(map) {
  return Object.entries(map || {}).map(([key, tags]) => {
    const values = Array.isArray(tags) ? tags : [tags];
    return key + '=' + values.join(',');
  }).join('\n');
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
    model: String(raw.model || preset.model || '').trim()
  };
}

function defaultProfileName(settings) {
  const provider = settings.provider === 'custom' ? '自定义' : settings.provider.toUpperCase();
  return settings.model ? provider + ' · ' + settings.model : provider;
}

function createProfile(raw, fallbackName) {
  const settings = normalizeLlmSettings(raw);
  return {
    id: String(raw && raw.id || createProfileId()),
    name: String(raw && raw.name || '').trim() || fallbackName || defaultProfileName(settings),
    ...settings,
    updatedAt: Number(raw && raw.updatedAt) || Date.now()
  };
}

function normalizeLlmProfiles(rawProfiles, legacySettings) {
  const raw = Array.isArray(rawProfiles) ? rawProfiles.filter(item => item && typeof item === 'object') : [];
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
  const index = pendingOwnProfileWrites.findIndex(marker =>
    (!changes[LLM_PROFILES_KEY] || sameStoredValue(marker.profiles, changes[LLM_PROFILES_KEY].newValue)) &&
    (!changes[ACTIVE_LLM_PROFILE_KEY] || marker.activeId === changes[ACTIVE_LLM_PROFILE_KEY].newValue) &&
    (!changes.bmSettings || sameStoredValue(marker.settings, changes.bmSettings.newValue)) &&
    (!changes.bmFixedTags || sameStoredValue(marker.fixedTags, changes.bmFixedTags.newValue)) &&
    (!changes.bmTagRules || sameStoredValue(marker.tagRules, changes.bmTagRules.newValue))
  );
  if (index < 0) return false;
  pendingOwnProfileWrites.splice(index, 1);
  return true;
}

function queueProfileWrite(values) {
  const payload = cloneStoredValue(values);
  profileWriteQueue = profileWriteQueue.catch(() => {}).then(async () => {
    const marker = {
      profiles: payload[LLM_PROFILES_KEY],
      activeId: payload[ACTIVE_LLM_PROFILE_KEY],
      settings: payload.bmSettings,
      fixedTags: payload.bmFixedTags,
      tagRules: payload.bmTagRules
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
  llmProfiles = llmProfiles.map(item => item.id === profile.id ? profile : item);
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
  llmProfiles = llmProfiles.map(item => item.id === profile.id ? profile : item);
  return profile;
}

// 选中服务商时，自动带出预设 Base URL / 模型（仅在用户尚未手填时）
function applyProviderPreset() {
  const p = PROVIDERS[$('#setProvider').value];
  if (!p) return;
  if (!$('#setBase').value.trim()) $('#setBase').value = p.base || '';
  if (!$('#setModel').value.trim()) $('#setModel').value = p.model || '';
}

// 实时保存（静默，不弹提示）
async function persistSilent() {
  const profile = updateActiveProfileFromForm();
  if (!profile) return;
  const ft = parseFixedTags($('#setFixedTags').value);
  const tagRules = parseTagRules($('#setDomainTagRules').value, $('#setKeywordTagRules').value);
  try {
    await queueProfileWrite({
      [LLM_PROFILES_KEY]: llmProfiles,
      [ACTIVE_LLM_PROFILE_KEY]: activeLlmProfileId,
      bmSettings: profileSettings(profile),
      bmFixedTags: ft,
      bmTagRules: tagRules
    });
    // 让 popup/analyzer 下次读取新配置
    if (typeof BM !== 'undefined') {
      if (BM.invalidateFixedTags) BM.invalidateFixedTags();
      if (BM.invalidateTagRules) BM.invalidateTagRules();
    }
  } catch (e) { console.warn('[书签管家] 保存设置失败', e); }
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
    setMsg('配置已保存；后台 AI 因未获新域名权限而关闭：' + (permissionError.message || permissionError), 'err', false);
  } else {
    setMsg('✓ 已自动保存', 'ok');
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
  await persistSilent();
  const tags = parseFixedTags($('#setFixedTags').value);
  const max = (typeof BM !== 'undefined' && BM.MAX_FIXED_TAGS) || 50;
  setFtMsg(`✓ 已保存 ${tags.length} 个标签${tags.length > max ? `（超出 ${max}，AI 打标仅取前 ${max}）` : ''}`, 'ok');
}

async function persistTagRules() {
  await persistSilent();
  const rules = parseTagRules($('#setDomainTagRules').value, $('#setKeywordTagRules').value);
  const count = Object.keys(rules.domain).length + Object.keys(rules.keyword).length;
  setTrMsg('✓ 已保存 ' + count + ' 条自定义规则', 'ok');
}

// 用活动配置填充表单（provider 缺失时回退 DeepSeek 预设）
function fillForm(profile) {
  const settings = profileSettings(profile);
  $('#setProfileName').value = profile && profile.name || defaultProfileName(settings);
  $('#setProvider').value = settings.provider;
  $('#setBase').value = settings.baseUrl;
  $('#setModel').value = settings.model;
  $('#setKey').value = settings.apiKey;
}

async function ensureBackgroundAiPermission(settings) {
  const stored = await chrome.storage.local.get('bmAutoAiTag');
  if (stored.bmAutoAiTag !== true) return;
  if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model) return;
  if (BM.hasLlmHostPermission && await BM.hasLlmHostPermission(settings.baseUrl)) return;
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
    setMsg('已切换到「' + profile.name + '」', 'ok');
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
    setMsg('已新建配置，可填写后自动保存', 'ok');
  } catch (e) {
    setMsg('新建失败：' + (e.message || e), 'err');
  }
}

async function deleteActiveLlmProfile() {
  const profile = activeLlmProfile();
  if (!profile) return;
  if (!window.confirm('删除配置「' + profile.name + '」？此操作无法恢复。')) return;
  const currentIndex = llmProfiles.findIndex(item => item.id === profile.id);
  const remaining = llmProfiles.filter(item => item.id !== profile.id);
  if (!remaining.length) {
    remaining.push(createProfile({ provider: 'deepseek', name: '默认配置' }));
  }
  const next = remaining[Math.max(0, Math.min(currentIndex, remaining.length - 1))];
  try {
    await commitActiveProfileState(remaining, next.id);
    setMsg('已删除配置', 'ok');
  } catch (e) {
    setMsg('删除失败：' + (e.message || e), 'err');
  }
}

// 填充固定标签池 textarea（未配置时显示默认池）
function fillFixedTags(list) {
  const el = $('#setFixedTags');
  if (!el) return;
  let tags = list;
  if (!tags || !tags.length && typeof BM !== 'undefined' && BM.DEFAULT_FIXED_TAGS) {
    tags = BM.DEFAULT_FIXED_TAGS;
  }
  el.value = (tags || []).filter(t => t !== '其他').join('\n');
}

function fillTagRules(rules) {
  rules = rules && typeof rules === 'object' ? rules : {};
  const domain = $('#setDomainTagRules');
  const keyword = $('#setKeywordTagRules');
  if (domain) domain.value = serializeTagRuleMap(rules.domain);
  if (keyword) keyword.value = serializeTagRuleMap(rules.keyword);
}

async function load() {
  try {
    await BM.migrateStorage();
    const r = await chrome.storage.local.get([
      'bmSettings', LLM_PROFILES_KEY, ACTIVE_LLM_PROFILE_KEY,
      'bmFixedTags', 'bmTagRules', 'bmStarHook', 'bmAutoAiTag', BM.SYNC_ENABLED_KEY, BM.SYNC_STATUS_KEY
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
    // 标签云同步开关：默认关闭（隐私权衡，需主动开启）
    const syncEl = $('#setTagSync');
    if (syncEl) syncEl.checked = await BM.getTagSyncEnabled();
    renderTagSyncStatus(r[BM.SYNC_STATUS_KEY]);
  } catch (e) {
    console.warn('[书签管家] 读取设置失败', e);
  }
  // 注意：这里【只读不写】——无条件写回会用表单默认值覆盖
  // 另一处（popup 抽屉）刚保存的配置，导致「配置丢失」。
  setMsg('设置已就绪 · 修改即时生效', 'ok', false);
}

async function persistStarHook() {
  try { await chrome.storage.local.set({ bmStarHook: $('#setStarHook').checked }); } catch (e) { /* noop */ }
}

async function persistAutoAiTag() {
  try {
    const enabled = $('#setAutoAiTag').checked;
    if (enabled) {
      const cfg = formSettings();
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new Error('请先填写并保存 LLM 配置');
      await BM.requestLlmHostPermission(cfg.baseUrl);
    }
    await chrome.storage.local.set({ bmAutoAiTag: enabled });
    setMsg(enabled ? '已开启浏览器收藏后台 AI 补充' : '已关闭浏览器收藏后台 AI 补充', 'ok');
  } catch (e) {
    $('#setAutoAiTag').checked = false;
    await chrome.storage.local.set({ bmAutoAiTag: false });
    setMsg('无法开启：' + (e.message || e), 'err', false);
  }
}

// 标签云同步开关：开启时立刻把本地标签推上云端；关闭时停止读写
async function persistTagSync() {
  try {
    const on = $('#setTagSync').checked;
    await Promise.all([
      chrome.storage.local.set({ [BM.SYNC_ENABLED_KEY]: on }),
      chrome.storage.sync.set({ [BM.SYNC_ENABLED_KEY]: on })
    ]);
    const msg = $('#tagSyncMsg');
    if (on) {
      msg.textContent = '已开启 · 正在推送本地标签到云端…';
      msg.className = 'settings-msg ok';
      try {
        await BM.pullTagsFromCloud();
        await BM.pushTagsToCloud();
        await BM.loadTags();
        const map = BM.getTags() || {};
        if (map && Object.keys(map).length) {
          msg.textContent = '已开启 · 标签已合并并推送 ✓';
        } else {
          msg.textContent = '已开启 · 暂无标签数据可推送';
        }
      } catch (e) {
        msg.textContent = '已开启 · 推送失败：' + (e.message || e);
        msg.className = 'settings-msg err';
      }
    } else {
      msg.textContent = '已关闭 · 停止读写云端（已有云端数据保留）';
      msg.className = 'settings-msg';
    }
  } catch (e) { /* noop */ }
}

// 外部（popup 抽屉等）修改设置时，实时同步到本页表单。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const hasProfileChanges = changes[LLM_PROFILES_KEY] || changes[ACTIVE_LLM_PROFILE_KEY];
  const hasEditableChanges = hasProfileChanges || changes.bmSettings ||
    changes.bmFixedTags || changes.bmTagRules;
  const ownProfileChange = hasEditableChanges && consumeOwnProfileWrite(changes);
  if (hasProfileChanges && !ownProfileChange) {
    const legacy = changes.bmSettings ? changes.bmSettings.newValue : profileSettings(activeLlmProfile());
    llmProfiles = normalizeLlmProfiles(
      changes[LLM_PROFILES_KEY] ? changes[LLM_PROFILES_KEY].newValue : llmProfiles,
      legacy
    );
    const nextActiveId = changes[ACTIVE_LLM_PROFILE_KEY] ? changes[ACTIVE_LLM_PROFILE_KEY].newValue : activeLlmProfileId;
    activeLlmProfileId = llmProfiles.some(profile => profile.id === nextActiveId) ? nextActiveId : llmProfiles[0].id;
    renderProfileSelect();
    fillForm(activeLlmProfile());
  } else if (changes.bmSettings && !ownProfileChange) {
    const profile = mergeActiveLlmSettings(changes.bmSettings.newValue);
    if (profile) {
      fillForm(profile);
      persistProfileState(profileSettings(profile)).catch(e => console.warn('[书签管家] 同步外部 LLM 配置失败', e));
    }
  }
  if (changes.bmFixedTags && !ownProfileChange) {
    fillFixedTags(changes.bmFixedTags.newValue);
  }
  if (changes.bmTagRules && !ownProfileChange) {
    fillTagRules(changes.bmTagRules.newValue);
  }
  if (changes[BM.SYNC_STATUS_KEY]) {
    renderTagSyncStatus(changes[BM.SYNC_STATUS_KEY].newValue);
  }
});

async function testConnection() {
  const cfg = {
    baseUrl: $('#setBase').value.trim(),
    apiKey: $('#setKey').value.trim(),
    model: $('#setModel').value.trim()
  };
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    setMsg('请先填完三项再测试', 'err');
    return;
  }
  const btn = $('#settingsTest');
  btn.disabled = true; btn.textContent = '测试中…';
  setMsg('', '');
  try {
    await BM.requestLlmHostPermission(cfg.baseUrl);
    await BM.testLLM(cfg);
    setMsg('连接成功 ✓', 'ok');
  } catch (e) {
    setMsg('失败：' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.textContent = '测试连接';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#setProvider').addEventListener('change', () => { applyProviderPreset(); persist(); });
  $('#setBase').addEventListener('input', persist);
  $('#setModel').addEventListener('input', persist);
  $('#setKey').addEventListener('input', persist);
  $('#setProfileName').addEventListener('input', persist);
  $('#setProfile').addEventListener('change', event => { switchLlmProfile(event.target.value); });
  $('#profileNew').addEventListener('click', createLlmProfile);
  $('#profileDelete').addEventListener('click', deleteActiveLlmProfile);
  $('#settingsSave').addEventListener('click', saveWithLlmPermission);
  $('#settingsTest').addEventListener('click', testConnection);
  $('#setFixedTags').addEventListener('input', persistFixedTags);
  // 规则编辑完成并失焦后再保存，避免每次敲键都让已打开的侧边栏全量刷新。
  $('#setDomainTagRules').addEventListener('change', persistTagRules);
  $('#setKeywordTagRules').addEventListener('change', persistTagRules);
  $('#setStarHook').addEventListener('change', persistStarHook);
  $('#setAutoAiTag').addEventListener('change', persistAutoAiTag);
  $('#setTagSync').addEventListener('change', persistTagSync);
  load();
});

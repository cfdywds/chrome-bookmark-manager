import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const optionsSource = readFileSync(join(__dirname, '..', 'js', 'options.js'), 'utf-8').replace(/\r\n/g, '\n');
const optionsHtml = readFileSync(join(__dirname, '..', 'options.html'), 'utf-8');
const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf-8');

function getFunctionSource(name) {
  const asyncNeedle = `async function ${name}(`;
  const regularNeedle = `function ${name}(`;
  const asyncStart = optionsSource.indexOf(asyncNeedle);
  const start = asyncStart >= 0 ? asyncStart : optionsSource.indexOf(regularNeedle);
  const end = optionsSource.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return optionsSource.slice(start, end + 2).replace(
    asyncStart >= 0 ? `async function ${name}` : `function ${name}`,
    asyncStart >= 0 ? 'async function' : 'function'
  );
}

describe('LLM 多配置', () => {
  it('保留多条配置，并将旧 bmSettings 无损迁移为默认配置', () => {
    const PROVIDERS = {
      deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      custom: { base: '', model: '' }
    };
    let nextProfileId = 0;
    const createProfileId = eval(`(${getFunctionSource('createProfileId')})`);
    const normalizeLlmSettings = eval(`(${getFunctionSource('normalizeLlmSettings')})`);
    const defaultProfileName = eval(`(${getFunctionSource('defaultProfileName')})`);
    const createProfile = eval(`(${getFunctionSource('createProfile')})`);
    const normalizeLlmProfiles = eval(`(${getFunctionSource('normalizeLlmProfiles')})`);

    const profiles = normalizeLlmProfiles([
      { id: 'kimi', name: '公司 Kimi', provider: 'custom', baseUrl: 'https://kimi.example/v1', apiKey: 'key-kimi', model: 'kimi-k3' },
      { id: 'openai', name: '个人 OpenAI', provider: 'openai', baseUrl: 'https://proxy.example/v1', apiKey: 'key-openai', model: 'gpt-5' }
    ]);
    expect(profiles).toMatchObject([
      { id: 'kimi', name: '公司 Kimi', apiKey: 'key-kimi', model: 'kimi-k3' },
      { id: 'openai', name: '个人 OpenAI', apiKey: 'key-openai', model: 'gpt-5' }
    ]);

    const migrated = normalizeLlmProfiles(undefined, {
      provider: 'openai', baseUrl: 'https://legacy.example/v1', apiKey: 'legacy-key', model: 'gpt-4.1'
    });
    expect(migrated).toMatchObject([{
      name: '默认配置', provider: 'openai', baseUrl: 'https://legacy.example/v1', apiKey: 'legacy-key', model: 'gpt-4.1'
    }]);
    expect(migrated[0].id).toMatch(/^llm-/);
    expect(nextProfileId).toBe(1);

    let llmProfiles = profiles;
    let activeLlmProfileId = 'kimi';
    const activeLlmProfile = eval(`(${getFunctionSource('activeLlmProfile')})`);
    const profileSettings = eval(`(${getFunctionSource('profileSettings')})`);
    const mergeActiveLlmSettings = eval(`(${getFunctionSource('mergeActiveLlmSettings')})`);
    const external = mergeActiveLlmSettings({
      provider: 'custom', baseUrl: 'https://restored.example/v1', apiKey: 'restored-key', model: 'restored-model'
    });
    expect(external).toMatchObject({ id: 'kimi', apiKey: 'restored-key', model: 'restored-model' });
    expect(activeLlmProfile()).toMatchObject({ apiKey: 'restored-key', baseUrl: 'https://restored.example/v1' });
  });

  it('设置页提供配置切换入口，并移除敏感书签不发送的错误说明', () => {
    expect(optionsHtml).toContain('id="setProfile"');
    expect(optionsHtml).toContain('id="profileNew"');
    expect(optionsHtml).toContain('id="profileDelete"');
    expect(optionsHtml).toContain('id="setProfileName"');
    expect(optionsHtml).not.toContain('敏感书签（登录/银行/成人等）默认不发送');
    expect(optionsHtml).toContain('不会同步或发送给扩展开发者');
    expect(optionsSource).toContain("const LLM_PROFILES_KEY = 'bmLlmProfiles'");
    expect(optionsSource).toContain("const ACTIVE_LLM_PROFILE_KEY = 'bmActiveLlmProfileId'");
    expect(optionsSource).toContain('bmSettings: normalizeLlmSettings');
  });

  it('设置页会显示持久化的标签同步失败，文档说明标签可选同步', () => {
    expect(optionsSource).toContain('BM.SYNC_STATUS_KEY');
    expect(optionsSource).toContain('renderTagSyncStatus');
    expect(readme).toContain('固定标签池和自定义标签规则');
  });

  it('设置页说明原生书签同步，并明确排除 API Key', () => {
    const elements = { '#tagSyncSummary': { textContent: '' } };
    const $ = selector => elements[selector];
    const renderTagSyncDiagnostics = eval(`(${getFunctionSource('renderTagSyncDiagnostics')})`);

    renderTagSyncDiagnostics();

    expect(optionsHtml).toContain('id="tagSyncSummary"');
    expect(elements['#tagSyncSummary'].textContent).toBe('使用 Chrome 书签同步；无需相同扩展 ID');
    expect(readme).toContain('不包含 API Key');
  });


  it('标签同步成功时显示最近成功时间而不显示内容', () => {
    const elements = { '#tagSyncMsg': { textContent: '', className: '' } };
    const $ = selector => elements[selector];
    const renderTagSyncStatus = eval(`(${getFunctionSource('renderTagSyncStatus')})`);

    renderTagSyncStatus({ lastSuccessAt: 1767225600000, lastError: '' });

    expect(elements['#tagSyncMsg'].textContent).toContain('上次同步成功：');
    expect(elements['#tagSyncMsg'].className).toBe('settings-msg ok');
  });


  it('读取本地标签配置前先采用较新的云端配置', () => {
    expect(getFunctionSource('load')).toContain('await BM.initializeSyncedTagConfiguration();');
    expect(optionsSource).toContain('BM.watchTagConfiguration');
  });

  it('解析并展示域名与标题路径自定义规则', () => {
    const parseTagRuleMap = eval(`(${getFunctionSource('parseTagRuleMap')})`);
    const serializeTagRuleMap = eval(`(${getFunctionSource('serializeTagRuleMap')})`);
    expect(parseTagRuleMap('corp=工作,代码\n# 注释\n教程=学习，教程\n无效行')).toEqual({
      corp: ['工作', '代码'],
      教程: ['学习', '教程']
    });
    expect(serializeTagRuleMap({ corp: ['工作', '代码'] })).toBe('corp=工作,代码');
    expect(optionsHtml).toContain('id="setDomainTagRules"');
    expect(optionsHtml).toContain('id="setKeywordTagRules"');
    expect(optionsHtml).not.toContain('id="setDomainGroups"');
    expect(optionsSource).not.toContain('bmDomainGroups:');
    expect(getFunctionSource('persistSilent')).not.toContain('bmFixedTags');
    expect(getFunctionSource('persistSilent')).not.toContain('bmTagRules');
    expect(getFunctionSource('persistFixedTags')).toContain('BM.saveSyncedTagConfiguration');
    expect(getFunctionSource('persistTagRules')).toContain('BM.saveSyncedTagConfiguration');
    expect(optionsSource).not.toContain('chrome.storage.sync.set({ bmSettings');
    expect(optionsSource).toContain("$('#setDomainTagRules').addEventListener('change', persistTagRules)");
    expect(optionsSource).toContain("$('#setKeywordTagRules').addEventListener('change', persistTagRules)");
    expect(getFunctionSource('persistTagSync')).toContain('await BM.initializeSyncedTagConfiguration();');
    expect(optionsSource).not.toContain("$('#setDomainTagRules').addEventListener('input', persistTagRules)");
  });

  it('后台 AI 开启时为切换后的活动配置申请主机权限', async () => {
    const previousChrome = globalThis.chrome;
    const previousBM = globalThis.BM;
    const requestLlmHostPermission = vi.fn().mockResolvedValue(true);
    globalThis.chrome = { storage: { local: {
      get: vi.fn().mockResolvedValue({ bmAutoAiTag: true })
    } } };
    globalThis.BM = { requestLlmHostPermission };
    const ensureBackgroundAiPermission = eval(`(${getFunctionSource('ensureBackgroundAiPermission')})`);

    try {
      await ensureBackgroundAiPermission({
        baseUrl: 'https://new-llm.example/v1', apiKey: 'key', model: 'model'
      });
      expect(requestLlmHostPermission).toHaveBeenCalledWith('https://new-llm.example/v1');
      expect(getFunctionSource('switchLlmProfile')).toContain('commitActiveProfileState(llmProfiles, profile.id)');
      expect(getFunctionSource('createLlmProfile')).toContain('commitActiveProfileState([...llmProfiles, profile], profile.id)');
      expect(getFunctionSource('deleteActiveLlmProfile')).toContain('commitActiveProfileState(remaining, next.id)');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
      if (previousBM === undefined) delete globalThis.BM;
      else globalThis.BM = previousBM;
    }
  });

  it('活动配置权限或存储失败时保持原内存状态', async () => {
    const oldProfile = { id: 'old', baseUrl: 'https://old.example/v1', apiKey: 'old', model: 'old' };
    const newProfile = { id: 'new', baseUrl: 'https://new.example/v1', apiKey: 'new', model: 'new' };
    let llmProfiles = [oldProfile, newProfile];
    let activeLlmProfileId = 'old';
    let ensureBackgroundAiPermission = vi.fn().mockRejectedValue(new Error('拒绝权限'));
    const profileSettings = profile => profile;
    const renderProfileSelect = vi.fn();
    const fillForm = vi.fn();
    const activeLlmProfile = () => llmProfiles.find(profile => profile.id === activeLlmProfileId);
    let persistProfileState = vi.fn();
    const commitActiveProfileState = eval(`(${getFunctionSource('commitActiveProfileState')})`);

    await expect(commitActiveProfileState(llmProfiles, 'new')).rejects.toThrow('拒绝权限');
    expect(activeLlmProfileId).toBe('old');
    expect(persistProfileState).not.toHaveBeenCalled();
    expect(fillForm).toHaveBeenLastCalledWith(oldProfile);

    ensureBackgroundAiPermission = vi.fn().mockResolvedValue(true);
    persistProfileState = vi.fn().mockRejectedValue(new Error('存储失败'));
    const nextProfiles = [newProfile];
    await expect(commitActiveProfileState(nextProfiles, 'new')).rejects.toThrow('存储失败');
    expect(activeLlmProfileId).toBe('old');
    expect(llmProfiles).toEqual([oldProfile, newProfile]);
    expect(fillForm).toHaveBeenLastCalledWith(oldProfile);
  });

  it('补全新配置但权限被拒时保存配置并关闭后台 AI', async () => {
    const previousChrome = globalThis.chrome;
    const checkbox = { checked: true };
    const $ = () => checkbox;
    const formSettings = () => ({
      baseUrl: 'https://new.example/v1', apiKey: 'key', model: 'model'
    });
    const ensureBackgroundAiPermission = vi.fn().mockRejectedValue(new Error('拒绝权限'));
    const persistSilent = vi.fn().mockResolvedValue(undefined);
    const setMsg = vi.fn();
    const set = vi.fn().mockResolvedValue(undefined);
    globalThis.chrome = { storage: { local: { set } } };
    const persist = eval(`(${getFunctionSource('persist')})`);

    try {
      await persist();
      expect(ensureBackgroundAiPermission).toHaveBeenCalledWith(formSettings());
      expect(set).toHaveBeenCalledWith({ bmAutoAiTag: false });
      expect(checkbox.checked).toBe(false);
      expect(persistSilent).toHaveBeenCalledOnce();
      expect(setMsg).toHaveBeenCalledWith(expect.stringContaining('后台 AI'), 'err', false);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

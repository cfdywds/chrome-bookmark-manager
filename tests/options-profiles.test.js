import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const optionsSource = readFileSync(join(__dirname, '..', 'js', 'options.js'), 'utf-8').replace(/\r\n/g, '\n');
const optionsHtml = readFileSync(join(__dirname, '..', 'options.html'), 'utf-8');
const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf-8');

function getFunctionSource(name) {
  const start = optionsSource.indexOf(`function ${name}(`);
  const end = optionsSource.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error(`未找到函数 ${name}`);
  return optionsSource.slice(start, end + 2).replace(`function ${name}`, 'function');
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
    expect(readme).toContain('标签数据可通过 Chrome 同步');
  });
});

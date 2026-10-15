'use strict';
// OpenAI-compatible chat/completions transport. Credentials stay on the server.
function createClient(config = {}) {
  const baseURL = String(config.baseURL || '').replace(/\/+$/, '');
  const apiKey = config.apiKey || '';
  const model = config.model || '';
  const fetchImpl = config.fetchImpl || fetch;
  const timeoutMs = config.timeoutMs || 90000;
  function isAiEnabled() { return Boolean(baseURL && apiKey && model); }
  async function chat(messages, {system, maxTokens = 6000} = {}) {
    if (!isAiEnabled()) throw new Error('请配置 MODEL_BASE_URL、MODEL_API_KEY 和 MODEL_NAME');
    let response;
    try {
      response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
        body: JSON.stringify({model, messages: [...(system ? [{role:'system',content:system}] : []), ...messages], max_tokens:maxTokens, stream:false})
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('模型调用超时，请稍后重试');
      throw new Error('无法连接模型服务，请检查服务地址及网络');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('模型服务鉴权失败，请检查后端密钥及权限');
      if (response.status === 429) throw new Error('模型服务额度不足或请求过于频繁');
      throw new Error(`模型服务请求失败（HTTP ${response.status}）`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('模型服务响应格式不正确'); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型输出为空或不支持当前响应格式');
    return content;
  }
  return {chat, isAiEnabled};
}
const client = createClient({baseURL:process.env.MODEL_BASE_URL, apiKey:process.env.MODEL_API_KEY, model:process.env.MODEL_NAME});
module.exports = {...client, createClient};

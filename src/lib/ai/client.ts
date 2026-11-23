export type LLMProvider = 'openai' | 'gemini' | 'anthropic' | 'mock';

export interface StructuredLLMParams<T> {
  systemPrompt: string;
  userPrompt: string;
  parse: (raw: string) => T;
  fallback: () => T;
  timeoutMs?: number;
}

export interface StructuredLLMResult<T> {
  data: T;
  usedFallback: boolean;
  warning?: string;
  provider: string;
}

export const DEFAULT_LLM_TIMEOUT_MS = 15_000;

export const DEFAULT_MODELS: Record<Exclude<LLMProvider, 'mock'>, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-5-5',
};

const FALLBACK_SUFFIX = 'fell back to the deterministic heuristic — please review carefully.';

type LiveProvider = Exclude<LLMProvider, 'mock'>;

interface ProviderConfig {
  provider: LiveProvider;
  apiKey: string;
  model: string;
}

type ProviderResolution =
  { kind: 'live'; config: ProviderConfig } | { kind: 'mock'; warning: string };

const KEY_ENV: Record<LiveProvider, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function resolveProvider(): ProviderResolution {
  const requested = readEnv('LLM_PROVIDER')?.toLowerCase() ?? 'mock';

  if (requested === 'mock') {
    return {
      kind: 'mock',
      warning: `No live LLM configured (LLM_PROVIDER=mock); ${FALLBACK_SUFFIX}`,
    };
  }

  if (requested !== 'openai' && requested !== 'gemini' && requested !== 'anthropic') {
    return {
      kind: 'mock',
      warning: `Unknown LLM_PROVIDER "${requested}"; ${FALLBACK_SUFFIX}`,
    };
  }

  const apiKey = readEnv(KEY_ENV[requested]);
  if (!apiKey) {
    return {
      kind: 'mock',
      warning: `LLM_PROVIDER=${requested} but ${KEY_ENV[requested]} is not set; ${FALLBACK_SUFFIX}`,
    };
  }

  const modelEnv = `${requested.toUpperCase()}_MODEL`;
  return {
    kind: 'live',
    config: { provider: requested, apiKey, model: readEnv(modelEnv) ?? DEFAULT_MODELS[requested] },
  };
}

interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  extractText: (json: unknown) => string;
}

function buildRequest(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
): HttpRequest {
  switch (config.provider) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: {
          model: config.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
        extractText: (json) => {
          const content = (json as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
            ?.message?.content;
          return typeof content === 'string' ? content : '';
        },
      };
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        headers: { 'x-goog-api-key': config.apiKey },
        body: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        },
        extractText: (json) => {
          const parts = (json as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })
            .candidates?.[0]?.content?.parts;
          return (parts ?? [])
            .map((part) => (typeof part.text === 'string' ? part.text : ''))
            .join('');
        },
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model: config.model,
          max_tokens: 4096,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        extractText: (json) => {
          const blocks = (json as { content?: { type?: string; text?: unknown }[] }).content;
          return (blocks ?? [])
            .map((block) =>
              block.type === 'text' && typeof block.text === 'string' ? block.text : '',
            )
            .join('');
        },
      };
  }
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('response did not contain a JSON object');
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('response JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

class LLMCallError extends Error {}

async function callProvider(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<string> {
  const request = buildRequest(config, systemPrompt, userPrompt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new LLMCallError(`returned HTTP ${response.status}`);
    }
    const text = request.extractText(await response.json());
    if (!text.trim()) {
      throw new LLMCallError('returned an empty response');
    }
    return text;
  } catch (error) {
    if (error instanceof LLMCallError) throw error;
    if (controller.signal.aborted) {
      throw new LLMCallError(`timed out after ${timeoutMs}ms`);
    }
    throw new LLMCallError('was unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the configured LLM provider and parses its reply. Never throws: any missing key,
 * network/HTTP failure, timeout, or unparseable reply returns `fallback()` with a warning.
 */
export async function callStructuredLLM<T>(
  params: StructuredLLMParams<T>,
): Promise<StructuredLLMResult<T>> {
  const resolution = resolveProvider();
  if (resolution.kind === 'mock') {
    return {
      data: params.fallback(),
      usedFallback: true,
      warning: resolution.warning,
      provider: 'mock',
    };
  }

  const { config } = resolution;
  const label = `${config.provider} (${config.model})`;
  let raw: string;
  try {
    raw = await callProvider(
      config,
      params.systemPrompt,
      params.userPrompt,
      params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'failed';
    return {
      data: params.fallback(),
      usedFallback: true,
      warning: `LLM unavailable: ${label} ${reason}; ${FALLBACK_SUFFIX}`,
      provider: config.provider,
    };
  }

  try {
    return { data: params.parse(raw), usedFallback: false, provider: config.provider };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parse error';
    return {
      data: params.fallback(),
      usedFallback: true,
      warning: `LLM returned invalid JSON or an unusable answer (${label}: ${reason}); ${FALLBACK_SUFFIX}`,
      provider: config.provider,
    };
  }
}

/**
 * Execution routes, tried in order: Translator → Proofreader → Rewriter → Prompt.
 *
 * Each returns `null` when its API is absent or its preset does not ask for it,
 * so the chain degrades gracefully on builds where Writer/Rewriter/Proofreader
 * are still behind an origin trial. Every preset carries a `prompt`, which is
 * why the last link always catches.
 */

import { t } from "../../shared/i18n.ts";
import { baseLanguage } from "../../shared/rules.ts";
import type { DetectedLanguage } from "../../shared/messages.ts";
import type { Preset } from "../presets.ts";
import { availabilityOf, isSupported, resolveGlobal } from "./availability.ts";
import { exceedsQuota } from "./limits.ts";
import {
  PROMPT_KEY,
  collect,
  downloadMonitor,
  useSession,
  warmCache,
  type Post,
} from "./sessions.ts";

export interface ExecutionContext {
  preset: Preset;
  text: string;
  language: DetectedLanguage | null;
  post: Post;
  signal: AbortSignal;
}

type Route = (context: ExecutionContext) => Promise<string | null>;

// ---------------------------------------------------------------------------
// Translator
// ---------------------------------------------------------------------------

interface TranslatorApi {
  create(options: unknown): Promise<{
    translate(
      text: string,
      options?: { signal?: AbortSignal },
    ): Promise<string>;
    translateStreaming?(
      text: string,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<string>;
  }>;
}

const viaTranslator: Route = async ({
  preset,
  text,
  language,
  post,
  signal,
}) => {
  const api = resolveGlobal<TranslatorApi>("Translator");
  if (!api || !preset.translator) return null;

  const source = baseLanguage(language?.code);
  const target = preset.translator.targetLanguage;
  if (!source) throw new Error(t("errUnknownLanguage"));
  if (source === target) throw new Error(t("errAlreadyEnglish"));

  const config = { sourceLanguage: source, targetLanguage: target };
  const state = await availabilityOf(api, config);
  if (!isSupported(state))
    throw new Error(t("errNoPack", [language?.name ?? source]));

  const first = state === "downloadable";
  if (first) post({ type: "status", text: t("statusFirstPack") });

  // Translation packs are per language pair and much smaller than the model.
  return useSession(
    `translator:${JSON.stringify(config)}`,
    () =>
      api.create({
        ...config,
        monitor: downloadMonitor(post, first, "assetTranslationPack"),
      }),
    (translator) =>
      typeof translator.translateStreaming === "function"
        ? collect(translator.translateStreaming(text, { signal }), post, signal)
        : translator.translate(text, { signal }),
    post,
  );
};

// ---------------------------------------------------------------------------
// Proofreader
// ---------------------------------------------------------------------------

interface ProofreadResult {
  correctedInput?: string;
  corrected?: string;
  correction?: string;
}

interface ProofreaderApi {
  create(options: unknown): Promise<{
    proofread(text: string): Promise<ProofreadResult | string>;
  }>;
}

/**
 * Spelling and punctuation: in English for the `english` preset, in whatever the
 * user is writing for `typos`. The result shape moved between drafts of the
 * spec, so accept whichever field carries the corrected string.
 */
const viaProofreader: Route = async ({ preset, text, language, post }) => {
  const api = resolveGlobal<ProofreaderApi>("Proofreader");
  if (!api || !preset.proofread) return null;

  const wanted = preset.proofread.language;
  const lang = wanted === "detected" ? baseLanguage(language?.code) : wanted;
  if (!lang) return null; // unknown language: let the Prompt route handle it

  const config = { expectedInputLanguages: [lang] };
  const state = await availabilityOf(api, config);
  if (!isSupported(state)) return null;

  const first = state === "downloadable";
  if (first) post({ type: "status", text: t("statusFirstModel") });

  const result = await useSession(
    `proofreader:${JSON.stringify(config)}`,
    () => api.create({ ...config, monitor: downloadMonitor(post, first) }),
    (proofreader) => proofreader.proofread(text),
    post,
  );

  if (typeof result === "string") return result;
  return (
    result?.correctedInput ?? result?.corrected ?? result?.correction ?? null
  );
};

// ---------------------------------------------------------------------------
// Rewriter
// ---------------------------------------------------------------------------

interface RewriterApi {
  create(options: unknown): Promise<{
    rewrite(text: string, options?: { signal?: AbortSignal }): Promise<string>;
    rewriteStreaming?(
      text: string,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<string>;
  }>;
}

const SHARED_CONTEXT =
  "Short comment written in a web form, often on a software pull request. " +
  "Preserve code identifiers, paths and command names exactly as written.";

const viaRewriter: Route = async ({ preset, text, post, signal }) => {
  const api = resolveGlobal<RewriterApi>("Rewriter");
  if (!api || !preset.rewriter) return null;

  const config = {
    ...preset.rewriter,
    format: "plain-text",
    sharedContext: SHARED_CONTEXT,
  };
  const state = await availabilityOf(api, config);
  if (!isSupported(state)) return null;

  const first = state === "downloadable";
  if (first) post({ type: "status", text: t("statusFirstModel") });

  // A Rewriter carries no conversation state, so one instance serves every run.
  return useSession(
    `rewriter:${JSON.stringify(config)}`,
    () => api.create({ ...config, monitor: downloadMonitor(post, first) }),
    (rewriter) =>
      typeof rewriter.rewriteStreaming === "function"
        ? collect(rewriter.rewriteStreaming(text, { signal }), post, signal)
        : rewriter.rewrite(text, { signal }),
    post,
  );
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

interface PromptSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming?(
    input: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<string>;
  clone?(): Promise<PromptSession>;
  destroy?(): void;
  measureInputUsage?(input: string): Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
}

interface LanguageModelApi {
  create(options: unknown): Promise<PromptSession>;
}

const SYSTEM_PROMPT =
  "You rewrite short pieces of text a person has typed into a web form. You " +
  "never add facts, never soften a technical claim into vagueness, and never " +
  "translate. Output the rewritten text and nothing else: no preamble, no " +
  "quotes, no explanation.";

const promptFactory =
  (api: LanguageModelApi, post: Post, first: boolean) => () =>
    api.create({
      monitor: downloadMonitor(post, first),
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    });

const viaPrompt: Route = async ({ preset, text, post, signal }) => {
  const api = resolveGlobal<LanguageModelApi>("LanguageModel");
  if (!api || !preset.prompt) return null;

  const state = await availabilityOf(api);
  if (!isSupported(state)) return null;

  const first = state === "downloadable";
  if (first) post({ type: "status", text: t("statusFirstModel") });

  const input = `${preset.prompt}\n\n---\n${text}\n---`;

  // The base session is cached so the model stays loaded, but a LanguageModel
  // accumulates turns: prompting it directly would feed every past rewrite back
  // in and eventually exhaust the context. Clone per request, discard the clone,
  // keep the loaded base.
  return useSession(
    PROMPT_KEY,
    promptFactory(api, post, first),
    async (base) => {
      if (await exceedsQuota(base, input)) throw new Error(t("errTooLong"));
      const session =
        typeof base.clone === "function" ? await base.clone() : base;
      try {
        if (typeof session.promptStreaming === "function") {
          return await collect(
            session.promptStreaming(input, { signal }),
            post,
            signal,
          );
        }
        return await session.prompt(input, { signal });
      } finally {
        if (session !== base) session.destroy?.();
      }
    },
    post,
  );
};

// ---------------------------------------------------------------------------

const ROUTES: Route[] = [viaTranslator, viaProofreader, viaRewriter, viaPrompt];

/** `null` when no route could run at all — i.e. built-in AI is unavailable. */
export async function execute(
  context: ExecutionContext,
): Promise<string | null> {
  for (const route of ROUTES) {
    const result = await route(context);
    if (result != null) return result;
    if (context.signal.aborted) return null;
  }
  return null;
}

/**
 * Loads the model without spending a generation on it, so the first real rewrite
 * starts warm. A worker has no user activation and therefore cannot reliably
 * start the initial download — that is left to the popup, which has a real click
 * behind it, so this reports `downloadable` instead of hanging.
 */
export async function warmUp(
  post: Post,
): Promise<"ready" | "downloadable" | "unavailable"> {
  const api = resolveGlobal<LanguageModelApi>("LanguageModel");
  if (!api) return "unavailable";
  const state = await availabilityOf(api);
  if (!isSupported(state)) return "unavailable";
  if (state === "downloadable") return "downloadable";
  await warmCache(PROMPT_KEY, promptFactory(api, post, false));
  return "ready";
}

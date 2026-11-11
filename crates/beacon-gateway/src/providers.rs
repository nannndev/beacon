use serde::Serialize;

pub const OPENAI: &str = "openai";
pub const ANTHROPIC: &str = "anthropic";

#[derive(Debug, Clone, Serialize)]
pub struct Provider {
    pub id: &'static str,
    pub alias: &'static str,
    pub name: &'static str,
    pub family: &'static str,
    pub base_url: &'static str,
    pub needs_key: bool,
    pub seed_models: &'static [&'static str],
}

pub static PROVIDERS: &[Provider] = &[
    Provider {
        id: "openai",
        alias: "oa",
        name: "OpenAI",
        family: OPENAI,
        base_url: "https://api.openai.com/v1",
        needs_key: true,
        seed_models: &[
            "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.1",
            "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o",
            "gpt-4o-mini", "o3", "o3-mini", "o3-pro", "o4-mini", "o1",
            "o1-mini", "gpt-4-turbo",
        ],
    },
    Provider {
        id: "anthropic",
        alias: "an",
        name: "Anthropic Claude",
        family: ANTHROPIC,
        base_url: "https://api.anthropic.com/v1",
        needs_key: true,
        seed_models: &[
            "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
            "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5",
            "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
        ],
    },
    Provider {
        id: "deepseek",
        alias: "ds",
        name: "DeepSeek",
        family: OPENAI,
        base_url: "https://api.deepseek.com/v1",
        needs_key: true,
        seed_models: &[
            "deepseek-v4-pro", "deepseek-v4.1-flash", "deepseek-v4-flash",
            "deepseek-chat", "deepseek-reasoner",
        ],
    },
    Provider {
        id: "gemini",
        alias: "gm",
        name: "Google Gemini",
        family: OPENAI,
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        needs_key: true,
        seed_models: &[
            "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview",
            "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash",
        ],
    },
    Provider {
        id: "openrouter",
        alias: "or",
        name: "OpenRouter",
        family: OPENAI,
        base_url: "https://openrouter.ai/api/v1",
        needs_key: true,
        seed_models: &[
            "auto", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct",
            "anthropic/claude-3.5-sonnet",
        ],
    },
    Provider {
        id: "groq",
        alias: "gq",
        name: "Groq",
        family: OPENAI,
        base_url: "https://api.groq.com/openai/v1",
        needs_key: true,
        seed_models: &["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    },
    Provider {
        id: "mistral",
        alias: "ms",
        name: "Mistral AI",
        family: OPENAI,
        base_url: "https://api.mistral.ai/v1",
        needs_key: true,
        seed_models: &["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    },
    Provider {
        id: "together",
        alias: "tg",
        name: "Together AI",
        family: OPENAI,
        base_url: "https://api.together.xyz/v1",
        needs_key: true,
        seed_models: &["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3"],
    },
    Provider {
        id: "xai",
        alias: "xa",
        name: "xAI (Grok)",
        family: OPENAI,
        base_url: "https://api.x.ai/v1",
        needs_key: true,
        seed_models: &["grok-beta", "grok-2-1212", "grok-2-vision-1212"],
    },
    Provider {
        id: "cohere",
        alias: "co",
        name: "Cohere",
        family: OPENAI,
        base_url: "https://api.cohere.com/v2",
        needs_key: true,
        seed_models: &["command-r-plus-08-2024", "command-r-08-2024"],
    },
    Provider {
        id: "fireworks",
        alias: "fw",
        name: "Fireworks AI",
        family: OPENAI,
        base_url: "https://api.fireworks.ai/inference/v1",
        needs_key: true,
        seed_models: &["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    },
    Provider {
        id: "perplexity",
        alias: "pp",
        name: "Perplexity",
        family: OPENAI,
        base_url: "https://api.perplexity.ai",
        needs_key: true,
        seed_models: &["sonar-pro", "sonar", "sonar-reasoning"],
    },
    Provider {
        id: "cerebras",
        alias: "cb",
        name: "Cerebras",
        family: OPENAI,
        base_url: "https://api.cerebras.ai/v1",
        needs_key: true,
        seed_models: &["llama3.3-70b", "llama3.1-8b"],
    },
    Provider {
        id: "hyperbolic",
        alias: "hb",
        name: "Hyperbolic",
        family: OPENAI,
        base_url: "https://api.hyperbolic.xyz/v1",
        needs_key: true,
        seed_models: &["meta-llama/Llama-3.3-70B-Instruct", "deepseek-ai/DeepSeek-V3"],
    },
    Provider {
        id: "sambanova",
        alias: "sn",
        name: "SambaNova",
        family: OPENAI,
        base_url: "https://api.sambanova.ai/v1",
        needs_key: true,
        seed_models: &["Meta-Llama-3.3-70B-Instruct", "Qwen2.5-Coder-32B-Instruct"],
    },
    Provider {
        id: "novita",
        alias: "nv",
        name: "Novita AI",
        family: OPENAI,
        base_url: "https://api.novita.ai/v3/openai",
        needs_key: true,
        seed_models: &["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-v3"],
    },
    Provider {
        id: "siliconflow",
        alias: "sf",
        name: "SiliconFlow",
        family: OPENAI,
        base_url: "https://api.siliconflow.cn/v1",
        needs_key: true,
        seed_models: &["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
    },
    Provider {
        id: "github",
        alias: "gh_api",
        name: "GitHub Models (Token)",
        family: OPENAI,
        base_url: "https://models.inference.ai.azure.com",
        needs_key: true,
        seed_models: &["gpt-4o", "gpt-4o-mini", "Phi-3.5-mini-instruct"],
    },
    Provider {
        id: "ollama",
        alias: "ol",
        name: "Ollama (Local)",
        family: OPENAI,
        base_url: "http://localhost:11434/v1",
        needs_key: false,
        seed_models: &["llama3.2", "qwen2.5-coder", "mistral", "deepseek-r1"],
    },
    Provider {
        id: "azure-openai",
        alias: "az",
        name: "Azure OpenAI",
        family: OPENAI,
        base_url: "",
        needs_key: true,
        seed_models: &["gpt-4o", "gpt-4o-mini"],
    },
    Provider {
        id: "aws-bedrock",
        alias: "bd",
        name: "AWS Bedrock",
        family: ANTHROPIC,
        base_url: "",
        needs_key: true,
        seed_models: &["anthropic.claude-3-5-sonnet-20241022-v2:0"],
    },
];

#[derive(Debug, Clone, Serialize)]
pub struct OAuthProviderMeta {
    pub id: &'static str,
    pub alias: &'static str,
    pub name: &'static str,
    pub plan: &'static str,
    pub flow: &'static str,
    pub family: &'static str,
    pub default_model: &'static str,
    pub default_model_free: &'static str,
    pub preferred_auto: &'static [&'static str],
    pub preferred_auto_free: &'static [&'static str],
    pub seed_models: &'static [&'static str],
}

pub static OAUTH_PROVIDERS: &[OAuthProviderMeta] = &[
    OAuthProviderMeta {
        id: "claude",
        alias: "cc",
        name: "Claude",
        plan: "Pro / Max",
        flow: "redirect",
        family: "anthropic",
        default_model: "claude-sonnet-5-5",
        default_model_free: "claude-3-5-haiku-20241022",
        preferred_auto: &["claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"],
        preferred_auto_free: &["claude-3-5-haiku-20241022", "claude-haiku-4-5"],
        seed_models: &[
            "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
            "claude-opus-5", "claude-sonnet-5", "claude-opus-4-6",
            "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-haiku-4-5",
            "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022",
        ],
    },
    OAuthProviderMeta {
        id: "codex",
        alias: "cx",
        name: "ChatGPT / Codex",
        plan: "Plus / Pro",
        flow: "redirect",
        family: "codex",
        default_model: "gpt-5.6-terra",
        default_model_free: "gpt-5-mini",
        preferred_auto: &[
            "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol",
            "gpt-6-sol", "gpt-6.1-terra", "gpt-6.1-sol",
        ],
        preferred_auto_free: &[
            "gpt-5-mini", "gpt-4o-mini", "gpt-4o",
        ],
        seed_models: &[
            "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol",
            "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
            "gpt-5-mini", "gpt-4o", "gpt-4o-mini",
        ],
    },
    OAuthProviderMeta {
        id: "copilot",
        alias: "gh",
        name: "GitHub Copilot",
        plan: "Individual / Business",
        flow: "device",
        family: "openai",
        default_model: "gpt-4.1",
        default_model_free: "gpt-4o-mini",
        preferred_auto: &["gpt-4.1", "gpt-4o", "gpt-4o-mini", "gpt-5-mini", "gpt-5.5"],
        preferred_auto_free: &["gpt-4o-mini", "gpt-4o"],
        seed_models: &[
            "gpt-5.5", "gpt-5.4", "gpt-5-mini", "gpt-4.1", "gpt-4o",
            "o3-mini", "claude-sonnet-5.5", "claude-opus-5.5",
            "claude-haiku-5.5", "gemini-3.8-flash",
        ],
    },
    OAuthProviderMeta {
        id: "gemini-cli",
        alias: "gc",
        name: "Gemini CLI (Google)",
        plan: "Google / Code Assist",
        flow: "redirect",
        family: "gemini",
        default_model: "gemini-2.5-flash",
        default_model_free: "gemini-2.5-flash-lite",
        preferred_auto: &["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"],
        preferred_auto_free: &["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"],
        seed_models: &[
            "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview",
            "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash",
        ],
    },
    OAuthProviderMeta {
        id: "kimi",
        alias: "km",
        name: "Kimi Code",
        plan: "Membership",
        flow: "device",
        family: "openai",
        default_model: "kimi-for-coding",
        default_model_free: "kimi-for-coding",
        preferred_auto: &["kimi-for-coding", "kimi-for-coding-highspeed", "k3"],
        preferred_auto_free: &["kimi-for-coding"],
        seed_models: &["kimi-for-coding", "kimi-for-coding-highspeed", "k3"],
    },
    OAuthProviderMeta {
        id: "muse",
        alias: "mu",
        name: "Muse Code (Meta)",
        plan: "Subscription",
        flow: "device",
        family: "openai",
        default_model: "muse-spark-1.3",
        default_model_free: "muse-spark-1.1",
        preferred_auto: &["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"],
        preferred_auto_free: &["muse-spark-1.1", "muse-spark-1.2"],
        seed_models: &["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"],
    },
    OAuthProviderMeta {
        id: "nous",
        alias: "ns",
        name: "Nous Research",
        plan: "Portal / Inference",
        flow: "device",
        family: "openai",
        default_model: "meituan/longcat-2.0:free",
        default_model_free: "meituan/longcat-2.0:free",
        preferred_auto: &["meituan/longcat-2.0:free", "stepfun/step-5-preview:free"],
        preferred_auto_free: &["meituan/longcat-2.0:free", "stepfun/step-5-preview:free"],
        seed_models: &[
            "meituan/longcat-2.0:free", "stepfun/step-5-preview:free",
            "upstage/solar-mini4:free", "poolside/laguna-s-2.1:free",
        ],
    },
    OAuthProviderMeta {
        id: "kilocode",
        alias: "kc",
        name: "Kilo Code",
        plan: "Credits / Free models",
        flow: "device",
        family: "openai",
        default_model: "openrouter/free",
        default_model_free: "openrouter/free",
        preferred_auto: &[
            "openrouter/free",
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
            "cohere/north-mini-code:free",
        ],
        preferred_auto_free: &[
            "openrouter/free",
            "cohere/north-mini-code:free",
        ],
        seed_models: &[
            "anthropic/claude-sonnet-4-20250514", "anthropic/claude-opus-4-20250514",
            "google/gemini-2.5-pro", "google/gemini-2.5-flash",
            "openai/gpt-4.1", "openai/o3", "deepseek/deepseek-chat",
        ],
    },
];

pub fn find_provider_by_id(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

pub fn find_provider_by_alias(alias: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.alias == alias)
}

pub fn find_oauth_by_id(id: &str) -> Option<&'static OAuthProviderMeta> {
    OAUTH_PROVIDERS.iter().find(|p| p.id == id)
}

pub fn find_oauth_by_alias(alias: &str) -> Option<&'static OAuthProviderMeta> {
    OAUTH_PROVIDERS.iter().find(|p| p.alias == alias)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub provider: String,
    pub model: String,
    pub kind: String, // "apikey" or "oauth"
}

impl Target {
    pub fn public(&self) -> String {
        if let Some(op) = find_oauth_by_id(&self.provider) {
            format!("{}/{}", op.alias, self.model)
        } else if let Some(p) = find_provider_by_id(&self.provider) {
            format!("{}/{}", p.alias, self.model)
        } else {
            format!("{}/{}", self.provider, self.model)
        }
    }
}

pub fn parse_model_string(model_str: &str) -> Result<Target, String> {
    let s = model_str.trim();
    if let Some((alias, model)) = s.split_once('/') {
        if let Some(op) = find_oauth_by_alias(alias) {
            return Ok(Target {
                provider: op.id.to_string(),
                model: model.to_string(),
                kind: "oauth".to_string(),
            });
        }
        if let Some(p) = find_provider_by_alias(alias) {
            return Ok(Target {
                provider: p.id.to_string(),
                model: model.to_string(),
                kind: "apikey".to_string(),
            });
        }
        if let Some(op) = find_oauth_by_id(alias) {
            return Ok(Target {
                provider: op.id.to_string(),
                model: model.to_string(),
                kind: "oauth".to_string(),
            });
        }
        if let Some(p) = find_provider_by_id(alias) {
            return Ok(Target {
                provider: p.id.to_string(),
                model: model.to_string(),
                kind: "apikey".to_string(),
            });
        }
    }
    Err(format!("Unrecognized model format: {}", model_str))
}

import React from 'react'

export interface ProviderLogoProps {
  provider: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | number
  className?: string
  badge?: boolean
}

const SIZES = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 28,
}

export function ProviderLogo({ provider, size = 'sm', className = '', badge = false }: ProviderLogoProps) {
  const norm = (provider || '').toLowerCase().trim()
  const px = typeof size === 'number' ? size : SIZES[size] || 18

  // Normalize provider alias or full id
  const getLogo = () => {
    // OpenAI / Codex
    if (norm === 'openai' || norm === 'codex' || norm === 'oa' || norm === 'cx' || norm.startsWith('gpt') || norm.startsWith('o1') || norm.startsWith('o3') || norm.startsWith('o4')) {
      return {
        bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        color: '#10A37F',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18 5.98 5.98 0 0 0 .98 7.08a6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76c.24-.14.39-.4.39-.68v-6.74l2.02 1.17c.02.01.04.03.04.05v5.59a4.5 4.5 0 0 1-4.49 4.49zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.15.08 4.78 2.76c.24.14.54.14.78 0l5.84-3.37v2.33c0 .03-.01.05-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.68c0 .28.15.54.39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.85L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.79.79 0 0 0-.4.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
          </svg>
        ),
      }
    }

    // Anthropic / Claude
    if (norm === 'anthropic' || norm === 'claude' || norm === 'an' || norm === 'cc') {
      return {
        bg: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        color: '#D97706',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 14.5h-2v-5h2v5zm0-7h-2V7.5h2v2z" opacity="0.1" />
            <path d="M17.47 6.53a1 1 0 0 0-1.41 0L12 10.59 7.94 6.53a1 1 0 0 0-1.41 1.41L10.59 12l-4.06 4.06a1 1 0 0 0 1.41 1.41L12 13.41l4.06 4.06a1 1 0 0 0 1.41-1.41L13.41 12l4.06-4.06a1 1 0 0 0 0-1.41z" opacity="0" />
            <path d="M4.5 19.5L12 4.5l7.5 15h-3.4l-1.6-3.5H9.5L7.9 19.5H4.5zm5.9-6.3h3.2L12 8.7l-1.6 4.5z" />
          </svg>
        ),
      }
    }

    // Google Gemini
    if (norm === 'gemini' || norm === 'google' || norm === 'gm') {
      return {
        bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        color: '#3B82F6',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 0c-.3 6.6-5.4 11.7-12 12 6.6.3 11.7 5.4 12 12 .3-6.6 5.4-11.7 12-12-6.6-.3-11.7-5.4-12-12z" />
          </svg>
        ),
      }
    }

    // DeepSeek
    if (norm === 'deepseek' || norm === 'ds') {
      return {
        bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
        color: '#06B6D4',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M18.8 8.4C17.3 5.3 14 3.2 10.2 3.2c-5.2 0-9.4 4.1-9.4 9.2 0 4.1 2.7 7.6 6.5 8.7-.3-.8-.5-1.7-.5-2.6 0-3.6 2.8-6.6 6.4-6.8 1.9-.1 3.7.6 5 1.8.4-.7.6-1.5.6-2.4 0-.9-.3-1.8-.8-2.7zm2.4 4.5c-.3 1.2-1 2.3-2 3.1 1.2.6 2.1 1.6 2.6 2.9.2-.6.3-1.3.3-2 0-1.5-.4-2.8-.9-4z" />
          </svg>
        ),
      }
    }

    // GitHub Copilot
    if (norm === 'copilot' || norm === 'github' || norm === 'gh') {
      return {
        bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        color: '#A855F7',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        ),
      }
    }

    // Groq
    if (norm === 'groq' || norm === 'gq') {
      return {
        bg: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        color: '#F55036',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.8h-2v-4.2h2zm2.5-6.3h-7V7.9h7z" />
          </svg>
        ),
      }
    }

    // Mistral AI
    if (norm === 'mistral' || norm === 'ms') {
      return {
        bg: 'bg-amber-600/10 text-amber-500 border-amber-600/20',
        color: '#FD6F00',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M3 3h4v4H3zm14 0h4v4h-4zm-7 5h4v4h-4zM3 12h4v4H3zm14 0h4v4h-4zm-7 5h4v4h-4zM3 17h4v4H3zm14 0h4v4h-4z" />
          </svg>
        ),
      }
    }

    // Ollama
    if (norm === 'ollama' || norm === 'ol') {
      return {
        bg: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20',
        color: '#E4E4E7',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M9 3a2 2 0 0 0-2 2v2H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-4h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V5a2 2 0 0 0-2-2H9zm0 2h6v4H9V5zm-1 8h2v2H8v-2zm6 0h2v2h-2v-2z" />
          </svg>
        ),
      }
    }

    // Perplexity
    if (norm === 'perplexity' || norm === 'pplx' || norm === 'px') {
      return {
        bg: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
        color: '#20B2AA',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 3.3l5.3 3.3L12 12 6.7 8.6 12 5.3zm-6 4.7l5 3.2v5.7l-5-3.1V10zm12 5.8l-5 3.1v-5.7l5-3.2v5.8z" />
          </svg>
        ),
      }
    }

    // Moonshot Kimi
    if (norm === 'kimi' || norm === 'moonshot' || norm === 'km') {
      return {
        bg: 'bg-blue-600/10 text-blue-500 border-blue-600/20',
        color: '#2563EB',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M4 4h4v16H4V4zm6 8l7-8h5l-7.5 8.5L22 20h-5l-5.5-6.5L10 15v5h-4V4h4v8z" />
          </svg>
        ),
      }
    }

    // MiniMax / Muse
    if (norm === 'muse' || norm === 'minimax' || norm === 'mm') {
      return {
        bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        color: '#6366F1',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M4 18V6h3l5 6 5-6h3v12h-3v-7l-5 6-5-6v7H4z" />
          </svg>
        ),
      }
    }

    // xAI / Grok
    if (norm === 'xai' || norm === 'grok') {
      return {
        bg: 'bg-zinc-500/10 text-foreground border-zinc-500/20',
        color: 'currentColor',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        ),
      }
    }

    // Cohere
    if (norm === 'cohere' || norm === 'ch') {
      return {
        bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        color: '#F43F5E',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 4a6 6 0 1 1-6 6 6 6 0 0 1 6-6z" />
          </svg>
        ),
      }
    }

    // Together AI
    if (norm === 'together' || norm === 'tg') {
      return {
        bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        color: '#0F62FE',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <circle cx="7" cy="8" r="4" />
            <circle cx="17" cy="8" r="4" />
            <circle cx="12" cy="16" r="4" />
          </svg>
        ),
      }
    }

    // OpenRouter
    if (norm === 'openrouter' || norm === 'or') {
      return {
        bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        color: '#6366F1',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 3a9 9 0 0 0-9 9c0 4.1 2.7 7.5 6.5 8.6v-2.2A6.9 6.9 0 0 1 5.2 12a6.8 6.8 0 1 1 13.6 0c0 2.9-1.8 5.3-4.3 6.3v2.2c3.8-1.1 6.5-4.5 6.5-8.5a9 9 0 0 0-9-9zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </svg>
        ),
      }
    }

    // Microsoft Azure
    if (norm.includes('azure')) {
      return {
        bg: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
        color: '#0078D4',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M13.2 2.5L5.5 16.8l5.8 4.7 7.2-12.7zm-2.8 14.8l2.9 2.4-7.8 1.8z" />
          </svg>
        ),
      }
    }

    // AWS Bedrock
    if (norm.includes('bedrock') || norm.includes('aws')) {
      return {
        bg: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        color: '#FF9900',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.5l6.5 3.6-6.5 3.6-6.5-3.6L12 4.5zM5 8.8l6 3.3v6.7l-6-3.3V8.8zm8 10V12.1l6-3.3v6.7l-6 3.3z" />
          </svg>
        ),
      }
    }

    // Meta Llama
    if (norm.includes('llama') || norm.includes('meta')) {
      return {
        bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        color: '#0081FB',
        svg: (
          <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
            <path d="M16.5 5.5A5.5 5.5 0 0 0 12 8.1 5.5 5.5 0 0 0 7.5 5.5 5.5 5.5 0 0 0 2 11c0 4.2 4.4 7.5 10 7.5s10-3.3 10-7.5a5.5 5.5 0 0 0-5.5-5.5zm0 8.5c-2.4 0-4.5-1.3-4.5-3s2.1-3 4.5-3 4.5 1.3 4.5 3-2.1 3-4.5 3zm-9 0c-2.4 0-4.5-1.3-4.5-3s2.1-3 4.5-3 4.5 1.3 4.5 3-2.1 3-4.5 3z" />
          </svg>
        ),
      }
    }

    // Fallback AI icon
    return {
      bg: 'bg-muted text-muted-foreground border-border',
      color: 'currentColor',
      svg: (
        <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3m-3.5-6.5l-2.1 2.1m-8.8 8.8l-2.1 2.1m0-13l2.1 2.1m8.8 8.8l2.1 2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ),
    }
  }

  const { bg, svg } = getLogo()

  if (badge) {
    return (
      <span className={`inline-flex items-center justify-center rounded-md border p-1 shadow-xs shrink-0 ${bg} ${className}`}>
        {svg}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center justify-center shrink-0 ${className}`}>
      {svg}
    </span>
  )
}


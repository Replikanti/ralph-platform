generator target {
  output_type typescript
  output_dir ".."
  version "0.219.0"
  default_client_mode async
}

// Connects to the local BAML proxy which translates OpenAI-format requests
// to Claude CLI invocations (preserving flat-rate Claude Max subscription).
// Set BAML_PROXY_URL env var to override (default: http://localhost:3001/v1)

client<llm> ClaudeSonnet {
  provider openai-generic
  options {
    base_url env.BAML_PROXY_URL
    model "claude-sonnet-4-5-20250929"
    api_key "ralph-internal"
    supports_streaming false
  }
}

client<llm> ClaudeHaiku {
  provider openai-generic
  options {
    base_url env.BAML_PROXY_URL
    model "claude-haiku-4-5-20251001"
    api_key "ralph-internal"
    supports_streaming false
  }
}

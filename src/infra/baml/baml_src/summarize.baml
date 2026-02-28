class FailureSummary {
  summary string @description("2-sentence explanation of why the task failed")
}

function SummarizeFailure(
  validationOutput: string,
  attempt: int,
  maxAttempts: int
) -> FailureSummary {
  client ClaudeHaiku
  prompt #"
    Attempt {{ attempt }}/{{ maxAttempts }} failed. Explain why in 2 sentences.

    VALIDATION OUTPUT:
    {{ validationOutput }}

    {{ ctx.output_format }}
  "#
}

test SummarizeTypeError {
  functions [SummarizeFailure]
  args {
    validationOutput "❌ TSC Errors:\nsrc/auth.ts:15:5: Type 'string' is not assignable to type 'number'"
    attempt 1
    maxAttempts 3
  }
}

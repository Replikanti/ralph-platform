class TaskPlan {
  plan string @description("Full implementation plan in markdown")
}

function PlanTask(
  title: string,
  description: string,
  skills: string,
  previousErrors: string[]
) -> TaskPlan {
  client ClaudeSonnet
  prompt #"
    You are the Architect — an expert software engineer creating implementation plans.

    TASK: {{ title }}
    DESCRIPTION: {{ description }}
    {% if skills %}SKILLS:
{{ skills }}{% endif %}
    {% if previousErrors|length > 0 %}PREVIOUS ERRORS TO AVOID:
{{ previousErrors | join("\n") }}{% endif %}

    Output your plan inside <plan> tags.
    {{ ctx.output_format }}
  "#
}

test PlanSimpleFeature {
  functions [PlanTask]
  args {
    title "Add rate limiting to the API"
    description "Implement per-IP rate limiting using Redis"
    skills ""
    previousErrors []
  }
}

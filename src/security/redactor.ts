import { logger } from '../infra/logger';
import { Redactor } from '@redactpii/node';

// Custom secret patterns with specific replacements (applied before PII redactor)
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
    {
        pattern: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
        replacement: '<AWS_ACCESS_KEY_REDACTED>'
    },
    {
        pattern: /ghp_[a-zA-Z0-9]{36}/g,
        replacement: '<GITHUB_TOKEN_REDACTED>'
    },
    {
        pattern: /lin_api_[a-zA-Z0-9]{32}/g,
        replacement: '<LINEAR_API_KEY_REDACTED>'
    },
    {
        pattern: /xox[baprs]-([0-9a-zA-Z]{10,48})/g,
        replacement: '<SLACK_TOKEN_REDACTED>'
    },
    {
        pattern: /AIza[0-9A-Za-z-_]{35}/g,
        replacement: '<GOOGLE_API_KEY_REDACTED>'
    },
    {
        pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
        replacement: '<PRIVATE_KEY_HEADER_REDACTED>'
    },
    {
        // Generic High Entropy Assignments (e.g., api_key = "abcdef12345...")
        pattern: /((?:api|secret|token|key|password|passwd)[_.-]?(?:key|id|secret)?\s*[:=]\s*["']?)([a-z0-9/+]{20,})([\s"'])/gi,
        replacement: '$1<SECRET_REDACTED>$3'
    },
];

// Standard PII redactor for emails, credit cards, phone numbers, SSNs
// Names disabled — too many false positives in code (variable names, etc.)
const piiRedactor = new Redactor({
    rules: {
        CREDIT_CARD: true,
        EMAIL: true,
        NAME: false,
        PHONE: true,
        SSN: true,
    },
});

function redactSecrets(text: string): string {
    let result = text;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
        result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
    }
    return result;
}

/**
 * Sanitizes text by removing PII and Secrets before sending to LLM.
 * Use this for all file reads and command outputs.
 */
export async function redactText(text: string): Promise<string> {
    if (!text) return text;
    try {
        const secretsRedacted = redactSecrets(text);
        return piiRedactor.redact(secretsRedacted);
    } catch (e) {
        logger.error({ err: e }, '❌ Redaction failed — refusing to continue to prevent PII/secret leakage');
        throw new Error('Redaction pipeline failed; aborting to prevent data leakage');
    }
}

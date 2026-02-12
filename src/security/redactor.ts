import { AsyncRedactor, CustomRedactor } from '@redactpii/node';

/**
 * Custom Redactor for Secrets & Credentials
 * Adds specific patterns for technical secrets not covered by standard PII rules.
 */
class SecretRedactor extends CustomRedactor {
    constructor() {
        super({
            redactors: [
                {
                    // AWS Access Key ID
                    regexp: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
                    replacement: '<AWS_ACCESS_KEY_REDACTED>'
                },
                {
                    // GitHub Personal Access Token
                    regexp: /ghp_[a-zA-Z0-9]{36}/g,
                    replacement: '<GITHUB_TOKEN_REDACTED>'
                },
                {
                    // Linear API Key
                    regexp: /lin_api_[a-zA-Z0-9]{32}/g,
                    replacement: '<LINEAR_API_KEY_REDACTED>'
                },
                {
                    // Slack Token
                    regexp: /xox[baprs]-([0-9a-zA-Z]{10,48})/g,
                    replacement: '<SLACK_TOKEN_REDACTED>'
                },
                {
                    // Google API Key
                    regexp: /AIza[0-9A-Za-z-_]{35}/g,
                    replacement: '<GOOGLE_API_KEY_REDACTED>'
                },
                {
                    // Private Key Headers (RSA, DSA, EC, OPENSSH)
                    regexp: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
                    replacement: '<PRIVATE_KEY_HEADER_REDACTED>'
                },
                {
                    // Generic High Entropy Assignments (e.g., api_key = "abcdef12345...")
                    // Captures: 1=KeyName, 2=SecretValue, 3=Quote/End
                    regexp: /((?:api|secret|token|key|password|passwd)[_.-]?(?:key|id|secret)?\s*[:=]\s*["']?)([a-zA-Z0-9/+]{20,})([ "'])/gi,
                    replacement: (_match: string, p1: string, _p2: string, p3: string) => `${p1}<SECRET_REDACTED>${p3}`
                }
            ]
        });
    }
}

// Initialize the AsyncRedactor with built-in PII rules and our custom SecretRedactor
const redactor = new AsyncRedactor({
    builtInRedactors: {
        emailAddress: {
            enabled: true,
            replacement: '<EMAIL_REDACTED>'
        },
        ipAddress: {
            enabled: true,
            replacement: '<IP_REDACTED>'
        },
        creditCardNumber: {
            enabled: true,
            replacement: '<CREDIT_CARD_REDACTED>'
        },
        // Enable US Social Security Number just in case
        usSocialSecurityNumber: {
            enabled: true,
            replacement: '<SSN_REDACTED>'
        },
        // Disable names as they produce too many false positives in code (variable names etc.)
        names: {
            enabled: false
        }
    },
    customRedactors: {
        secrets: new SecretRedactor()
    }
});

/**
 * Sanitizes text by removing PII and Secrets before sending to LLM.
 * Use this for all file reads and command outputs.
 */
export async function redactText(text: string): Promise<string> {
    if (!text) return text;
    try {
        return await redactor.redact(text);
    } catch (e) {
        console.warn('⚠️ Redaction failed, returning original text (fail-open for stability, but logged):', e);
        return text;
    }
}

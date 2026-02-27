declare module '@redactpii/node' {
    export interface RedactorOptions {
        rules?: {
            CREDIT_CARD?: boolean;
            EMAIL?: boolean;
            NAME?: boolean;
            PHONE?: boolean;
            SSN?: boolean;
            [key: string]: boolean | undefined;
        };
        customRules?: RegExp[];
        globalReplaceWith?: string;
        anonymize?: boolean;
        aggressive?: boolean;
    }

    export class Redactor {
        constructor(options?: RedactorOptions);
        redact(text: string): string;
        hasPII(text: string): boolean;
        redactObject(obj: unknown): unknown;
    }
}

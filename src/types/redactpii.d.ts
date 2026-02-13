declare module '@redactpii/node' {
    export interface CustomRedactorConfig {
        redactors: Array<{
            regexp: RegExp;
            replacement: string | ((match: string, ...args: any[]) => string);
        }>;
    }

    export class CustomRedactor {
        constructor(config: CustomRedactorConfig);
    }

    export interface BuiltInRedactorConfig {
        enabled: boolean;
        replacement?: string;
    }

    export interface AsyncRedactorConfig {
        builtInRedactors?: {
            emailAddress?: BuiltInRedactorConfig;
            ipAddress?: BuiltInRedactorConfig;
            creditCardNumber?: BuiltInRedactorConfig;
            usSocialSecurityNumber?: BuiltInRedactorConfig;
            names?: BuiltInRedactorConfig;
            [key: string]: BuiltInRedactorConfig | undefined;
        };
        customRedactors?: {
            [key: string]: CustomRedactor;
        };
    }

    export class AsyncRedactor {
        constructor(config: AsyncRedactorConfig);
        redact(text: string): Promise<string>;
    }
}

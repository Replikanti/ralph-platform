
// --- MOCKS FOR @redactpii/node ---
export class AsyncRedactor {
    constructor(config: any) {}
    redact(text: string) { return Promise.resolve(text); }
}

export class CustomRedactor {
    constructor(config: any) {}
}

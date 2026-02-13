// --- MOCKS FOR @redactpii/node ---
export class AsyncRedactor {
    async redact(text: string): Promise<string> {
        return text;
    }
}

export class CustomRedactor {
    // Mock base class for custom redactors
    public readonly name: string = 'mock';
}
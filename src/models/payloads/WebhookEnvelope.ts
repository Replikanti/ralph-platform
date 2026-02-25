import { Property, Required } from "@tsed/schema";

export class WebhookEnvelope {
    @Required()
    action!: string;

    @Required()
    type!: string;

    @Property()
    data?: any; // Will be deserialized to specific DTO based on type
}

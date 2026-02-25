import { Property, Required, CollectionOf } from "@tsed/schema";

class LabelDto {
    @Property()
    name!: string;
}

class StateDto {
    @Property()
    name?: string;

    @Property()
    label?: string;
}

class TeamDto {
    @Property()
    key?: string;
}

export class IssueWebhookPayload {
    @Required()
    id!: string;

    @Property()
    identifier?: string;

    @Required()
    title!: string;

    @Property()
    description?: string;

    @Property()
    stateId?: string;

    @Property()
    state?: StateDto;

    @Property()
    team?: TeamDto;

    @CollectionOf(LabelDto)
    labels?: LabelDto[];
}

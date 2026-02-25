import { Property } from "@tsed/schema";

class CommentUserDto {
    @Property()
    name?: string;

    @Property()
    displayName?: string;
}

class CommentIssueStateDto {
    @Property()
    name?: string;
}

class CommentIssueTeamDto {
    @Property()
    key?: string;
}

class CommentIssueDto {
    @Property()
    id?: string;

    @Property()
    identifier?: string;

    @Property()
    title?: string;

    @Property()
    description?: string;

    @Property()
    state?: CommentIssueStateDto;

    @Property()
    team?: CommentIssueTeamDto;
}

export class CommentWebhookPayload {
    @Property()
    body?: string;

    @Property()
    user?: CommentUserDto;

    @Property()
    issue?: CommentIssueDto;
}

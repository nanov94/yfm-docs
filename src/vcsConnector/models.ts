import {ContributorsFunction} from '../models';

export enum SourceType {
    gitHub = 'gitHub',
    bitbucket = 'bitbucket',
    arcanum = 'arcanum',
}

export interface VCSConnectorOptions {
    isContributorsExist: boolean;
}

export interface VCSConnector {
    getContributorsByPath: ContributorsFunction;
}

export interface RepoVCSConnector {
    getRepoContributors: () => Promise<ContributorDTO[]>;
}

export interface ContributorDTO {
    login?: string;
    avatar?: string;
}

/* eslint-disable camelcase */
export interface GithubContributorDTO {
    login?: string;
    avatar_url?: string;
}

/* eslint-disable camelcase */
export interface GithubLogsDTO {
    author_email: string;
    author_name: string;
}

export interface YfmConfig {
    type: string;
    github?: {
        endpoint: string;
        token: string;
        owner: string;
        repo: string;
    };
}
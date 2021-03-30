import log from '@doc-tools/transform/lib/log';

import {Contributors, FileData} from '../models';
import {Client, ContributorDTO} from '../client/models';

async function getAllContributors(client: Client): Promise<Contributors> {
    try {
        const repoContributors = await client.repoClient.getRepoContributors();

        const contributors: Contributors = {};

        repoContributors.forEach((contributor: ContributorDTO) => {
            const {login, avatar = ''} = contributor;
            if (login) {
                contributors[login] = {
                    avatar,
                    name: '',
                };
            }
        });

        return contributors;
    } catch (error) {
        console.log(error);
        log.error(`Getting contributors was failed. Error: ${JSON.stringify(error)}`);
        throw error;
    }
}

async function addMetadata(fileData: FileData, client: Client): Promise<string> {
    // Search by format:
    // ---
    // metaName1: metaValue1
    // metaName2: meta value2
    // incorrectMetadata
    // ---
    const regexpMetadata = '(?<=-{3}\\r\\n)((.*\\r\\n)*)(?=-{3}\\r\\n)';
    // Search by format:
    // ---
    // main content 123
    const regexpFileContent = '---((.*[\r\n]*)*)';
    const regexpParseFileContent = new RegExp(`${regexpMetadata}${regexpFileContent}`, 'gm');
    const matches = regexpParseFileContent.exec(fileData.fileContent);

    const contributors = await getFileContributorsString(fileData, client);
    const contributorsValue = `contributors: ${contributors}`;

    if (matches && matches.length > 0) {
        const [, fileMetadata, , fileMainContent] = matches;

        return `${getUpdatedMetadata(contributorsValue, fileMetadata)}${fileMainContent}`;
    }

    return `${getUpdatedMetadata(contributorsValue)}${fileData.fileContent}`;
}

async function getFileContributorsString(fileData: FileData, client: Client): Promise<string> {
    const {tmpInputfilePath, inputFolderPathLength, allContributors} = fileData;

    const relativeFilePath = tmpInputfilePath.substring(inputFolderPathLength);
    const fileContributors = await client.getLogsByPath(relativeFilePath);

    const contributors: Contributors = {};

    Object.keys(fileContributors).forEach((login: string) => {
        if (allContributors[login]) {
            contributors[login] = {
                ...fileContributors[login],
                avatar: allContributors[login].avatar,
            };
        }
    });

    return JSON.stringify(contributors).replace(/"/g, '\'');
}

function getUpdatedMetadata(metaContributorsValue: string, defaultMetadata = ''): string {
    const metadataСarriage = '\r\n';
    const metadataBorder = `---${metadataСarriage}`;

    const newMetadata = `${defaultMetadata}${metadataСarriage}${metaContributorsValue}${metadataСarriage}`;

    return `${metadataBorder}${newMetadata}${metadataBorder}`;
}

export {
    getAllContributors,
    addMetadata,
    getFileContributorsString,
};

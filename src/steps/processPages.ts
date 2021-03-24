import {basename, dirname, extname, resolve, join, relative} from 'path';
import shell from 'shelljs';
import {copyFileSync, readFileSync, writeFileSync} from 'fs';
import {bold} from 'chalk';

import log from '@doc-tools/transform/lib/log';

import {ArgvService, LeadingService, TocService} from '../services';
import {resolveMd2HTML, resolveMd2Md} from '../resolvers';
import {joinSinglePageResults, logger} from '../utils';
import {Contributor, Contributors, SinglePageResult} from '../models';
import {SINGLE_PAGE_FOLDER} from '../constants';
import {Client, ContributorDTO} from '../client/models';

const singlePageResults: Record<string, SinglePageResult[]> = {};
const singlePagePaths: Record<string, Set<string>> = {};

interface FileData {
    tmpInputfilePath: string;
    inputFolderPathLength: number;
    fileContent: string;
    allContributors: Contributors;
}

interface PathData {
    pathToFile: string;
    resolvedPathToFile: string;
    filename: string;
    fileBaseName: string;
    fileExtension: string;
    outputDir: string;
    outputPath: string;
    outputFormat: string;
    outputBundlePath: string;
}

// Processes files of documentation (like index.yaml, *.md)
export async function processPages(tmpInputFolder: string, outputBundlePath: string, client: Client): Promise<void> {
    const {
        input: inputFolderPath,
        output: outputFolderPath,
        outputFormat,
        singlePage,
        contributors,
    } = ArgvService.getConfig();

    const allContributors = await getAllContributors(client);
    const isContributorsExist = Object.getOwnPropertyNames(allContributors).length > 0 && contributors;
    const inputFolderPathLength = inputFolderPath.length;

    const promises: Promise<void>[] = [];

    for (const pathToFile of TocService.getNavigationPaths()) {
        const pathData = getPathData(pathToFile, inputFolderPath, outputFolderPath, outputFormat, outputBundlePath);

        logger.proc(pathData.resolvedPathToFile.replace(tmpInputFolder, ''));

        if (singlePage && outputFormat === 'md') {
            preparingSinglePages(pathData, singlePage, outputFolderPath);
        }

        console.log('>>>>>>>>>>>>>>>>>>>>>', pathToFile);
        if (pathToFile.includes('en') === true) {
            promises.push(preparingPagesByOutputFormat(pathData, client, allContributors, isContributorsExist, inputFolderPathLength));
        }

    }

    try {
        await Promise.all(promises);
    } catch (error) {
        console.log('>>>>>>>>>>>>>>>>>>>>>', error);
    }
}

function getPathData(
    pathToFile: string,
    inputFolderPath: string,
    outputFolderPath: string,
    outputFormat: string,
    outputBundlePath: string,
): PathData {
    const pathToDir: string = dirname(pathToFile);
    const filename: string = basename(pathToFile);
    const fileExtension: string = extname(pathToFile);
    const fileBaseName: string = basename(filename, fileExtension);
    const outputDir = resolve(outputFolderPath, pathToDir);
    const outputFileName = `${fileBaseName}.${outputFormat}`;

    const pathData: PathData = {
        pathToFile,
        resolvedPathToFile: resolve(inputFolderPath, pathToFile),
        filename,
        fileBaseName,
        fileExtension,
        outputDir,
        outputPath: resolve(outputDir, outputFileName),
        outputFormat,
        outputBundlePath,
    };

    return pathData;
}

async function preparingPagesByOutputFormat(path: PathData, client: Client, allContributors: Contributors, isContributorsExist: boolean, inputFolderPathLength: number): Promise<void> {
    const {
        outputBundlePath,
        filename,
        fileExtension,
        fileBaseName,
        outputDir,
        resolvedPathToFile,
        outputPath,
        outputFormat,
        pathToFile,
    } = path;

    try {
        const isMdOutputFormat = outputFormat === 'md';
        const isYamlExtension = fileExtension === '.yaml';

        let outputFileContent = '';

        shell.mkdir('-p', outputDir);

        if (fileBaseName === 'index' && isYamlExtension) {
            LeadingService.filterFile(pathToFile);
        }

        if (isMdOutputFormat) {
            if (isYamlExtension) {
                copyFileWithoutChanges(resolvedPathToFile, outputDir, filename);
                return;
            }

            outputFileContent = resolveMd2Md({inputPath: pathToFile, outputPath: outputDir});
        }

        if (outputFormat === 'html') {
            if (!isYamlExtension && fileExtension !== '.md') {
                copyFileWithoutChanges(resolvedPathToFile, outputDir, filename);
                return;
            }

            outputFileContent = resolveMd2HTML({
                inputPath: pathToFile,
                outputBundlePath,
                fileExtension,
                outputPath,
                filename,
            });
        }

        console.log('*************** ', pathToFile);
        if (isContributorsExist) {
            const fileData: FileData = {
                tmpInputfilePath: resolvedPathToFile,
                inputFolderPathLength,
                fileContent: outputFileContent,
                allContributors,
            };
            outputFileContent = await addMetadata(fileData, client);
        }

        writeFileSync(outputPath, outputFileContent);
    } catch (e) {
        console.log(e);
        log.error(` No such file or has no access to ${bold(resolvedPathToFile)}`);
    }
}

async function getAllContributors(client: Client): Promise<Contributors> {
    try {
        const repoContributors = await client.repoClient.getRepoContributors();

        const contributors: Contributors = {};

        repoContributors.forEach((contributor: ContributorDTO) => {
            const {login, avatar = ''} = contributor;
            if (login) {
                contributors[login] = {
                    avatar,
                    login,
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

function preparingSinglePages(pathData: PathData, singlePage: boolean, outputFolderPath: string): void {
    try {
        const {pathToFile, outputPath, fileExtension} = pathData;
        const pathToDir: string = dirname(pathToFile);
        const outputSinglePageDir = resolve(TocService.getTocDir(outputPath), SINGLE_PAGE_FOLDER);
        const outputSinglePageFileDir = resolve(outputSinglePageDir, pathToDir);

        shell.mkdir('-p', outputSinglePageFileDir);

        const isExistFileAsSinglePage = singlePagePaths[outputSinglePageDir] && singlePagePaths[outputSinglePageDir].has(pathToFile);

        if (!(fileExtension === '.yaml') && !isExistFileAsSinglePage) {
            const outputSinglePageContent = resolveMd2Md({inputPath: pathToFile, outputPath: outputSinglePageFileDir, singlePage});

            const absolutePathToFile = resolve(outputFolderPath, pathToFile);
            const relativePathToOriginalFile = relative(outputSinglePageDir, absolutePathToFile);

            singlePageResults[outputSinglePageDir] = singlePageResults[outputSinglePageDir] || [];
            singlePageResults[outputSinglePageDir].push({
                path: relativePathToOriginalFile,
                content: outputSinglePageContent,
            });

            singlePagePaths[outputSinglePageDir] = singlePagePaths[outputSinglePageDir] || new Set();
            singlePagePaths[outputSinglePageDir].add(pathToFile);
        }

        const singlePageFn = join(outputSinglePageDir, 'index.md');
        const content = joinSinglePageResults(singlePageResults[outputSinglePageDir]);

        writeFileSync(singlePageFn, content);
    } catch (error) {
        console.log(error);
    }
}

function copyFileWithoutChanges(resolvedPathToFile: string, outputDir: string, filename: string): void {
    const from = resolvedPathToFile;
    const to = resolve(outputDir, filename);

    copyFileSync(from, to);
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
    const regexpFileContent = '---((.*\\r\\n)*)';
    const regexpParseFileContent = new RegExp(`${regexpMetadata}${regexpFileContent}`, 'gm');
    const matches = regexpParseFileContent.exec(fileData.fileContent);

    const contributorsValue = await getFileContributors(fileData, client);


    if (matches && matches.length > 0) {
        const [, fileMetadata, , fileMainContent] = matches;

        return `${getUpdatedMetadata(contributorsValue, fileMetadata)}${fileMainContent}`;
    }

    return `${getUpdatedMetadata(contributorsValue)}${fileData.fileContent}`;
}

async function getFileContributors(fileData: FileData, client: Client): Promise<string> {
    const {tmpInputfilePath, inputFolderPathLength, allContributors} = fileData;

    const relativeFilePath = tmpInputfilePath.substring(inputFolderPathLength);
    const fileContributors = await client.getLogsByPath(relativeFilePath);

    const contributorsForIncludedFiles = await getContributorsForIncludedFiles(fileData, client);

    const fileContributorsWithContributorsIncludedFiles: Contributors = {
        ...fileContributors,
        ...contributorsForIncludedFiles,
    };

    const contributors: Contributor[] = [];

    Object.keys(fileContributorsWithContributorsIncludedFiles).forEach((login: string) => {
        if (allContributors[login]) {
            contributors.push({
                ...fileContributors[login],
                ...allContributors[login],
            });
        }
    });

    return `contributors: ${JSON.stringify(contributors)}`;
}

async function getContributorsForIncludedFiles(fileData: FileData, client: Client): Promise<Contributors> {
    const {tmpInputfilePath, inputFolderPathLength, fileContent} = fileData;

    // Inxlude example: {% include [createfolder](create-folder.md) %}
    // [createfolder](create-folder.md)
    const regexpIncludeContents = /(?<=[{%]\sinclude\s).+(?=\s[%}])/gm;
    // create-folder.md
    const regexpIncludeFilePath = /(?<=[(]).+(?=[)])/g;

    const includeContents = fileContent.match(regexpIncludeContents);
    if (!includeContents || includeContents.length === 0) {
        return {};
    }

    const promises: Promise<Contributors>[] = [];
    const nestedContributors: Contributors[] = [];

    for (const includeContent of includeContents) {
        const match = includeContent.match(regexpIncludeFilePath);

        if (match && match.length !== 0) {
            const includeFilePathWithoutFragment = match[0].split('#');

            const includeFilePath = join(dirname(tmpInputfilePath), includeFilePathWithoutFragment[0]);
            const contributorsForNestedFiles = await getContributorsForNestedFiles(includeFilePath, fileData, client);
            nestedContributors.push(contributorsForNestedFiles);

            promises.push(client.getLogsByPath(includeFilePath.substring(inputFolderPathLength)));
        }
    }

    const contributors: Contributors[] = await Promise.all(promises);

    return Object.assign({}, ...contributors, ...nestedContributors);
}

async function getContributorsForNestedFiles(includeFilePath: string, fileData: FileData, client: Client): Promise<Contributors> {
    const contentIncludeFile: string = readFileSync(includeFilePath, 'utf8');

    const newFileData: FileData = {
        ...fileData,
        fileContent: contentIncludeFile,
        tmpInputfilePath: includeFilePath,
    };

    return getContributorsForIncludedFiles(newFileData, client);
}

function getUpdatedMetadata(metaContributorsValue: string, defaultMetadata = ''): string {
    const metadataСarriage = '\r\n';
    const metadataBorder = `---${metadataСarriage}`;

    const newMetadata = `${defaultMetadata}${metadataСarriage}${metaContributorsValue}${metadataСarriage}`;

    return `${metadataBorder}${newMetadata}${metadataBorder}`;
}

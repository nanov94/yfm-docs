import {readFileSync, writeFileSync} from 'fs';
import {basename, dirname, join, resolve} from 'path';
import shell from 'shelljs';

import log, {Logger} from 'yfm-transform/lib/log';
import liquid from 'yfm-transform/lib/liquid';

import {ArgvService, PresetService} from '../services';
import {getPlugins} from '../utils';

function transformMd2Md(input: string, options: ResolverOptions) {
    const {applyPresets} = ArgvService.getConfig();
    const {vars = {}, path, root, destPath, destRoot, collectOfPlugins, log, copyFile} = options;
    const output = liquid(input, vars, path, {
        conditions: true,
        substitutions: applyPresets,
    });

    if (typeof collectOfPlugins === 'function') {
        collectOfPlugins(output, {
            vars,
            path,
            root,
            destPath,
            destRoot,
            log,
            copyFile,
        });
    }

    return {
        result: output,
        logs: log.get(),
    };
}

export interface ResolverOptions {
    vars: Record<string, string>;
    path: string;
    log: Logger;
    copyFile: (targetPath: string, targetDestPath: string, options?: ResolverOptions) => void;
    root?: string;
    destPath?: string;
    destRoot?: string;
    collectOfPlugins?: (input: string, options: ResolverOptions) => void;
}

interface Plugin {
    collect: (input: string, options: ResolverOptions) => void;
}

function makeCollectOfPlugins(plugins: Plugin[]) {
    const pluginsWithCollect = plugins.filter((plugin: Plugin) => {
        return typeof plugin.collect === 'function';
    });

    return (output: string, options: ResolverOptions) => {
        pluginsWithCollect.forEach((plugin: Plugin) => {
            plugin.collect(output, options);
        });
    };
}

/**
 * Transforms raw markdown file to public markdown document.
 * @param inputPath
 * @param outputPath
 * @return {string}
 */
export function resolveMd2Md(inputPath: string, outputPath: string): string {
    const {input, output, vars} = ArgvService.getConfig();
    const resolvedInputPath = resolve(input, inputPath);
    const content: string = readFileSync(resolvedInputPath, 'utf8');

    const plugins = getPlugins();
    const collectOfPlugins = makeCollectOfPlugins(plugins);

    const {result} = transformMd2Md(content, {
        path: resolvedInputPath,
        destPath: join(outputPath, basename(inputPath)),
        root: resolve(input),
        destRoot: resolve(output),
        collectOfPlugins,
        vars: {
            ...PresetService.get(dirname(inputPath)),
            ...vars,
        },
        log,
        copyFile,
    });
    return result;
}

function copyFile(targetPath: string, targetDestPath: string, options?: ResolverOptions) {
    shell.mkdir('-p', dirname(targetDestPath));

    if (options) {
        const sourceIncludeContent = readFileSync(targetPath, 'utf8');
        const {result} = transformMd2Md(sourceIncludeContent, options);

        writeFileSync(targetDestPath, result);
    } else {
        shell.cp(targetPath, targetDestPath);
    }
}

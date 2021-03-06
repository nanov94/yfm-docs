import {Arguments} from 'yargs';
import {join, resolve} from 'path';
import {readFileSync} from 'fs';
import {load} from 'js-yaml';
import log from '@doc-tools/transform/lib/log';
import {REDIRECTS_FILENAME} from './constants';

function notEmptyStringValidator(value: string): Boolean {
    return Boolean(value) && Boolean(value?.length);
}

function requiredValueValidator(value: unknown): Boolean {
    return Boolean(value);
}

interface ValidatorProps {
    errorMessage?: string;
    validateFn?: (value: any) => Boolean;
    defaultValue?: any;
}

const validators: Record<string, ValidatorProps> = {
    'storageEndpoint': {
        errorMessage: 'Endpoint of S3 storage must be provided when publishes.',
        validateFn: notEmptyStringValidator,
    },
    'storageBucket': {
        errorMessage: 'Bucket name of S3 storage must be provided when publishes.',
        validateFn: notEmptyStringValidator,
    },
    'storageKeyId': {
        errorMessage: 'Key Id of S3 storage must be provided when publishes.',
        validateFn: notEmptyStringValidator,
        defaultValue: process.env.YFM_STORAGE_KEY_ID,
    },
    'storageSecretKey': {
        errorMessage: 'Secret key of S3 storage must be provided when publishes.',
        validateFn: notEmptyStringValidator,
        defaultValue: process.env.YFM_STORAGE_SECRET_KEY,
    },
};

interface Redirect {
    from: string;
    to: string;
}

interface RedirectsConfig {
    common: Redirect[];
    [lang: string]: Redirect[];
}

function validateRedirects(redirectsConfig: RedirectsConfig, pathToRedirects: string) {
    const redirects: Redirect[] = Object.keys(redirectsConfig).reduce((res, redirectSectionName) => {
        const sectionRedirects = redirectsConfig[redirectSectionName];
        res.push(...sectionRedirects);
        return res;
    }, [] as Redirect[]);

    const getContext = (from: string, to: string) => ` [Context: \n- from: ${from}\n- to: ${to} ]`;
    const formatMessage = (message: string, pathname: string, from: string, to: string) => (
        `${pathname}: ${message} ${getContext(from, to)}`
    );

    redirects.forEach((redirect) => {
        const {from, to} = redirect;

        if (!from || !to) {
            throw new Error(formatMessage('One of the two parameters is missing', pathToRedirects, from, to));
        }

        if (from === to) {
            throw new Error(formatMessage('Parameters must be different', pathToRedirects, from, to));
        }
    });
}

export function argvValidator(argv: Arguments<Object>): Boolean {
    try {
        // Combine passed argv and properties from configuration file.
        const pathToConfig = argv.config ? String(argv.config) : join(String(argv.input), '.yfm');
        const content = readFileSync(resolve(pathToConfig), 'utf8');
        Object.assign(argv, load(content) || {});
    } catch (error) {
        if (error.name === 'YAMLException') {
            log.error(`Error to parse .yfm: ${error.message}`);
        }
    }

    try {
        const pathToRedirects = join(String(argv.input), REDIRECTS_FILENAME);
        const redirectsContent = readFileSync(resolve(pathToRedirects), 'utf8');
        const redirects = load(redirectsContent);

        validateRedirects(redirects as RedirectsConfig, pathToRedirects);
    } catch (error) {
        if (error.name === 'YAMLException') {
            log.error(`Error to parse redirects.yaml: ${error.message}`);
        }

        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (argv.publish) {
        for (const [field, validator] of Object.entries(validators)) {
            const value = argv[field] ?? validator.defaultValue;

            if (!validator) {
                continue;
            }

            const validateFn = validator.validateFn ?? requiredValueValidator;

            if (!validateFn(value)) {
                throw new Error(validator.errorMessage);
            }

            argv[field] = value;
        }
    }

    return true;
}

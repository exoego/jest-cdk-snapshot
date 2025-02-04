import { App, Stack, StageSynthesisOptions } from "aws-cdk-lib";
import { toMatchSnapshot } from "jest-snapshot";
import * as jsYaml from "js-yaml";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toMatchCdkSnapshot(options?: Options): R;
    }
  }
}

type Options = StageSynthesisOptions & {
  /**
   * Output snapshots in YAML (instead of JSON)
   */
  yaml?: boolean;

  /**
   * Ignore Assets
   */
  ignoreAssets?: boolean;

  /**
   * Ignore Lambda Current Version
   */
  ignoreCurrentVersion?: boolean;

  /**
   * Match only resources of given types
   */
  subsetResourceTypes?: string[];

  /**
   * Match only resources of given keys
   */
  subsetResourceKeys?: string[];

  propertyMatchers?: { [property: string]: unknown };

  /**
   * Excludes CDK v2-managed bootstrap versions.
   * Defaults to `false`.
   */
  ignoreBootstrapVersion?: boolean;
};

const currentVersionRegex = /^(.+CurrentVersion[0-9A-F]{8})[0-9a-f]{32}$/;

export const toMatchCdkSnapshot = function (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  this: any,
  received: Stack,
  options: Options = {},
) {
  const matcher = toMatchSnapshot.bind(this);
  const { propertyMatchers, ...convertOptions } = options;

  const stack = convertStack(received, convertOptions);

  return propertyMatchers ? matcher(stack, propertyMatchers) : matcher(stack);
};

const maskCurrentVersionRefs = (tree: unknown): void => {
  if (tree == null) {
    return;
  }
  if (Array.isArray(tree)) {
    for (let i = 0; i < tree.length; i++) {
      const value = tree[i];
      if (typeof value === "string") {
        const match = currentVersionRegex.exec(value);
        if (match) {
          tree[i] = `${match[1]}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
        }
      } else if (typeof value === "object") {
        maskCurrentVersionRefs(value);
      }
    }
  } else if (typeof tree === "object") {
    for (const [key, value] of Object.entries(tree)) {
      const keyMatch = currentVersionRegex.exec(key);
      if (keyMatch) {
        const newKey = `${keyMatch[1]}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
        tree[newKey] = value;
        delete tree[key];
      }

      if (typeof value === "string") {
        const valueMatch = currentVersionRegex.exec(value);
        if (valueMatch) {
          tree[key] = `${valueMatch[1]}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
        }
      } else if (typeof value === "object") {
        maskCurrentVersionRefs(value as Record<string, unknown>);
      }
    }
  }
};

const convertStack = (stack: Stack, options: Options = {}) => {
  const {
    yaml,
    ignoreAssets = false,
    ignoreBootstrapVersion = true,
    ignoreCurrentVersion = false,
    subsetResourceTypes,
    subsetResourceKeys,
    ...synthOptions
  } = options;

  const template = App.of(stack)?.synth(synthOptions).stacks[0].template ?? {};

  if (ignoreBootstrapVersion) {
    if (template.Parameters) {
      delete template.Parameters.BootstrapVersion;
      if (Object.keys(template.Parameters).length === 0) {
        delete template.Parameters;
      }
    }

    if (template.Rules) {
      delete template.Rules.CheckBootstrapVersion;
      if (Object.keys(template.Rules).length === 0) {
        delete template.Rules;
      }
    }
  }

  if (ignoreAssets && template.Resources) {
    const anyObject = yaml ? "Any<Object>" : expect.any(Object);

    if (template.Parameters) {
      template.Parameters = anyObject;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.values(template.Resources).forEach((resource: any) => {
      if (resource?.Properties?.Code) {
        resource.Properties.Code = anyObject;
      }
    });
  }

  if (ignoreCurrentVersion && template.Resources) {
    maskCurrentVersionRefs(template);
  }

  if (subsetResourceTypes && template.Resources) {
    for (const [key, resource] of Object.entries(template.Resources)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!subsetResourceTypes.includes((resource as any).Type)) {
        delete template.Resources[key];
      }
    }
  }

  if (subsetResourceKeys && template.Resources) {
    for (const [key] of Object.entries(template.Resources)) {
      if (!subsetResourceKeys.includes(key)) {
        delete template.Resources[key];
      }
    }
  }

  return yaml ? jsYaml.safeDump(template) : template;
};

if (expect !== undefined) {
  expect.extend({ toMatchCdkSnapshot });
} else {
  console.error(
    "Unable to find Jest's global expect." +
      "\nPlease check you have added jest-cdk-snapshot correctly." +
      "\nSee https://github.com/hupe1980/jest-cdk-snapshot for help.",
  );
}

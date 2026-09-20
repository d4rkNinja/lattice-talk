import packageJson from "../package.json";

/**
 * Derived from package.json so the MCP serverInfo version can never drift
 * from the published npm version.
 */
export const PACKAGE_NAME: string = packageJson.name;
export const PACKAGE_VERSION: string = packageJson.version;

import type { FixturesAsset, SchemaAsset } from "./spec-artifacts.ts";

export const SPEC_VERSION = "0.1.0";
export const RELEASE_TAG = `v${SPEC_VERSION}`;
export const RELEASE_URL = `https://github.com/agent-trail/spec/releases/tag/${RELEASE_TAG}`;
const RELEASE_DOWNLOAD_URL = `https://github.com/agent-trail/spec/releases/download/${RELEASE_TAG}`;

export const SCHEMA_ASSET: SchemaAsset = {
  name: `schema-${RELEASE_TAG}.json`,
  url: `${RELEASE_DOWNLOAD_URL}/schema-${RELEASE_TAG}.json`,
  sha256: "6c89c0287a94925b98d228a12336786e76eefbb9b33de8b0ef5b9f8f5ae21a6f",
  targetPath: "schema/v0.1.0.json",
};

export const FIXTURES_ASSET: FixturesAsset = {
  name: `fixtures-${RELEASE_TAG}.tar.gz`,
  url: `${RELEASE_DOWNLOAD_URL}/fixtures-${RELEASE_TAG}.tar.gz`,
  sha256: "6f361996a6c7bd0c21fd54655421c8b8e345c376a4c3fbbf0887e59f4bc0c39f",
  targetPath: "fixtures",
};

export const CHECKSUMS_URL = `${RELEASE_DOWNLOAD_URL}/checksums-${RELEASE_TAG}.txt`;
